from __future__ import annotations
import os
from typing import Any
from pydantic import BaseModel, Field
from openai import AsyncOpenAI

# The one LLM client for the whole service — question generation, follow-ups,
# answer evaluation, summaries and cloud transcription all share it.
#
# The default matters. Left unset it was None, which sends requests to OpenAI, so a
# Groq key came back "Incorrect API key provided" with a link to OpenAI's dashboard
# — while transcription kept working, because speech.py happened to default to Groq.
# Anything OpenAI-compatible can still be selected through OPENAI_BASE_URL.
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL") or "https://api.groq.com/openai/v1"

client = AsyncOpenAI(
    api_key=os.getenv("OPENAI_API_KEY", "dummy-key-if-not-set-but-required"),
    base_url=OPENAI_BASE_URL,
)

# Printed once at import so a misrouted key is visible in the logs rather than
# only in a 401 from whichever provider received it.
print(
    f"[ai] LLM endpoint: {OPENAI_BASE_URL} | model: "
    f"{os.getenv('OPENAI_MODEL', 'openai/gpt-oss-20b')} | "
    f"key: {'set' if os.getenv('OPENAI_API_KEY') else 'MISSING'}",
    flush=True,
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
    # An interview is built from one source, so only one of these is usually present.
    if jd_text.strip() and resume_summary.strip():
        task = ("Analyze the Job Description and the candidate's Resume Summary. Extract the "
                "skills required, the skills the candidate has, matches versus gaps, and their experience.")
    elif jd_text.strip():
        task = ("Analyze the Job Description. Extract the skills the role requires. Leave "
                "candidate_skills, matched_skills, missing_skills, projects and experience empty — "
                "there is no resume to compare against.")
    else:
        task = ("Analyze the candidate's Resume Summary. Extract their skills into both "
                "required_skills and candidate_skills, and summarise their projects and experience. "
                "Leave matched_skills and missing_skills empty — there is no job description "
                "to compare against.")

    sections = []
    if jd_text.strip():
        sections.append(f"# Job Description:\n{jd_text}")
    if resume_summary.strip():
        sections.append(f"# Candidate Resume Summary:\n{resume_summary}")

    prompt = f"""
You are an expert technical recruiter and interviewer.
{task}

{chr(10).join(sections)}
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
