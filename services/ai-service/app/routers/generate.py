from __future__ import annotations
import math
import os
import random
import re
from typing import Any
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.parser import parse_resume_and_jd, client

router = APIRouter()

# Characters a model reaches for in written prose that read badly through a speech
# synthesiser. Question text is spoken aloud, so it gets normalised before storage.
_SPOKEN_REPLACEMENTS = {
    "\u2011": "-",   # non-breaking hyphen
    "\u2012": "-",   # figure dash
    "\u2010": "-",   # unicode hyphen
    "\u2018": "'", "\u2019": "'",
    "\u201c": '"', "\u201d": '"',
    "\u2026": "...",
    "\u00a0": " ",   # non-breaking space
    "\u200b": "",    # zero-width space
    "`": "", "*": "", "_": " ",
}


def _spoken_text(text: str) -> str:
    """Normalises a generated question into something a voice reads cleanly."""
    out = (text or "").strip()
    # A spaced en/em dash is a spoken pause; a comma gets that across, the dash does not.
    out = re.sub(r"\s*[\u2013\u2014]\s*", ", ", out)
    for bad, good in _SPOKEN_REPLACEMENTS.items():
        out = out.replace(bad, good)
    out = re.sub(r"\s+", " ", out).strip()
    out = re.sub(r"\s+([,.?!])", r"\1", out)
    return out


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
    keywords: list[str] = Field(description="Crucial terminology that should be mentioned. Provide 8 to 12 of the most important terms.")
    evaluation_rubric: dict[str, Any] = Field(description="Key-value pairs defining what constitutes partial vs full credit")
    category: str = Field(description="e.g., Technical, Behavioral, Scenario")
    difficulty: str = Field(description="e.g., Easy, Medium, Hard")

class GeneratedQuestionsBatch(BaseModel):
    questions: list[GeneratedAIQuestion]

class GenResponse(BaseModel):
    questions: list[dict]


# Small models overrun their output budget past a handful of fully-specified questions.
_BATCH_SIZE = 3


async def _generate_batch(
    model_name: str, base_prompt: str, count: int, avoid: str
) -> list[GeneratedAIQuestion]:
    """One generation call. Returns [] on any failure so the caller can stop or retry."""
    try:
        completion = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": base_prompt + avoid},
                {
                    "role": "user",
                    "content": (
                        f"Generate exactly {count} interview question(s) now, in pure JSON, "
                        f"as an object with a single `questions` array."
                    ),
                },
            ],
            response_format={"type": "json_object"},
            temperature=0.7,
            max_completion_tokens=8000,
        )
        batch = GeneratedQuestionsBatch.model_validate_json(completion.choices[0].message.content)
        return [q for q in batch.questions if q.text and q.text.strip()]
    except Exception as e:
        print(f"Question batch failed (count={count}): {e}")
        return []


# What each difficulty actually means. Without this the model reads "Easy" as
# "an easy question for a professional" and asks a beginner about pointers.
_DIFFICULTY_RUBRIC = {
    "easy": """DIFFICULTY: EASY — aimed at a student or someone who has just learned this topic.
    - Test recall and understanding: what something IS, what it is FOR, basic vocabulary.
    - A good answer is two or three sentences from someone who took a course and paid attention.
    - Use openers like "What is...", "What does ... mean", "Can you explain what ... does".
    - Do NOT ask about trade-offs, design decisions, performance, edge cases or internals.
    - Do NOT ask "tell me about a time you..." — a student has no professional stories, and
      asking for one guarantees an empty answer no matter how well they know the subject.
    - Stay on the foundational concepts of the subject, not its advanced corners.""",

    "medium": """DIFFICULTY: MEDIUM — aimed at someone who has actually used this in practice.
    - Test application: how they would use it, when they would choose one option over another,
      how they would approach a straightforward, concrete situation.
    - A good answer shows hands-on familiarity, not just a memorised definition.
    - Use openers like "How would you...", "When would you use ... over ...", "Walk me through...".
    - Light experience questions are fine, but keep an answerable hypothetical available.
    - Avoid deep architecture, scaling and obscure failure modes.""",

    "hard": """DIFFICULTY: HARD — aimed at an experienced practitioner.
    - Test judgement: trade-offs, design, failure modes, debugging something genuinely awkward,
      decisions with no clean answer.
    - A good answer weighs options and justifies a choice.
    - Experience-based questions are appropriate here.
    - Find that difficulty inside the syllabus the source material set. Depth of reasoning
      about the listed topics, never a jump to advanced topics it never mentioned.""",
}


