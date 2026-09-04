from __future__ import annotations
import os
from typing import Any
from pydantic import BaseModel, Field
from openai import AsyncOpenAI

# Initialize OpenAI client. If user uses HuggingFace/Groq/etc., they can override base_url in env
client = AsyncOpenAI(
    api_key=os.getenv("OPENAI_API_KEY", "dummy-key-if-not-set-but-required"),
    base_url=os.getenv("OPENAI_BASE_URL", None)
)

class ParsedProfile(BaseModel):
    required_skills: list[str] = Field(description="Skills required by the job description")
    candidate_skills: list[str] = Field(description="Skills extracted from the resume summary")
    matched_skills: list[str] = Field(description="Job description skills that the candidate has")
    missing_skills: list[str] = Field(description="Job description skills that the candidate lacks")
    projects: list[Any] = Field(description="Key projects or achievements from the candidate")
    experience: list[Any] = Field(description="Summary of work experience roles")

async def parse_resume_and_jd(resume_summary: str, jd_text: str) -> ParsedProfile:
    """
    Parses the JD and Resume to extract structural data for question generation.
    """
    prompt = f"""
You are an expert technical recruiter and interviewer.
Analyze the following Job Description (JD) and the candidate's Resume Summary.
Extract the skills required, skills the candidate has, identify matches vs gaps, and summarize their experience.

# Job Description:
{jd_text}

# Candidate Resume Summary:
{resume_summary}
"""
    try:
        completion = await client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "openai/gpt-oss-20b"),
            messages=[
                {"role": "system", "content": "Return the requested JSON output strictly matching the following schema keys: {\"required_skills\": [], \"candidate_skills\": [], \"matched_skills\": [], \"missing_skills\": [], \"projects\": [], \"experience\": []}. Ensure it is pure JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.1
        )
        return ParsedProfile.model_validate_json(completion.choices[0].message.content)
    except Exception as e:
        print(f"LLM Parsing failed: {e}")
        # Fallback empty profile
        return ParsedProfile(
            required_skills=[],
            candidate_skills=[],
            matched_skills=[],
            missing_skills=["LLM API failed to parse skills"],
            projects=[],
            experience=[]
        )
