#!/usr/bin/env bash
#
# Publish the Python AI service to its Hugging Face Space.
#
# The Space runs the Docker SDK, so it wants the service at the root of its own
# repository — Dockerfile, requirements.txt and the app package — which is exactly
# the shape of services/ai-service. Nothing else is sent: pushing the whole monorepo
# fails anyway, since Hugging Face rejects the GLB avatar and branding PNGs under
# apps/web unless they sit in its LFS storage, and the Space has no use for them.
#
# Usage:  bash scripts/deploy-hf-space.sh
# Auth:   username is your HF account, password is a WRITE token from
#         https://huggingface.co/settings/tokens
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SPACE_URL="${SPACE_URL:-$(git remote get-url space 2>/dev/null || true)}"
if [[ -z "$SPACE_URL" ]]; then
  echo "No 'space' remote and no SPACE_URL set." >&2
  echo "  git remote add space https://huggingface.co/spaces/<user>/<space>" >&2
  exit 1
fi

SERVICE="services/ai-service"
for f in "$SERVICE/Dockerfile" "$SERVICE/requirements.txt"; do
  [[ -f "$f" ]] || { echo "Missing required file: $f" >&2; exit 1; }
done

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp "$SERVICE/Dockerfile" "$STAGE/Dockerfile"
cp "$SERVICE/requirements.txt" "$STAGE/requirements.txt"
# Caches, macOS cruft and local model bundles must not travel; the image rebuilds them.
rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude '.DS_Store' \
      --exclude '.models' --exclude '.env' "$SERVICE/app/" "$STAGE/app/"

# The Space needs its own card: Hugging Face reads the SDK and port from this front
# matter, while the repository README describes the whole project.
cat > "$STAGE/README.md" <<'CARD'
---
title: Interview AI Service
emoji: 🎤
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Interview AI Service

Backend for the AI Interview app. Serves an HTTP API rather than a user interface.

| Endpoint | Purpose |
| --- | --- |
| `POST /generate-questions` | interview questions from a topic or a resume |
| `POST /generate-followup` | decides whether to probe the previous answer |
| `POST /speech-to-text` | transcript plus vocal delivery metrics |
| `POST /analyze-video` | eye contact and on-camera presence |
| `POST /evaluate-answer` | correctness and confidence scores |
| `POST /speak` | the interviewer's voice |
| `GET /health` | liveness |

Whisper, MediaPipe and Piper weights download on first use.

Setting `AI_SERVICE_TOKEN` requires an `x-service-token` header on every endpoint
except `/health`; leaving it unset accepts unauthenticated calls.
CARD

# Guard the thing that broke the first attempt at this.
if find "$STAGE" -type f \( -name '*.glb' -o -name '*.png' -o -name '*.jpg' \
     -o -name '*.onnx' -o -name '*.task' -o -name '*.bin' \) | grep -q .; then
  echo "Refusing to push: binary files ended up in the staged tree." >&2
  exit 1
fi

echo "Staging $(find "$STAGE" -type f | wc -l | tr -d ' ') files ($(du -sh "$STAGE" | cut -f1))"

cd "$STAGE"
git init -q -b main
git add -A
git -c user.email=deploy@local -c user.name=deploy commit -q \
  -m "Deploy AI service from $(cd "$REPO_ROOT" && git rev-parse --short HEAD)"

SAFE_URL="$(printf '%s' "$SPACE_URL" | sed -E 's#//[^@/]+@#//#')"
echo
echo "Pushing to $SAFE_URL"
echo
git push --force "$SPACE_URL" main
echo
echo "Done. Watch the build under the Space's Logs tab."
