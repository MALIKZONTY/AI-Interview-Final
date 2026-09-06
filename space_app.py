"""
Hugging Face Space entry point for the AI service.

The Docker SDK is a paid feature, so the Space runs on the Gradio SDK instead:
Hugging Face executes this file and proxies whatever is listening on port 7860.
The real application is the same FastAPI service the repository runs locally —
Whisper for transcription, MediaPipe for eye contact, Piper for the interviewer
voice — mounted here unchanged.

Gradio owns the HTTP server here — the Space runtime starts it and it cannot be
displaced — so the FastAPI service is mounted onto the app Gradio builds. Gradio
answers its own routes; everything else falls through to the API at the paths the
Node client already expects.

Nothing ASGI is exposed at module level on purpose. The Space runs Gradio's
hot-reloader, which scans this module for a name called `demo` and launches
whatever it finds; handed a FastAPI it tried to launch that as a Blocks and
brought the container down. Everything is built inside _serve() instead.
"""

import os
import sys
from pathlib import Path

# The service lives in a subdirectory. Its package is called `app`, which is also
# why this file is not named app.py — that would shadow the package on import.
SERVICE_ROOT = Path(__file__).resolve().parent / "services" / "ai-service"
sys.path.insert(0, str(SERVICE_ROOT))

from app.main import app as api  # noqa: E402


def _serve() -> None:
    """
    Hand the port to Gradio and attach the API to the server it starts.

    Gradio 6 runs a Node SSR frontend on 7860, launched by the Space runtime itself,
    so binding uvicorn here always lost the port. Letting Gradio launch and then
    mounting the FastAPI service onto the app it created puts both behind the one
    server: Gradio answers its own routes, everything else falls through to the API.
    """
    import inspect
    import threading

    import gradio as gr

    with gr.Blocks(title="Interview AI Service") as page:
        gr.Markdown(
            "### Interview AI Service\n"
            "Backend for the AI Interview app: transcription, vocal delivery metrics, "
            "eye contact, question generation and the interviewer voice.\n\n"
            "This Space serves an HTTP API rather than a user interface. "
            "See `/docs` for the endpoints."
        )

    # Gradio's launch signature moves between majors — 6 dropped show_api, for
    # instance — so pass only what this installed version actually accepts rather
    # than crashing the Space on an unknown keyword.
    wanted = {
        "server_name": "0.0.0.0",
        "server_port": int(os.getenv("PORT", "7860")),
        # SSR puts a Node process in front of Python and hides the mounted routes.
        "ssr_mode": False,
        "prevent_thread_lock": True,
        "show_api": False,
        "quiet": True,
    }
    accepted = set(inspect.signature(page.launch).parameters)
    kwargs = {k: v for k, v in wanted.items() if k in accepted}
    dropped = sorted(set(wanted) - set(kwargs))
    if dropped:
        print(f"gradio {gr.__version__} does not accept: {', '.join(dropped)}", flush=True)
    page.launch(**kwargs)

    # Mounted after launch because Gradio only builds its FastAPI app during it.
    page.app.mount("/", api)
    print("AI service mounted; API routes are live", flush=True)

    threading.Event().wait()


if __name__ == "__main__":
    _serve()
