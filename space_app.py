"""
Hugging Face Space entry point for the AI service.

The Docker SDK is a paid feature, so the Space runs on the Gradio SDK instead:
Hugging Face executes this file and proxies whatever is listening on port 7860.
The real application is the same FastAPI service the repository runs locally —
Whisper for transcription, MediaPipe for eye contact, Piper for the interviewer
voice — mounted here unchanged.

A small Gradio page is attached at /ui purely so the Space has something to show
when opened in a browser; every endpoint the Node API calls is served by FastAPI
at the paths it already expects.
"""

import sys
from pathlib import Path

# The service lives in a subdirectory. Its package is called `app`, which is also
# why this file is not named app.py — that would shadow the package on import.
SERVICE_ROOT = Path(__file__).resolve().parent / "services" / "ai-service"
sys.path.insert(0, str(SERVICE_ROOT))

from app.main import app as api  # noqa: E402


def _build_status_page():
    """Optional landing page. Never let a UI problem stop the API from serving."""
    try:
        import gradio as gr  # noqa: PLC0415
    except ImportError:
        return None

    with gr.Blocks(title="Interview AI Service") as page:
        gr.Markdown(
            "### Interview AI Service\n"
            "Backend for the AI Interview app: transcription, vocal delivery metrics, "
            "eye contact, question generation and the interviewer voice.\n\n"
            "This Space exposes an HTTP API rather than a user interface. "
            "See `/docs` for the endpoints."
        )
    return page


def build_app():
    page = _build_status_page()
    if page is None:
        return api
    import gradio as gr  # noqa: PLC0415

    # Mount the UI onto the FastAPI app so both are served by one ASGI app.
    return gr.mount_gradio_app(api, page, path="/ui")


# Exposed under the names a launcher might look for, in case the platform imports
# this file rather than executing it.
app = build_app()
application = app
demo = app


def _serve() -> None:
    """
    Run the server and block.

    Hugging Face executes this file and expects the process to stay up; defining
    the app and returning ends the container immediately. A redeploy can also leave
    the previous process holding 7860 for a few seconds, which killed one earlier
    attempt outright, so give the port a short while to come free before giving up.
    """
    import os
    import socket
    import time

    import uvicorn

    port = int(os.getenv("PORT", "7860"))
    deadline = time.monotonic() + 60

    while time.monotonic() < deadline:
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("0.0.0.0", port))
        except OSError:
            print(f"port {port} still held by a previous process; retrying", flush=True)
            time.sleep(3)
            continue
        finally:
            probe.close()
        break

    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    _serve()
