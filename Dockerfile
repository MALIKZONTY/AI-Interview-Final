# Container image for the Python AI service — Whisper, MediaPipe and Piper.
#
# NOT what Hugging Face builds. The Docker SDK is a paid Space feature, so the
# Space runs on the Gradio SDK via space_app.py instead. This file is here for
# any host that takes a Dockerfile: Cloud Run, Fly, Koyeb, or a paid HF Space.

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ffmpeg decodes the answer clips and extracts the audio track for transcription.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Spaces run as uid 1000; everything the service writes must be under its home.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH
WORKDIR /home/user/app

COPY --chown=user services/ai-service/requirements.txt ./
RUN pip install --no-cache-dir --user -r requirements.txt

COPY --chown=user services/ai-service/app ./app

# Model caches: both must be writable, and both are lost when the Space restarts.
ENV HF_HOME=/home/user/.cache/huggingface \
    PIPER_VOICE_DIR=/home/user/.models/piper \
    FACE_LANDMARKER_MODEL=/home/user/.models/face_landmarker.task \
    PORT=7860

EXPOSE 7860

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
