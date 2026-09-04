from __future__ import annotations
import json
from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

router = APIRouter()

class FinetuneItem(BaseModel):
    system_prompt: str = ""
    question: str
    expected_answer: str
    transcript: str
    correctness_score: float

class FinetuneRequest(BaseModel):
    dataset: list[FinetuneItem]

@router.post("/dataset/export", response_class=PlainTextResponse)
def export_dataset(body: FinetuneRequest):
    """
    Converts a dataset of evaluated candidate responses into a JSONL format
    suitable for instruction tuning (e.g., Llama, GPT-4, Mistral format).
    """
    lines = []
    for item in body.dataset:
        # ChatML format commonly used for instruction-tuning LLMs
        record = {
            "messages": [
                {"role": "system", "content": item.system_prompt or "You are evaluating candidate answers."},
                {"role": "user", "content": f"Question: {item.question}\nExpected: {item.expected_answer}\nCandidate Answer: {item.transcript}"},
                {"role": "assistant", "content": f"Score: {item.correctness_score}/100"}
            ]
        }
        lines.append(json.dumps(record))
    
    return "\n".join(lines)
