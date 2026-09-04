from __future__ import annotations
"""
Speech-to-text for answer audio, plus the vocal delivery metrics derived from it.

Local faster-whisper (pretrained Whisper weights, CPU/GPU) runs first; Groq's hosted
Whisper is the fallback. Segment timestamps are kept — they are what the confidence
score is built from — and FFmpeg produces the 16kHz mono wav used for energy analysis.

First local run downloads model weights from Hugging Face (size set by WHISPER_MODEL_SIZE).
"""

import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, UploadFile
from openai import AsyncOpenAI

from app.voice import extract_metrics

logger = logging.getLogger(__name__)
router = APIRouter()

# Client used for cloud-based STT (Groq Whisper)
client = AsyncOpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL", "https://api.groq.com/openai/v1"),
)


def _ffmpeg_bin() -> str:
    if shutil.which("ffmpeg"):
        return "ffmpeg"
    for p in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"):
        if os.path.exists(p):
            return p
    return "ffmpeg"


def _ffmpeg_to_wav(src: Path) -> Path | None:
    """Decodes any container to 16kHz mono PCM wav (audio only)."""
    dst = src.with_suffix(".wav")
    try:
        subprocess.run(
            [
                _ffmpeg_bin(),
                "-y",
                "-i",
                str(src),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-f",
                "wav",
                str(dst),
            ],
            check=True,
            capture_output=True,
            timeout=180,
        )
        return dst
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as e:
        logger.warning("ffmpeg wav extract failed: %s", e)
        return None


def _transcribe_faster_whisper(path: Path) -> tuple[str, list[dict[str, Any]]] | None:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        logger.warning("faster-whisper not installed; pip install -r requirements.txt")
        return None

    size = os.getenv("WHISPER_MODEL_SIZE", "base")
    device = os.getenv("WHISPER_DEVICE", "cpu")
    compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

    try:
        model = WhisperModel(size, device=device, compute_type=compute_type)
    except Exception as e:
        logger.warning("WhisperModel(%s) load failed: %s", size, e)
        return None

    try:
        segments, _info = model.transcribe(
            str(path),
            beam_size=5,
            vad_filter=True,
            language="en",
        )
        segs = [
            {"start": float(s.start), "end": float(s.end), "text": s.text.strip()}
            for s in segments
        ]
    except Exception as e:
        logger.warning("faster_whisper transcribe failed: %s", e)
        return None

    text = " ".join(s["text"] for s in segs).strip()
    return (text, segs) if text else None


def _transcribe_openai_whisper_pkg(path: Path) -> tuple[str, list[dict[str, Any]]] | None:
    """Optional fallback if `openai-whisper` (PyTorch) is installed separately."""
    try:
        import whisper  # type: ignore
    except ImportError:
        return None
    try:
        model = whisper.load_model(os.getenv("WHISPER_MODEL", "base"))
        result = model.transcribe(str(path), language="en")
    except Exception as e:
        logger.warning("openai-whisper failed: %s", e)
        return None

    text = (result.get("text") or "").strip()
    if not text:
        return None
    segs = [
        {
            "start": float(s.get("start", 0.0)),
            "end": float(s.get("end", 0.0)),
            "text": (s.get("text") or "").strip(),
        }
        for s in result.get("segments") or []
    ]
    return text, segs


async def _transcribe_cloud(path: Path) -> tuple[str, list[dict[str, Any]]] | None:
    """Groq hosted Whisper. verbose_json so segment timestamps survive."""
    try:
        with open(path, "rb") as audio_file:
            res = await client.audio.transcriptions.create(
                model="whisper-large-v3",
                file=audio_file,
                response_format="verbose_json",
                language="en",
            )
    except Exception as e:
        logger.warning("Cloud transcription failed: %s", e)
        return None

    text = (getattr(res, "text", "") or "").strip()
    if not text:
        return None

    segs: list[dict[str, Any]] = []
    for s in getattr(res, "segments", None) or []:
        get = s.get if isinstance(s, dict) else lambda k, d=None: getattr(s, k, d)
        try:
            segs.append(
                {
                    "start": float(get("start", 0.0) or 0.0),
                    "end": float(get("end", 0.0) or 0.0),
                    "text": (get("text", "") or "").strip(),
                }
            )
        except (TypeError, ValueError):
            continue
    return text, segs


async def _transcribe(source: Path, wav: Path | None) -> tuple[str, list[dict[str, Any]]]:
    """Local first (original container, then wav), cloud last."""
    for candidate in (source, wav):
        if candidate is None:
            continue
        got = _transcribe_faster_whisper(candidate)
        if got:
            return got

    got = _transcribe_openai_whisper_pkg(wav or source)
    if got:
        return got

    logger.info("Local transcription empty/failed; trying cloud...")
    got = await _transcribe_cloud(wav or source)
    if got:
        return got

    logger.warning(
        "Transcription empty: install faster-whisper (see requirements.txt), ensure ffmpeg "
        "is on PATH, or set OPENAI_API_KEY for the cloud fallback."
    )
    return "", []


@router.post("/speech-to-text")
async def speech_to_text(
    file: UploadFile = File(...),
    window_seconds: float | None = Form(None),
):
    """
    Returns the transcript, Whisper segment timestamps, and voice_meta —
    the vocal delivery metrics /evaluate-answer turns into a confidence score.
    """
    suffix = Path(file.filename or "clip").suffix or ".webm"
    data = await file.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)

    wav = _ffmpeg_to_wav(tmp_path)
    try:
        text, segments = await _transcribe(tmp_path, wav)
        voice_meta = extract_metrics(
            text=text,
            segments=segments,
            wav_path=wav,
            window_seconds=window_seconds,
        )
        return {"text": text, "segments": segments, "voice_meta": voice_meta}
    finally:
        for p in (tmp_path, wav):
            if p is None:
                continue
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass
