"""
Local speech-to-text using faster-whisper (pretrained Whisper weights, runs on CPU/GPU).
No OpenAI or other paid APIs. FFmpeg converts tricky WebM clips to WAV when needed.

First run downloads model weights from Hugging Face (size set by WHISPER_MODEL_SIZE).
"""

import logging
import os
import subprocess
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, UploadFile

logger = logging.getLogger(__name__)
router = APIRouter()


def _ffmpeg_to_wav(src: Path) -> Path | None:
    dst = src.with_suffix(".wav")
    try:
        subprocess.run(
            [
                "ffmpeg",
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


def _transcribe_faster_whisper(path: Path) -> str | None:
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
            language=os.getenv("WHISPER_LANGUAGE") or None,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        return text or None
    except Exception as e:
        logger.warning("faster_whisper transcribe failed: %s", e)
        return None


def _transcribe_openai_whisper_pkg(path: Path) -> str | None:
    """Optional fallback if `openai-whisper` (PyTorch) is installed separately."""
    try:
        import whisper  # type: ignore
    except ImportError:
        return None
    try:
        model_name = os.getenv("WHISPER_MODEL", "base")
        model = whisper.load_model(model_name)
        result = model.transcribe(str(path))
        return (result.get("text") or "").strip() or None
    except Exception as e:
        logger.warning("openai-whisper failed: %s", e)
        return None


def _transcribe_file(path: Path) -> str:
    t = _transcribe_faster_whisper(path)
    if t:
        return t

    wav = _ffmpeg_to_wav(path)
    if wav:
        try:
            t = _transcribe_faster_whisper(wav)
            if t:
                return t
        finally:
            try:
                wav.unlink(missing_ok=True)
            except OSError:
                pass

    t = _transcribe_openai_whisper_pkg(path)
    if t:
        return t

    logger.warning(
        "Transcription empty: install faster-whisper (see requirements.txt) and ensure ffmpeg is on PATH."
    )
    return ""


@router.post("/speech-to-text")
async def speech_to_text(file: UploadFile = File(...)):
    suffix = Path(file.filename or "clip").suffix or ".webm"
    data = await file.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)
    try:
        text = _transcribe_file(tmp_path)
        return {"text": text}
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
