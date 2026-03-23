#!/usr/bin/env bash
# Start the AI service from the correct folder (fixes "No module named 'app'").
# Usage: from repo root: bash services/ai-service/run-dev.sh
#        or: cd services/ai-service && ./run-dev.sh

set -e
cd "$(dirname "$0")"

if [ -f .venv/bin/activate ]; then
  # shellcheck source=/dev/null
  source .venv/bin/activate
else
  echo "Tip: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
fi

# Uvicorn still watches the whole cwd when `--reload-dir` is a subfolder (it re-adds cwd).
# `--reload-exclude` must be absolute: Uvicorn's filter compares relative `.venv` badly vs WatchFiles paths.
VENV_EXCLUDE=()
if [ -d .venv ]; then
  VENV_EXCLUDE=(--reload-exclude "$(pwd)/.venv")
fi
exec python -m uvicorn app.main:app --reload --reload-dir app "${VENV_EXCLUDE[@]}" --host 0.0.0.0 --port 8000
