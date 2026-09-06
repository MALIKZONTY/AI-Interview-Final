FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# ffmpeg decodes the answer clips and extracts the audio for transcription.
#
# The rest belong to MediaPipe: it links against OpenGL, EGL and GLES even when
# running purely on CPU, and the slim image ships none of them. Each missing one
# surfaces the same way — "FaceLandmarker init failed: libEGL.so.1 / libGLESv2.so.2:
# cannot open shared object file" — and quietly costs both the eye-contact score and
# the poster frame, since one pass produces them both. Listed together rather than
# discovered one deploy at a time.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        libegl1 \
        libgles2 \
        libgl1 \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# 7860 is what Hugging Face Spaces expects; Render and most other hosts inject $PORT.
ENV PORT=7860
EXPOSE 7860

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