def _difficulty_rubric(level: str) -> str:
    return _DIFFICULTY_RUBRIC.get((level or "medium").strip().lower(), _DIFFICULTY_RUBRIC["medium"])


# Same topic at three levels, so the model can see the gap rather than infer it.
_DIFFICULTY_EXAMPLES = """
    These are ILLUSTRATIONS of the gap between levels, in an unrelated subject. Never
    reuse them, and never let their subject matter leak into your questions. Source
    material of "basic HTML":
      EASY:   "What is a heading tag in HTML?"
      MEDIUM: "How would you structure a page with a header, a nav and a footer?"
      HARD:   "How would you debug a layout that collapses only on mobile?"

    Notice the level changes how deeply you probe, not which topics you reach for.
"""

# Difficulty must not be used as licence to leave the syllabus the source material set.
_SCOPE_RULE = """
    STAY INSIDE THE STATED SCOPE:
    The source material sets the syllabus. Phrases like "basics", "fundamentals",
    "up to arrays", "entry level" or "introduction to" are hard boundaries.
    - Never ask about a topic beyond that boundary, at ANY difficulty. If the material
      says "up to arrays", then pointers, dynamic memory, threads and profilers are all
      out of scope, and a HARD question must find its difficulty WITHIN arrays, loops
      and functions — for example reasoning about an off-by-one in a loop over an array,
      not tracking down a memory leak.
    - Difficulty controls how hard you think about the listed topics, never how far
      past them you reach.
    - If the material is narrow, ask several angles on the same small set of topics.
      That is correct behaviour, not a failure to find material.
"""


