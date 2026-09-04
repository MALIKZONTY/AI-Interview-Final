---
title: AI Interview Service
emoji: 🎙️
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
app_port: 7860
---

# AI Interview Model Service

This is the FastAPI backend for the AI Interview platform, providing:
- Speech to Text (Faster-Whisper)
- Semantic Scoring (Sentence-Transformers)
- Video Analysis (Mediapipe)

## Deployment on Hugging Face Spaces

1. Create a new Space.
2. Select **Docker** SDK.
3. Upload the contents of this folder or sync with GitHub.
4. Set Secret variables in Space Settings:
   - `GROQ_API_KEY` (Optional fallback)
   - `OPENAI_API_KEY` (Optional)
