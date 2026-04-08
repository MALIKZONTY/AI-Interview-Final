from __future__ import annotations
import os
import random
from typing import Any
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.parser import parse_resume_and_jd, client

router = APIRouter()

class GenBody(BaseModel):
    resume_summary: str = ""
    jd_text: str
    count: int = Field(default=20, ge=5, le=30)
    difficulty: str = Field(default="Medium")

# Pydantic schema for the LLM to strictly follow
class GeneratedAIQuestion(BaseModel):
    text: str = Field(description="The interview question")
    expected_answer: str = Field(description="The ideal, comprehensive answer")
    acceptable_variants: list[str] = Field(description="Valid alternative ways to answer or shorthand phrases (related answers)")
    keywords: list[str] = Field(description="Crucial terminology that must be mentioned. MUST provide AT LEAST 20 keywords per question.")
    evaluation_rubric: dict[str, Any] = Field(description="Key-value pairs defining what constitutes partial vs full credit")
    category: str = Field(description="e.g., Technical, Behavioral, Scenario")
    difficulty: str = Field(description="e.g., Easy, Medium, Hard")

class GeneratedQuestionsBatch(BaseModel):
    questions: list[GeneratedAIQuestion]

class GenResponse(BaseModel):
    questions: list[dict]

@router.post("/generate-questions", response_model=GenResponse)
async def generate_questions(body: GenBody):
    # 1. Structured preprocessing - Parse JD & Resume
    profile = await parse_resume_and_jd(body.resume_summary, body.jd_text)
    
    # 2. Extract gap analysis
    missing = ", ".join(profile.missing_skills) if profile.missing_skills else "None"
    matched = ", ".join(profile.matched_skills) if profile.matched_skills else "None"
    
    # 3. Use LLM to generate targeted questions
    model_name = os.getenv("OPENAI_MODEL", "llama-3.3-70b-versatile")
    
    system_prompt = f"""
    You are an expert technical interviewer.
    Generate {body.count} highly relevant interview questions.
    Target difficulty: {body.difficulty}.
    Candidate's matched skills: {matched}. (Focus technical questions here).
    Candidate's missing skills: {missing}. (Focus gap-analysis/learning questions here).
    Generate a mix of Technical, Behavioral, and Scenario-based questions.
    For each question, ensure you provide:
    1. A detailed expected answer.
    2. Multiple acceptable variants (related answers).
    3. AT LEAST 20 essential keywords that should be mentioned.
    4. A structured evaluation rubric.
    
    You MUST return ONLY a JSON object with a single root property `questions`. It must be an array of objects.
    Each object MUST have the following keys: `text` (string), `expected_answer` (string), `acceptable_variants` (array of strings), `keywords` (array of strings), `evaluation_rubric` (object), `category` (string), `difficulty` (string).
    """
    
    try:
        completion = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "Please generate the interview questions now in pure JSON format."}
            ],
            response_format={"type": "json_object"},
            temperature=0.7
        )
        
        batch = GeneratedQuestionsBatch.model_validate_json(completion.choices[0].message.content)
        
        # 4. Map back to Fastify expected dictionary
        out = []
        for q in batch.questions:
            out.append({
                "text": q.text,
                "expected_answer": q.expected_answer,
                "acceptable_variants": q.acceptable_variants,
                "keywords": q.keywords,
                "evaluation_rubric": q.evaluation_rubric
            })
            
        return GenResponse(questions=out)

    except Exception as e:
        print(f"Error during question generation: {e}")
        # Severe fallback if LLM breaks
        return GenResponse(questions=[{
            "text": "Could you walk me through your technical background?",
            "expected_answer": "Candidate should explain their past projects.",
            "acceptable_variants": [],
            "keywords": ["experience", "projects"],
            "evaluation_rubric": {"full": "Provides clear history"}
        }])
