# Models and data (local / open — no OpenAI API)

This project uses **pretrained open models** and **heuristics**. We do **not** ship multi‑gigabyte training datasets inside the repo; instead we document where public data lives if you want to fine‑tune later.

---

## What runs in `services/ai-service`

| Capability | Approach | “Big data” background |
|------------|----------|------------------------|
| **Question generation** | Large hand-authored **template bank** (`app/data/question_bank.py`) shuffled per request | No ML training; templates mimic interview corpora. To train a generative model, see dataset ideas below. |
| **Speech → text** | **[faster-whisper](https://github.com/SYSTRAN/faster-whisper)** (Whisper checkpoints) | Original Whisper paper used **680k hours** of weakly labeled web audio. Weights are downloaded automatically (Hugging Face) on first transcription. |
| **Answer correctness** | **[sentence-transformers](https://www.sbert.net/)** `all-MiniLM-L6-v2` + TF‑IDF + keywords | MiniLM family pretrained on **multiple NLP tasks** (NLI, etc.). We combine embedding cosine similarity with lexical overlap. |
| **Video / confidence** | **[MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/face_mesh) Face Mesh** (`refine_landmarks=True`) for **iris vs eye-opening** gaze proxy + OpenCV motion; **Haar fallback** if MediaPipe is unavailable or misses the face | Face Mesh is a pretrained model; Haar is classical (Viola–Jones). Optional datasets for future fine‑tuning are listed below. |

---

## Public datasets useful if you **train or fine‑tune** later

These are **not** vendored in git; download under their licenses.

- **Speech / ASR**  
  - [Mozilla Common Voice](https://commonvoice.mozilla.org/)  
  - [LibriSpeech](https://www.openslr.org/12)  
  - [VoxPopuli](https://github.com/facebookresearch/voxpopuli)  

- **Text similarity / QA / interviews (research)**  
  - [MS MARCO](https://microsoft.github.io/msmarco/)  
  - [Natural Questions](https://ai.google.com/research/NaturalQuestions)  
  - Academic “mock interview” or **HR interview Q&A** papers (search Semantic Scholar) — often small; combine with synthetic generation.

- **Video / face / attention proxies**  
  - [VGGFace2](http://www.robots.ox.ac.uk/~vgg/data/vgg_face2/)  
  - [CelebA](https://mmlab.ie.cuhk.edu.hk/projects/CelebA.html)  
  - [AVA](https://research.google.com/ava/) (actions in video)

---

## Environment knobs (`services/ai-service/.env`)

| Variable | Purpose |
|----------|---------|
| `WHISPER_MODEL_SIZE` | `tiny`, `base`, `small`, `medium`, `large-v3` — larger = better quality, slower/heavier |
| `WHISPER_DEVICE` | `cpu` or `cuda` |
| `WHISPER_COMPUTE_TYPE` | e.g. `int8`, `float16` (GPU) |
| `WHISPER_LANGUAGE` | Optional ISO code (e.g. `en`) to force language |

**CPU tip:** `tiny` or `base` + `int8` is a good default for laptops.

---

## Why we don’t “train everything in-repo”

End-to-end training for ASR, video understanding, and generative questions each needs **labeled data, GPUs, and experiment tracking**. This codebase optimizes for **reproducible local inference** using **published checkpoints** and **transparent rules**, while keeping the door open for your own fine-tuning using the dataset links above.
