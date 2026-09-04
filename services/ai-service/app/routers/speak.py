from __future__ import annotations
"""
Interviewer voice — local neural TTS via Piper.

Runs offline on CPU at roughly 8x realtime, so a question is spoken almost as soon
as it is asked for. The voice model (~63MB) downloads on first use, the same way
Whisper fetches its weights, and is then cached on disk.

Kokoro was the first choice for quality but cannot be installed here: it pulls
spacy -> thinc -> blis, and blis has no Python 3.14 wheel.
"""

import io
import logging
import os
import threading
import urllib.request
import wave
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter()

DEFAULT_VOICE = "en_GB-alan-medium"
VOICE_BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium"

# Loading the ONNX model takes about a second; keep one instance for the process.
_voice = None
_voice_lock = threading.Lock()


class SpeakBody(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


def _voice_dir() -> Path:
    override = os.getenv("PIPER_VOICE_DIR")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent.parent / ".models" / "piper"


def _ensure_voice_files() -> tuple[Path, Path] | None:
    """Downloads the ONNX voice and its config on first use. None if unavailable."""
    name = os.getenv("PIPER_VOICE", DEFAULT_VOICE)
    directory = _voice_dir()
    model = directory / f"{name}.onnx"
    config = directory / f"{name}.onnx.json"

    if model.exists() and config.exists() and model.stat().st_size > 0:
        return model, config

    try:
        directory.mkdir(parents=True, exist_ok=True)
        for target, url in ((model, f"{VOICE_BASE_URL}/{name}.onnx"),
                            (config, f"{VOICE_BASE_URL}/{name}.onnx.json")):
            if target.exists() and target.stat().st_size > 0:
                continue
            logger.info("Downloading Piper voice asset %s", target.name)
            tmp = target.with_suffix(target.suffix + ".part")
            urllib.request.urlretrieve(url, tmp)
            tmp.replace(target)
        return model, config
    except Exception as e:
        logger.warning("Could not fetch Piper voice %s: %s", name, e)
        return None


def _get_voice():
    """Loads the Piper voice once. Returns None when TTS is unavailable."""
    global _voice
    if _voice is not None:
        return None if _voice == "__unavailable__" else _voice

    with _voice_lock:
        if _voice is not None:
            return None if _voice == "__unavailable__" else _voice

        files = _ensure_voice_files()
        if files is None:
            _voice = "__unavailable__"
            return None
        try:
            from piper import PiperVoice  # noqa: PLC0415

            model, config = files
            _voice = PiperVoice.load(str(model), config_path=str(config))
            logger.info("Piper voice loaded: %s", model.name)
            return _voice
        except Exception as e:
            logger.warning("Piper voice failed to load: %s", e)
            _voice = "__unavailable__"
            return None


@router.post("/speak")
def speak(body: SpeakBody):
    """
    Renders text to a WAV the browser plays for the interviewer.

    204 means "no voice available" rather than an error: the caller falls back to
    the browser's own speech synthesis, and the question is on screen regardless.
    """
    voice = _get_voice()
    if voice is None:
        return Response(status_code=204)

    try:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            voice.synthesize_wav(body.text, wf)
        audio = buf.getvalue()
    except Exception as e:
        logger.warning("Speech synthesis failed: %s", e)
        return Response(status_code=204)

    return Response(
        content=audio,
        media_type="audio/wav",
        headers={"Cache-Control": "private, max-age=3600"},
    )