@router.post("/generate-questions", response_model=GenResponse)
async def generate_questions(body: GenBody):
    # 1. Structured preprocessing - Parse JD & Resume
    profile = await parse_resume_and_jd(body.resume_summary, body.jd_text)
    
    # 2. Extract gap analysis
    missing = ", ".join(profile.missing_skills) if profile.missing_skills else "None"
    matched = ", ".join(profile.matched_skills) if profile.matched_skills else "None"
    
    # 3. Use LLM to generate targeted questions
    model_name = os.getenv("OPENAI_MODEL", "openai/gpt-oss-20b")
    
    # An interview is built from one source, so the prompt must not reference the other.
    jd = (body.jd_text or "").strip()
    resume_text = (body.resume_summary or "").strip()

    if jd:
        source_block = f"JOB DESCRIPTION:\n    {jd}"
        source_rule = """CRITICAL CONSTRAINT:
    Only generate questions directly relevant to the specific role and industry in the JOB DESCRIPTION.
    - If the role is technical (e.g. Software Engineer), ask technical questions.
    - If it is non-technical (e.g. Cricket Coach, Sales, Management), ask questions specific to that field.
    - DO NOT default to general software architecture or coding questions unless the role calls for them.
    - You have NOT seen this candidate's resume. Never imply you know their background: ask
      "How would you..." or "When would you...", never "I saw you worked on...".
    """
        mix = """Generate a balanced mix of:
    1. Core responsibilities named in the job description.
    2. Scenario questions someone in this role would actually face.
    3. Behavioural questions suited to the seniority and team context described.
    """
    else:
        source_block = f"CANDIDATE RESUME:\n    {resume_text}"
        source_rule = """CRITICAL CONSTRAINT:
    Only generate questions grounded in what the RESUME actually says.
    - Interview them about their own work: the projects, tools, roles and results they listed.
    - Match the field the resume is in. A cricket coach's resume gets coaching questions, not software ones.
    - There is NO job description. Do not invent role requirements or ask about a target position.
    - Never ask about a technology or skill the resume does not mention.
    """
        mix = """Generate a balanced mix of:
    1. Deep-dives into specific projects and achievements the resume lists.
    2. The tools, skills and methods they claim, probing real depth rather than name recognition.
    3. Behavioural questions drawn from the roles and responsibilities on the resume.
    """

    system_prompt = f"""
    You are an expert interviewer.
    Questions come STRICTLY from the single source below. You are asked for a few at a
    time; the exact number is in the user message.

    {source_block}

    Candidate's matched skills: {matched}.
    Candidate's missing skills: {missing}.

    {_difficulty_rubric(body.difficulty)}
    {_SCOPE_RULE}
    {_DIFFICULTY_EXAMPLES}
    The difficulty applies to `expected_answer` too. At EASY, the expected answer is the
    simple correct explanation a beginner would give — do not write a deep expert answer
    and then mark a correct beginner answer down against it.

    {source_rule}
    
    HOW TO PHRASE THE QUESTION TEXT — THIS MATTERS AS MUCH AS THE CONTENT:
    Every `text` value is READ ALOUD to the candidate by a voice. Write what a real
    interviewer would SAY in the room, not what an exam paper would print.

    - One question, one idea. Never bundle two or three asks into one sentence.
    - Keep it under 35 spoken words. If you need a comma-spliced clause to fit it, it is too long.
    - Open the way people actually open: "Tell me about...", "Walk me through...",
      "How would you...", "When would you...", "What happened when...", "Say you...".
    - Reference their background naturally: "I saw you worked on X — how did you handle Y?"
    - Contractions are good. "How'd you approach that?" beats "How did you approach that?".
    - Ask about judgement and experience, not textbook definitions. Interviewers want to know
      what someone DID and how they DECIDE, not whether they memorised a glossary.
    - Never use parentheses, bullet points, code snippets, slashes, "e.g.", "i.e." or symbols —
      they sound wrong when spoken. Write abbreviations the way you would say them.
    - The VERY FIRST question of the interview must be an easy, warm conversational opener that
      settles the candidate in. If questions have already been asked, do not open again — carry on.

    Examples of the DIFFERENCE, for a backend role:
      BAD  (written exam): "Explain the differences between SQL and NoSQL databases, including
            their respective consistency models, and discuss the trade-offs in distributed systems."
      GOOD (spoken):       "When would you reach for a NoSQL database over Postgres?"

      BAD:  "Describe your experience with CI/CD pipelines (e.g. Jenkins, GitHub Actions)."
      GOOD: "Walk me through what happens when you push a commit on your current team."

      BAD:  "Elaborate on the implementation details of the caching layer referenced in your resume."
      GOOD: "I saw you added a caching layer on that project. What pushed you to do it?"

      BAD:  "Discuss a challenging situation, how you resolved it, and what you learned."
      GOOD: "Tell me about a time something broke in production. What did you do first?"

    {mix}

    The `text` field is the spoken question and must follow the phrasing rules above.
    The `expected_answer`, `keywords` and `evaluation_rubric` are for scoring only, are never
    read aloud, and should stay as precise and technical as they need to be.

    For each question, ensure you provide:
    1. A detailed expected answer.
    2. Multiple acceptable variants (related answers).
    3. Between 8 and 12 essential keywords that should be mentioned.
    4. A structured evaluation rubric.
    
    You MUST return ONLY a JSON object with a single root property `questions`. It must be an array of objects.
    Each object MUST have the following keys: `text` (string), `expected_answer` (string), `acceptable_variants` (array of strings), `keywords` (array of strings), `evaluation_rubric` (object), `category` (string), `difficulty` (string).
    """
    
    # Generated in small batches: one big call reliably overruns the output budget on
    # smaller models, which returns fewer questions than asked for or invalid JSON.
    collected: list[GeneratedAIQuestion] = []
    attempts = 0
    max_attempts = math.ceil(body.count / _BATCH_SIZE) + 2

    try:
        while len(collected) < body.count and attempts < max_attempts:
            attempts += 1
            want = min(_BATCH_SIZE, body.count - len(collected))

            already = "\n".join(f"- {q.text}" for q in collected)
            avoid = (
                f"\n\nYou have ALREADY asked the questions below. Do not repeat them or "
                f"ask a near-duplicate:\n{already}"
                if collected
                else ""
            )

            batch = await _generate_batch(model_name, system_prompt, want, avoid)
            if not batch:
                break
            collected.extend(batch)

        if not collected:
            raise RuntimeError("no questions generated")

        return GenResponse(
            questions=[
                {
                    "text": _spoken_text(q.text),
                    "expected_answer": q.expected_answer,
                    "acceptable_variants": q.acceptable_variants,
                    "keywords": q.keywords,
                    "evaluation_rubric": q.evaluation_rubric,
                }
                for q in collected[: body.count]
            ]
        )

    except Exception as e:
        print(f"Error during question generation: {e}")
        # Severe fallback if LLM breaks
        return GenResponse(questions=[{
            "text": "So, to get us started — tell me a bit about what you have been working on lately.",
            "expected_answer": "Candidate should describe their recent work, projects and responsibilities.",
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
    keywords: list[str] = []


class FollowUpDecision(BaseModel):
    should_follow_up: bool = Field(
        description="True only when probing this specific answer is more valuable than the planned next question"
    )
    reason: str = Field(description="One short sentence explaining the decision")
    question: GeneratedAIQuestion | None = Field(
        default=None, description="The follow-up question; omit entirely when should_follow_up is false"
    )


# A candidate saying they do not know is a complete answer to the question asked.
# Re-probing the same topic earns them a second zero for one gap, so the interview
# moves on instead.
_NON_ANSWER_RE = re.compile(
    r"\b("
    r"i (?:do ?n['o]?t|dont|don't) know"
    r"|i (?:have|haven'?t|ha ?ve ?n'?t) (?:never |not )?(?:heard|encountered|come across|dealt|worked|used|read)"
    r"|never (?:heard|encountered|used|done|seen)"
    r"|not (?:familiar|sure|aware)"
    r"|no (?:idea|experience)"
    r"|can'?t (?:answer|recall|remember)"
    r"|skip this"
    r")\b",
    re.IGNORECASE,
)


def _is_non_answer(answer: str, question: str, keywords: list[str] | None = None) -> bool:
    """True when the candidate disclaimed knowledge and offered nothing substantive."""
    if not _NON_ANSWER_RE.search(answer):
        return False

    # A disclaimer followed by real content ("I have never used valgrind, but I use
    # gdb to get a backtrace...") is still worth probing. Only terms the question did
    # not already supply count as content — echoing "segmentation fault" back is not
    # knowledge, it is repeating the question.
    lowered = answer.lower()
    asked = question.lower()
    novel = [
        str(k).lower()
        for k in (keywords or [])
        if len(str(k)) > 3 and str(k).lower() not in asked
    ]
    return not any(k in lowered for k in novel)


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
    if _is_non_answer(answer, body.question, body.keywords):
        return {"should_follow_up": False, "reason": "candidate_disclaimed_knowledge", "question": None}

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
    - The candidate said they do not know the topic, have never encountered it, or cannot
      answer. That is a complete answer. Asking it again hypothetically ("if you did, how
      would you...") scores them zero twice for one gap. Move to a different subject.

    Prefer moving on when it is a close call. A good interview covers ground.

    The follow-up must reference something concrete the candidate actually said and be
    answerable in about 30 seconds of speech.

    {_difficulty_rubric(body.difficulty)}
    A follow-up must not be harder than the level above. Probing an easy answer means asking
    them to say a little more about the same basic idea, not stepping up to internals.

    PHRASING — the question is READ ALOUD, so write what an interviewer would SAY:
    - One idea, under 35 spoken words, ending in a single question mark.
    - Pick up their own words: "You mentioned the caching layer — what made you reach for that?"
    - Natural openers: "You said...", "Walk me through...", "What made you...", "How did you...".
    - Contractions are good. No parentheses, bullet points, symbols, "e.g." or "i.e.".
    - Sound curious, not like a quiz. You are following a thread, not testing a definition.

    BAD  (written exam): "Please elaborate on the specific methodology employed to diagnose
          the aforementioned N+1 query problem and the rationale for eager loading."
    GOOD (spoken):       "How did you spot that N+1 problem in the first place?"

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
            "text": _spoken_text(q.text),
            "expected_answer": q.expected_answer,
            "acceptable_variants": q.acceptable_variants,
            "keywords": q.keywords,
            "evaluation_rubric": q.evaluation_rubric,
        },
    }
