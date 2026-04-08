from __future__ import annotations
"""
Scores answers using:
- Correctness: alignment with expected answer AND relevance to the actual question (topic).
- Semantic similarity (MiniLM) + TF-IDF + keyword overlap where available.
- Confidence: gaze/face-center proxy, head stability (motion + drift), transcript fillers & pause-like patterns.
"""

import re
import os
import json
from typing import Any

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel, Field
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.parser import client

router = APIRouter()

_embed_model: object | None = None


def _get_embed_model():
    global _embed_model
    if _embed_model == "__skip__":
        return None
    if _embed_model is not None:
        return _embed_model
    try:
        from sentence_transformers import SentenceTransformer

        _embed_model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        return _embed_model
    except Exception:
        _embed_model = "__skip__"
        return None


class EvaluateBody(BaseModel):
    question: str
    expected_answer: str
    acceptable_variants: list[str] = []
    keywords: list[str] = []
    evaluation_rubric: dict[str, Any] = {}
    candidate_answer: str
    speech_meta: dict[str, Any] | None = None
    video_meta: dict[str, Any] | None = None

class LLMCorrectnessResult(BaseModel):
    correctness_score: float = Field(description="Score between 0 and 100")
    reasoning: str = Field(description="Brief explanation of the score")

async def _llm_correctness(body: EvaluateBody) -> LLMCorrectnessResult | None:
    """Uses Groq to judge the correctness of the candidate answer based on the rubric."""
    try:
        model_name = os.getenv("OPENAI_MODEL", "llama-3.3-70b-versatile")
        
        system_prompt = f"""
        You are an expert technical interviewer. 
        Evaluate the candidate's answer based on the following context:
        
        QUESTION: {body.question}
        EXPECTED ANSWER: {body.expected_answer}
        VARIANTS: {", ".join(body.acceptable_variants) if body.acceptable_variants else "None provided"}
        KEYWORDS TO LOOK FOR: {", ".join(body.keywords) if body.keywords else "None explicitly required"}
        SPECIFIC RUBRIC: {json.dumps(body.evaluation_rubric)}
        
        Compare the CANDIDATE ANSWER below to these requirements.
        Be encouraging and fair. If the answer covers the core concepts or related technical ideas, award generous partial credit. 
        Focus on whether the candidate understands the "spirit" of the question even if they miss specific keywords or phrasing.
        
        You MUST return ONLY a JSON object with:
        "correctness_score": (float, 0-100)
        "reasoning": (string, 1-2 sentences explaining the score based on the rubric)
        """
        
        completion = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"CANDIDATE ANSWER: {body.candidate_answer}"}
            ],
            response_format={"type": "json_object"},
            temperature=0.2
        )
        
        return LLMCorrectnessResult.model_validate_json(completion.choices[0].message.content)
    except Exception as e:
        print(f"LLM Evaluation failed: {e}")
        return None


def _tokens(text: str) -> set[str]:
    return {t.lower() for t in re.findall(r"[A-Za-z0-9+#]{3,}", text)}


def _keyword_score(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta:
        return 50.0
    overlap = len(ta & tb)
    return min(100.0, overlap / max(len(ta), 1) * 120)


def _cosine_tfidf(a: str, b: str) -> float:
    if not a.strip() or not b.strip():
        return 0.0
    vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2))
    try:
        m = vec.fit_transform([a, b])
        sim = cosine_similarity(m[0], m[1])[0][0]
        return float(max(0.0, min(1.0, sim)) * 100)
    except ValueError:
        return 0.0


