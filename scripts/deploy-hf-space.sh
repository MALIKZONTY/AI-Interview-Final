#!/usr/bin/env bash
#
# Publish the Python AI service to its Hugging Face Space.
#
# The Space cannot simply mirror this repository. Hugging Face rejects binary files
# that are not in its LFS/Xet storage, and apps/web carries a GLB avatar and three
# branding PNGs — none of which the Space has any use for, since it runs only the
# Python service. So this assembles a clean tree containing just what the Space
# needs (~350KB) and force-pushes that as a single commit.
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

# Everything the Space reads. Paths are relative to the repo root and keep their
# layout, because space_app.py imports from services/ai-service and the root
# requirements.txt includes that directory's own list.
FILES=(
  README.md              # Space metadata: sdk, app_file, title
  space_app.py           # entry point Hugging Face runs
  requirements.txt       # python deps (pulls in the service's list)
  packages.txt           # apt packages, i.e. ffmpeg
)
DIRS=(
  services/ai-service/app
)
EXTRA_FILES=(
  services/ai-service/requirements.txt
)

for f in "${FILES[@]}" "${EXTRA_FILES[@]}"; do
  [[ -f "$f" ]] || { echo "Missing required file: $f" >&2; exit 1; }
done

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

for f in "${FILES[@]}" "${EXTRA_FILES[@]}"; do
  mkdir -p "$STAGE/$(dirname "$f")"
  cp "$f" "$STAGE/$f"
done
for d in "${DIRS[@]}"; do
  mkdir -p "$STAGE/$(dirname "$d")"
  # Caches, macOS cruft and local model bundles must not travel; the Space rebuilds them.
  rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude '.DS_Store' \
        --exclude '.models' --exclude '.env' "$d/" "$STAGE/$d/"
done

# Guard the exact thing that broke the first attempt.
if find "$STAGE" -type f \( -name '*.glb' -o -name '*.png' -o -name '*.jpg' \
     -o -name '*.onnx' -o -name '*.task' -o -name '*.bin' \) | grep -q .; then
  echo "Refusing to push: binary files ended up in the staged tree." >&2
  find "$STAGE" -type f \( -name '*.glb' -o -name '*.png' -o -name '*.onnx' \) >&2
  exit 1
fi

echo "Staging $(find "$STAGE" -type f | wc -l | tr -d ' ') files ($(du -sh "$STAGE" | cut -f1))"

cd "$STAGE"
git init -q -b main
git add -A
git -c user.email=deploy@local -c user.name=deploy commit -q \
  -m "Deploy AI service from $(cd "$REPO_ROOT" && git rev-parse --short HEAD)"

echo
echo "Pushing to $SPACE_URL"
echo "  username: your Hugging Face account name"
echo "  password: a WRITE token, not your account password"
echo
git push --force "$SPACE_URL" main
echo
echo "Done. Watch the build under the Space's Logs tab."
