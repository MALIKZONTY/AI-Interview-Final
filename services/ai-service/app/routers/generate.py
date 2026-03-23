"""
Generates interview questions locally from the JD + resume text using a large template bank.
Questions are shuffled each request so sessions vary even with the same JD (no LLM APIs).
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.data.question_bank import build_questions

router = APIRouter()


class GenBody(BaseModel):
    resume_summary: str = ""
    jd_text: str
    count: int = Field(default=20, ge=5, le=30)


class GenResponse(BaseModel):
    questions: list[dict]


@router.post("/generate-questions", response_model=GenResponse)
def generate_questions(body: GenBody):
    questions = build_questions(body.jd_text, body.resume_summary, body.count)
    return GenResponse(questions=questions)
