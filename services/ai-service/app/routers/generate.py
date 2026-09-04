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
    count: int = Field(default=20, ge=1, le=30)
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
    model_name = os.getenv("OPENAI_MODEL", "openai/gpt-oss-20b")
    
    system_prompt = f"""
    You are an expert interviewer. 
    You MUST generate {body.count} interview questions based STRICTLY on the provided Job Description and Resume context below.
    
    JOB DESCRIPTION:
    {body.jd_text}
    
    CANDIDATE RESUME:
    {body.resume_summary}
    
    Target difficulty: {body.difficulty}.
    Candidate's matched skills: {matched}.
    Candidate's missing skills: {missing}.
    
    CRITICAL CONSTRAINT: 
    Only generate questions that are directly relevant to the specific role and industry described in the JOB DESCRIPTION. 
    - If the JD is technical (e.g. Software Engineer), ask technical questions. 
    - If the JD is non-technical (e.g. Cricket Coach, Sales, Management), ask questions specific to that field. 
    - DO NOT default to general software architecture or coding questions (like Microservices vs Monolith) unless they are explicitly relevant to the role.
    
    Generate a balanced mix of:
    1. JD-Specific Questions: Based strictly on the roles and responsibilities in the job description.
    2. Resume-Specific Questions: Deep-dive into the candidate's listed projects, past work experience, and specific skills found in their resume summary.
    3. Behavioral & Scenario Questions: Based on the intersection of the role and the candidate's background.

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


class FollowUpBody(BaseModel):
    jd_text: str = ""
    question: str
    candidate_answer: str
    planned_next: str = ""
    difficulty: str = Field(default="Medium")


class FollowUpDecision(BaseModel):
    should_follow_up: bool = Field(
        description="True only when probing this specific answer is more valuable than the planned next question"
    )
    reason: str = Field(description="One short sentence explaining the decision")
    question: GeneratedAIQuestion | None = Field(
        default=None, description="The follow-up question; omit entirely when should_follow_up is false"
    )


@router.post("/generate-followup")
async def generate_followup(body: FollowUpBody):
    """
    Decides whether the interviewer should probe the answer just given instead of
    moving on to the next planned question, and writes that follow-up when so.

    Returning should_follow_up=false is the safe default: the caller then keeps the
    planned question, so a bad decision here never derails the interview.
    """
    answer = (body.candidate_answer or "").strip()
    # Nothing to probe — no answer means no thread to pull on.
    if len(answer.split()) < 8:
        return {"should_follow_up": False, "reason": "answer_too_short_to_probe", "question": None}

    model_name = os.getenv("OPENAI_MODEL", "openai/gpt-oss-20b")

    system_prompt = f"""
    You are conducting a live interview. You just asked the candidate a question and heard their answer.
    Decide whether to ask ONE targeted follow-up about what they just said, or to move on.

    JOB DESCRIPTION:
    {body.jd_text or "Not provided."}

    QUESTION YOU ASKED:
    {body.question}

    CANDIDATE'S ANSWER (speech transcript — expect minor transcription errors, do not penalise them):
    {answer}

    THE NEXT PLANNED QUESTION (what gets asked if you do not follow up):
    {body.planned_next or "None — this is the last question."}

    Follow up ONLY when it clearly beats the planned question, for example:
    - They named a specific tool, project, decision or trade-off that deserves a deeper probe.
    - They made a claim that a good interviewer would want substantiated with detail.
    - They answered the topic only partially, and the gap is worth one more attempt.

    Do NOT follow up when:
    - The answer was thorough and there is no natural next thread to pull.
    - A follow-up would just rephrase the same question.
    - It would duplicate the planned next question, or drift away from the job description.

    Prefer moving on when it is a close call. A good interview covers ground.

    The follow-up must reference something concrete the candidate actually said, be answerable
    in about 30 seconds of speech, and target difficulty {body.difficulty}.

    Return ONLY a JSON object:
    "should_follow_up": boolean
    "reason": string, one short sentence
    "question": when should_follow_up is true, an object with keys `text` (string),
      `expected_answer` (string), `acceptable_variants` (array of strings),
      `keywords` (array of strings, at least 10), `evaluation_rubric` (object),
      `category` (string), `difficulty` (string). Otherwise null.
    """

    try:
        completion = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "Decide now and reply in pure JSON."},
            ],
            response_format={"type": "json_object"},
            temperature=0.4,
        )
        decision = FollowUpDecision.model_validate_json(completion.choices[0].message.content)
    except Exception as e:
        print(f"Follow-up generation failed: {e}")
        return {"should_follow_up": False, "reason": "generation_failed", "question": None}

    if not decision.should_follow_up or decision.question is None or not decision.question.text.strip():
        return {"should_follow_up": False, "reason": decision.reason, "question": None}

    q = decision.question
    return {
        "should_follow_up": True,
        "reason": decision.reason,
        "question": {
            "text": q.text,
            "expected_answer": q.expected_answer,
            "acceptable_variants": q.acceptable_variants,
            "keywords": q.keywords,
            "evaluation_rubric": q.evaluation_rubric,
        },
    }
