from __future__ import annotations
"""
Scores answers using:
- Correctness: alignment with expected answer AND relevance to the actual question (topic).
- Semantic similarity (MiniLM) + TF-IDF + keyword overlap where available.
- Confidence: vocal delivery only — pace, fillers, pauses, energy steadiness and projection.
  See app/voice.py. No camera signal is involved anywhere in scoring.
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
from app.voice import confidence_from_voice

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
    voice_meta: dict[str, Any] | None = None
    video_meta: dict[str, Any] | None = None

class LLMCorrectnessResult(BaseModel):
    correctness_score: float = Field(description="Score between 0 and 100")
    reasoning: str = Field(description="Brief explanation of the technical score")
    feedback: str = Field(description="Natural, supportive feedback addressing both technical quality and behavioral delivery")

class SummaryBody(BaseModel):
    avg_correctness: float
    avg_confidence: float
    interview_history: list[dict[str, str]] = Field(description="List of {'question': '...', 'answer': '...'} pairs")

class SummaryResult(BaseModel):
    summary: str = Field(description="A holistic, 3-4 sentence expert review/feedback for the whole interview")

async def _llm_correctness(body: EvaluateBody, behavioral_context: str = "") -> LLMCorrectnessResult | None:
    """Uses Groq to judge the correctness of the candidate answer based on the rubric and behavioral context."""
    try:
        model_name = os.getenv("OPENAI_MODEL", "openai/gpt-oss-20b")
        
        system_prompt = f"""
        You are an expert technical interviewer. 
        Evaluate the candidate's answer based on the following context:
        
        QUESTION: {body.question}
        EXPECTED ANSWER: {body.expected_answer}
        VARIANTS: {", ".join(body.acceptable_variants) if body.acceptable_variants else "None provided"}
        KEYWORDS TO LOOK FOR: {", ".join(body.keywords) if body.keywords else "None explicitly required"}
        Compare the CANDIDATE ANSWER below to these requirements.
        Be encouraging and fair. If the answer covers the core concepts or related technical ideas, award generous partial credit. 
        Focus on whether the candidate understands the "spirit" of the question even if they miss specific keywords or phrasing.
        
        BEHAVIORAL CONTEXT: {behavioral_context}
        
        You MUST return ONLY a JSON object with:
        "correctness_score": (float, 0-100)
        "reasoning": (string, 1-2 sentences explaining the technical score)
        "feedback": (string, 2-3 sentences. Talk naturally like a mentor. Mention what they mentioned well, what they missed, AND touch upon their delivery based on the behavioral context provided. Use a supportive tone.)
        """
        
        completion = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"CANDIDATE ANSWER: {body.candidate_answer}"}
            ],
            response_format={"type": "json_object"},
            temperature=0.3
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
            "debug": {
                "reason": "transcript_missing",
                "feedback": "I couldn't hear your answer! Please make sure your microphone is working and that FFmpeg is installed on the server to process the recording."
            },
        }

    # 1. Vocal delivery first, so the LLM can speak to *how* the answer was given.
    voice = dict(body.voice_meta or {})

    # Text-derived fillers still apply when the audio pipeline gave us nothing to work with.
    text_speech = _speech_delivery_from_text(cand)
    if voice.get("word_count") is None:
        voice["word_count"] = text_speech["word_count"]
    if voice.get("filler_rate") is None:
        voice["filler_rate"] = text_speech["filler_rate"]
    if body.speech_meta:
        try:
            voice["filler_rate"] = max(
                float(voice.get("filler_rate") or 0.0),
                float(body.speech_meta.get("filler_rate", 0)),
            )
        except (TypeError, ValueError):
            pass

    confidence, voice_breakdown, behavioral_context = confidence_from_voice(voice, body.video_meta)

    filler_rate = float(voice.get("filler_rate") or 0.0)
    word_count = float(voice.get("word_count") or 0.0)

    # 2. Call LLM for Technical Correctness + Synthesis of Feedback
    llm_res = await _llm_correctness(body, behavioral_context)
    
    dbg_q = {}
    if llm_res:
        correctness = llm_res.correctness_score
        dbg_exp = {
            "method": "groq_llm", 
            "reasoning": llm_res.reasoning,
            "feedback": llm_res.feedback
        }
        relevance = 100.0
        rel_factor = 1.0
    else:
        # Fallback
        base, dbg_exp = _base_correctness(
            body.expected_answer, 
            cand, 
            body.acceptable_variants, 
            body.keywords
        )
        relevance, dbg_q = _relevance_score(body.question, cand)
        
        if relevance < 22:
            rel_factor = 0.12 + 0.35 * (relevance / 22.0)
        elif relevance < 45:
            rel_factor = 0.47 + 0.40 * ((relevance - 22) / 23.0)
        else:
            rel_factor = 0.87 + 0.13 * min(1.0, (relevance - 45) / 55.0)

        correctness = float(np.clip(base * rel_factor, 0, 100))
        dbg_exp["method"] = "local_heuristics"
        dbg_exp["feedback"] = "Good attempt! Make sure to cover more technical keywords to improve your score."

    dbg_exp.update(
        {
            "relevance_to_question": relevance,
            "relevance_factor": rel_factor,
            "word_count": word_count,
            "filler_rate": round(filler_rate, 2),
            "wpm": voice.get("wpm"),
            "pause_count": voice.get("pause_count"),
            "long_pause_count": voice.get("long_pause_count"),
            "pause_ratio": voice.get("pause_ratio"),
            "speaking_ratio": voice.get("speaking_ratio"),
            "lead_in_seconds": voice.get("lead_in_seconds"),
            "energy_mean": voice.get("energy_mean"),
            "energy_cv": voice.get("energy_cv"),
            "expressiveness": (body.video_meta or {}).get("expressiveness"),
            "composure": (body.video_meta or {}).get("composure"),
            "voice_breakdown": voice_breakdown,
            "delivery_notes": behavioral_context,
        }
    )
    dbg_exp.update({f"q_{k}": v for k, v in dbg_q.items()})

    return {
        "correctness_score": round(correctness, 2),
        "confidence_score": round(confidence, 2),
        "debug": dbg_exp,
    }

@router.post("/generate-summary-feedback")
async def generate_summary_feedback(body: SummaryBody):
    """Generates an overall interview performance summary."""
    try:
        model_name = os.getenv("OPENAI_MODEL", "openai/gpt-oss-20b")
        
        history_text = "\n".join([f"Q: {h['question']}\nA: {h['answer']}" for h in body.interview_history])
        
        system_prompt = f"""
        You are an expert technical mentor. 
        Review the candidate's performance across the entire interview and provide a holistic summary.
        
        DATA:
        - Overall Correctness: {body.avg_correctness}/100
        - Overall Confidence/Delivery: {body.avg_confidence}/100
        
        INTERVIEW HISTORY:
        {history_text}
        
        Write a 3-4 sentence feedback summary. 
        Start by acknowledging their strengths. 
        Then mention 1-2 key areas for improvement (technical or delivery). 
        End with a supportive, encouraging sign-off.
        Talk directly to the candidate ("You did...", "Your answers...").
        """
        
        completion = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "Please generate the holistic summary now in pure JSON format with key \"summary\". The value of \"summary\" MUST BE A PLAIN STRING, not an object or a list."}
            ],
            response_format={"type": "json_object"},
            temperature=0.5
        )
        
        raw_content = completion.choices[0].message.content
        try:
            # Try to parse the JSON normally
            data = json.loads(raw_content)
            summary_val = data.get("summary", "")
            if isinstance(summary_val, dict):
                # If LLM ignored instructions and sent a dict, flatten it to a string
                summary_str = " ".join([str(v) for v in summary_val.values() if v])
            else:
                summary_str = str(summary_val)
            return {"summary": summary_str}
        except Exception:
            # Fallback if manual parsing fails
            res = SummaryResult.model_validate_json(raw_content)
            return {"summary": res.summary}
        
    except Exception as e:
        print(f"Summary generation failed: {e}")
        return {"summary": "Great job completing the interview! You showed solid potential. Focusing on clear communication and deep-diving into the core technical concepts will help you excel in the future. Keep it up!"}
