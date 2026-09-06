from __future__ import annotations
"""
AI microservice: question generation, speech-to-text + vocal delivery metrics,
eye-contact analysis, and answer scoring.
Designed to run standalone; the Node API calls these endpoints over HTTP.
"""

import os
from hmac import compare_digest
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Load services/ai-service/.env when running locally (uvicorn from repo root or this folder).
_env = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env)

from app.routers import analyze_video, evaluate, generate, speak, speech, finetune

app = FastAPI(title="Interview AI Service", version="1.0.0")

_origins = os.getenv("CORS_ORIGINS", "http://localhost:4000,http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def require_service_token(request, call_next):
    """
    Optional shared secret between the Node API and this service.

    A Hugging Face Space is reachable by anyone who knows the URL, and these
    endpoints spend a Groq key and CPU time. When AI_SERVICE_TOKEN is set, callers
    must present it; when it is unset — local development — nothing changes.
    Health checks stay open so the platform can still probe the container.
    """
    expected = os.getenv("AI_SERVICE_TOKEN")
    if expected and request.url.path not in ("/health", "/docs", "/openapi.json"):
        if not compare_digest(request.headers.get("x-service-token", ""), expected):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return await call_next(request)


app.include_router(generate.router, tags=["generate"])
app.include_router(speech.router, tags=["speech"])
app.include_router(speak.router, tags=["speak"])
app.include_router(evaluate.router, tags=["evaluate"])
app.include_router(analyze_video.router, tags=["video"])
app.include_router(finetune.router, tags=["finetune"])


@app.get("/health")
def health():
    return {"ok": True}