def _semantic_pair(a: str, b: str) -> float | None:
    if not a.strip() or not b.strip():
        return 0.0
    model = _get_embed_model()
    if model is None:
        return None
    try:
        emb = model.encode(
            [a, b],
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
        dot = float(np.dot(emb[0], emb[1]))
        return max(0.0, min(100.0, (dot + 1.0) / 2.0 * 100.0))
    except Exception:
        return None


_FILLER_RE = re.compile(
    r"\b(um|uh|uhm|erm|er|ah|hmm|hm|like|you know|basically|actually|sort of|kind of|i mean)\b",
    re.IGNORECASE,
)


def _speech_delivery_from_text(text: str) -> dict[str, float]:
    """Filler density and pause-like patterns from transcript (no word timestamps)."""
    t = (text or "").strip()
    if not t:
        return {"filler_rate": 0.0, "pause_proxy": 0.0, "word_count": 0.0}

    words = re.findall(r"[A-Za-z']+", t)
    n = max(len(words), 1)
    fillers = len(_FILLER_RE.findall(t))
    filler_rate = (fillers / n) * 100.0

    # Heuristic pause / disfluency signals in text
    pause_hits = len(re.findall(r"\.\.\.|…|,{2,}", t))
    long_gaps = len(re.findall(r"\s{4,}", t))
    pause_proxy = min(
        100.0,
        (pause_hits * 8.0 + long_gaps * 5.0) / max(n / 12.0, 1.0),
    )

    return {
        "filler_rate": float(filler_rate),
        "pause_proxy": float(pause_proxy),
        "word_count": float(len(words)),
    }


def _relevance_score(question: str, candidate: str) -> tuple[float, dict[str, float | None]]:
    """How much the answer is on-topic for the question (0–100)."""
    cos_q = _cosine_tfidf(question, candidate)
    key_q = _keyword_score(question, candidate)
    sem_q = _semantic_pair(question, candidate)
    if sem_q is not None:
        rel = float(np.clip(0.52 * sem_q + 0.28 * cos_q + 0.20 * key_q, 0, 100))
    else:
        rel = float(np.clip(0.62 * cos_q + 0.38 * key_q, 0, 100))
    return rel, {"semantic_q": sem_q, "tfidf_q": cos_q, "keyword_q": key_q}


def _base_correctness(expected: str, candidate: str, variants: list[str], required_keywords: list[str]) -> tuple[float, dict[str, float | None]]:
    # 1. Test highest semantic match among expected + variants
    all_targets = [expected] + [v for v in variants if str(v).strip()]
    best_sem = 0.0
    best_cos = 0.0
    best_key = 0.0
    
    for target in all_targets:
        cos = _cosine_tfidf(target, candidate)
        key = _keyword_score(target, candidate)
        sem = _semantic_pair(target, candidate)
        
        if sem is not None and sem > best_sem:
            best_sem = sem
        if cos > best_cos:
            best_cos = cos
        if key > best_key:
            best_key = key
            
    # 2. Check keyword hit rate natively
    hit_rate = 0.0
    if required_keywords:
        cand_lower = candidate.lower()
        hits = sum(1 for kw in required_keywords if str(kw).lower() in cand_lower)
        hit_rate = (hits / len(required_keywords)) * 100.0

    if best_sem is not None:
        # Heavily weight semantics, but ensure keyword hit rate supplements
        base = float(np.clip(0.40 * best_sem + 0.20 * best_cos + 0.20 * best_key + 0.20 * hit_rate, 0, 100))
    else:
        base = float(np.clip(0.45 * best_cos + 0.35 * best_key + 0.20 * hit_rate, 0, 100))
        
    return base, {"semantic": best_sem, "tfidf": best_cos, "keyword": best_key, "keyword_hit_rate": hit_rate}


@router.post("/evaluate-answer")
async def evaluate_answer(body: EvaluateBody):
    cand = (body.candidate_answer or "").strip()
    if not cand:
        return {
            "correctness_score": 0.0,
            "confidence_score": 0.0,
            "debug": {"reason": "empty_transcript"},
        }

    # 1. Try LLM Correctness first (High accuracy)
    llm_res = await _llm_correctness(body)
    
    dbg_q = {}
    if llm_res:
        correctness = llm_res.correctness_score
        dbg_exp = {"method": "groq_llm", "reasoning": llm_res.reasoning}
        relevance = 100.0 # LLM already accounts for relevance
        rel_factor = 1.0
    else:
        # 2. Fallback to Local AI Heuristics
        base, dbg_exp = _base_correctness(
            body.expected_answer, 
            cand, 
            body.acceptable_variants, 
            body.keywords
        )
        relevance, dbg_q = _relevance_score(body.question, cand)
        
        # Strong gate: high correctness only if the answer relates to the question
        if relevance < 22:
            rel_factor = 0.12 + 0.35 * (relevance / 22.0)
        elif relevance < 45:
            rel_factor = 0.47 + 0.40 * ((relevance - 22) / 23.0)
        else:
            rel_factor = 0.87 + 0.13 * min(1.0, (relevance - 45) / 55.0)

        correctness = float(np.clip(base * rel_factor, 0, 100))
        dbg_exp["method"] = "local_heuristics"

    vm = body.video_meta or {}
    gaze = float(vm.get("gaze_center_score", vm.get("eye_contact_proxy", 55)))
    eye = float(vm.get("eye_contact_proxy", 60))
    head = float(vm.get("head_stability", 60))
    face = float(vm.get("face_detected_ratio", 0.5))
    _facing_raw = vm.get("facing_camera_avg")
    try:
        facing_cam = float(_facing_raw) if _facing_raw is not None else -1.0
    except (TypeError, ValueError):
        facing_cam = -1.0
    mp_gaze = bool(vm.get("gaze_mediapipe_used", False))
    face_area_ratio = float(vm.get("face_area_ratio_avg", -1.0))
    pos_var = float(vm.get("face_position_variance", 0.05))
    motion = float(vm.get("head_motion_mean", 6))
    motion_p90 = float(vm.get("head_motion_p90", motion))
    std_off = float(vm.get("gaze_offset_std", 0.0))

    motion_signal = 0.65 * motion + 0.35 * motion_p90

    def _db(x: float, floor: float, scale: float) -> float:
        """Ignore small jitter; only charge above `floor`."""
        return max(0.0, x - floor) * scale

    # Subtractive drift: visible face movement / wandering should cost confidence
    drift_pen = min(
        58.0,
        _db(pos_var, 0.011, 520.0)
        + _db(motion_signal, 7.0, 0.78)
        + _db(std_off, 0.034, 265.0),
    )
    # Strong eye + gaze on screen → less subtractive drift (micro-motion while locked on camera)
    _eng_pre = (eye + gaze) / 200.0
    moving = motion_signal > 11.8 or pos_var > 0.021
    if moving:
        drift_pen = min(58.0, drift_pen * 1.12)
    if _eng_pre >= 0.64 and not moving:
        if not mp_gaze or facing_cam < 0 or facing_cam >= 68.0:
            drift_pen *= 0.72
        else:
            t = min(1.0, max(0.0, (facing_cam - 54.0) / 14.0))
            drift_pen *= 0.84 - 0.12 * t
    elif _eng_pre >= 0.54 and not moving:
        if not mp_gaze or facing_cam < 0 or facing_cam >= 62.0:
            drift_pen *= 0.84
        else:
            drift_pen *= 0.92

    speech = _speech_delivery_from_text(cand)
    if body.speech_meta:
        try:
            speech["filler_rate"] = max(
                speech["filler_rate"],
                float(body.speech_meta.get("filler_rate", 0)),
            )
            speech["pause_proxy"] = max(
                speech["pause_proxy"],
                float(body.speech_meta.get("pause_proxy", 0)),
            )
        except (TypeError, ValueError):
            pass

    filler_rate = speech["filler_rate"]
    pause_proxy = speech["pause_proxy"]
    word_count = float(speech.get("word_count", 0.0))

    # Gaze-heavy blend: steady head cannot compensate for eyes off-camera
    gaze_component = 0.38 * eye + 0.30 * gaze
    stability_component = 0.26 * head + 0.06 * min(100.0, face * 100.0)
    confidence = gaze_component + stability_component
    confidence = float(np.clip(confidence - drift_pen, 0, 100))

    # Restlessness: lower floors so “moving face around” registers
    r_pos = (max(0.0, pos_var - 0.013) * 24.0) ** 0.9 * 0.44
    r_mot = (max(0.0, motion_signal - 8.5) / 21.0) ** 1.05 * 0.48
    r_std = (max(0.0, std_off - 0.048) / 0.095) ** 1.0 * 0.40
    restlessness = min(1.0, r_pos + r_mot + r_std)
    
    engagement = (eye + gaze) / 200.0
    # Only strong, frontal gaze earns heavy restlessness forgiveness
    if engagement >= 0.68:
        if not mp_gaze or facing_cam < 0 or facing_cam >= 72.0:
            restlessness *= 0.52
        else:
            restlessness *= 0.68
    elif engagement >= 0.55:
        if not mp_gaze or facing_cam < 0 or facing_cam >= 65.0:
            restlessness *= 0.72
        else:
            restlessness *= 0.82
    # Low eye contact + clearly restless: drop confidence hard
    if engagement < 0.42 and restlessness > 0.14:
        restlessness = min(1.0, restlessness * (1.12 + 0.5 * (0.42 - engagement))) # Softened multiplier
    if moving and engagement < 0.58:
        restlessness = min(1.0, restlessness * 1.08) # Softened
        
    confidence *= max(0.45, 1.0 - 0.40 * restlessness) # Softened weight (0.82 -> 0.40) and floor (0.15 -> 0.45)
    confidence = float(np.clip(confidence, 0, 100))

    # Softer speech penalties; STT often adds commas / false positives — not true disfluency
    filler_pen = min(22.0, filler_rate * 0.62)
    pause_pen = min(18.0, pause_proxy * 0.32)
    gaze_floor = min(eye, gaze)
    # Do not let fluent speech mask poor on-camera attention
    if engagement >= 0.60 and gaze_floor >= 58.0:
        filler_pen *= 0.74
        pause_pen *= 0.72
    if (
        engagement >= 0.60
        and gaze_floor >= 58.0
        and word_count >= 45
        and filler_rate < 8.0
        and pause_proxy < 18.0
    ):
        filler_pen *= 0.58
        pause_pen *= 0.58
    confidence = float(np.clip(confidence - filler_pen - pause_pen, 0, 100))

    # Weakest link: both eyes proxy and gaze must be decent or confidence collapses
    if gaze_floor < 48:
        confidence *= float(np.clip(0.32 + 0.014 * gaze_floor, 0.22, 1.0))
    elif gaze_floor < 58:
        confidence *= float(0.62 + 0.038 * (gaze_floor - 48))

    if mp_gaze and facing_cam >= 0.0 and facing_cam < 60.0:
        confidence *= float(np.clip(0.52 + 0.48 * (facing_cam / 60.0), 0.42, 1.0))
    elif mp_gaze and facing_cam >= 0.0 and facing_cam < 74.0:
        confidence *= float(0.84 + 0.16 * ((facing_cam - 60.0) / 14.0))

    # Tiny bump only when genuinely steady, frontal, and calm
    if (
        engagement >= 0.68
        and restlessness < 0.09
        and not moving
        and filler_rate < 8.0
        and gaze_floor >= 64.0
    ):
        if not mp_gaze or facing_cam < 0 or facing_cam >= 74.0:
            confidence = min(100.0, confidence + 0.65 * (1.0 - restlessness * 4.0))
    if (
        engagement >= 0.74
        and drift_pen < 4.0
        and filler_rate < 6.0
        and not moving
        and gaze_floor >= 68.0
    ):
        if not mp_gaze or facing_cam < 0 or facing_cam >= 76.0:
            confidence = min(100.0, confidence + 0.9)

    # Extra guard: tiny face in frame (far from camera) cannot score like a close-up — Haar has no real gaze
    if face_area_ratio >= 0.0 and face_area_ratio < 0.041:
        confidence *= float(np.clip(0.52 + 11.5 * face_area_ratio, 0.48, 0.92))

    dbg_exp.update(
        {
            "relevance_to_question": relevance,
            "relevance_factor": rel_factor,
            "filler_rate": filler_rate,
            "pause_proxy": pause_proxy,
            "drift_penalty": drift_pen,
            "restlessness_factor": round(restlessness, 4),
            "engagement_proxy": round(engagement, 4),
            "face_area_ratio_avg": round(face_area_ratio, 5) if face_area_ratio >= 0 else None,
            "facing_camera_avg": round(facing_cam, 2) if facing_cam >= 0 else None,
            "gaze_mediapipe_used": mp_gaze,
            "gaze_floor": round(gaze_floor, 2),
            "motion_proxy_high": moving,
        }
    )
    dbg_exp.update({f"q_{k}": v for k, v in dbg_q.items()})

    return {
        "correctness_score": round(correctness, 2),
        "confidence_score": round(confidence, 2),
        "debug": dbg_exp,
    }
