"""
Large pool of interview question templates (behavioral + technical + situational).
Filled with JD keywords / themes and shuffled so each session differs — no external LLM.
"""

from __future__ import annotations

import random
import re
from typing import Iterable

# (question template with {topic}, expected-answer rubric)
TEMPLATES: list[tuple[str, str]] = [
    (
        "Describe a situation where you had to prioritize {topic} under tight deadlines.",
        "STAR structure, trade-offs, stakeholder communication, and measurable outcome.",
    ),
    (
        "What draws you to work that involves {topic}, and how have you grown in that area?",
        "Authentic motivation, specific examples, learning arc, connection to this role.",
    ),
    (
        "Tell me about a conflict you resolved that involved {topic}. What was your approach?",
        "Listening, de-escalation, facts vs opinions, agreed outcome, follow-up.",
    ),
    (
        "How do you stay current with practices and tools related to {topic}?",
        "Concrete sources, communities, side projects, mentoring, time allocation.",
    ),
    (
        "Walk me through how you would debug or investigate an issue tied to {topic}.",
        "Hypothesis, isolation steps, metrics/logs, rollback, postmortem.",
    ),
    (
        "Give an example where you improved quality or reliability around {topic}.",
        "Before/after metrics, process change, tooling, team buy-in.",
    ),
    (
        "How would you explain a complex idea about {topic} to a non-expert stakeholder?",
        "Analogies, visuals, check for understanding, avoid jargon.",
    ),
    (
        "Describe a time you received hard feedback related to {topic}. What changed?",
        "No defensiveness, specific actions, outcome after change.",
    ),
    (
        "What would you look for in the first two weeks to assess risk in {topic}?",
        "Code/data/system review, interviews, docs, top risks, quick wins.",
    ),
    (
        "How do you balance speed vs quality when shipping work involving {topic}?",
        "Criteria for each mode, examples, when to refactor, team norms.",
    ),
    (
        "Tell me about mentoring or upskilling someone on {topic}.",
        "Assessment, plan, checkpoints, outcome for mentee and team.",
    ),
    (
        "Describe a failed initiative touching {topic}. What did you learn?",
        "Ownership, early signals missed, what you'd do differently, lessons applied since.",
    ),
    (
        "How do you approach security or privacy considerations for {topic}?",
        "Threat model basics, least privilege, reviews, compliance awareness.",
    ),
    (
        "What metrics would you use to show success for work on {topic}?",
        "Leading/lagging metrics, baselines, experimentation, caveats.",
    ),
    (
        "How have you collaborated across functions (e.g. product, design) on {topic}?",
        "Rituals, artifacts, conflict resolution, shared goals.",
    ),
    (
        "Describe designing or evolving an API or interface related to {topic}.",
        "Versioning, backwards compatibility, documentation, consumer feedback.",
    ),
    (
        "How do you test changes that affect {topic} before production?",
        "Unit/integration/e2e, staging, feature flags, monitoring, rollback.",
    ),
    (
        "Tell me about scaling a system or process involving {topic}.",
        "Bottleneck identification, measurement, incremental changes, trade-offs.",
    ),
    (
        "How would you onboard a new teammate who will own parts of {topic}?",
        "30-60-90, docs, pairing, first issues, safety to ask questions.",
    ),
    (
        "What is your approach to technical debt when {topic} is involved?",
        "Triage, interest metaphor, stakeholder alignment, incremental paydown.",
    ),
    (
        "Describe a data-driven decision you made using inputs related to {topic}.",
        "Hypothesis, data sources, uncertainty, decision, retrospective.",
    ),
    (
        "How do you handle disagreements with leadership about {topic}?",
        "Respect, evidence, options, escalate appropriately, commit once decided.",
    ),
    (
        "What does good documentation look like for {topic} in your experience?",
        "Audience, examples, discoverability, maintenance, living docs.",
    ),
    (
        "Tell me about automating or eliminating toil around {topic}.",
        "Measurement of toil, ROI, safety, adoption, monitoring.",
    ),
    (
        "How do you approach incident response when {topic} is implicated?",
        "Stabilize, communicate, timeline, root cause, preventive actions.",
    ),
    (
        "Describe a trade-off between user experience and engineering constraints for {topic}.",
        "Options considered, who was consulted, decision, outcome.",
    ),
    (
        "What role does observability play in how you work with {topic}?",
        "Logs, metrics, traces, SLOs, alerting hygiene, dashboards.",
    ),
    (
        "How do you evaluate third-party tools or vendors for {topic}?",
        "Requirements, POC, cost, lock-in, security, long-term fit.",
    ),
    (
        "Tell me about a time you had to say no or push back on scope for {topic}.",
        "Reasoning, alternatives, stakeholder impact, outcome.",
    ),
    (
        "How do you ensure accessibility or inclusivity considerations for {topic}?",
        "Guidelines, testing, feedback loops, continuous improvement.",
    ),
    (
        "Describe coordinating a project where {topic} was the main technical pillar.",
        "Planning, dependencies, risks, communication rhythm, delivery.",
    ),
    (
        "What is your philosophy on code review when changes touch {topic}?",
        "Kindness, clarity, security/perf checks, learning, SLA.",
    ),
    (
        "How would you approach migrating or refactoring legacy parts of {topic}?",
        "Strangler fig, feature parity, risk reduction, validation.",
    ),
    (
        "Tell me about optimizing performance or cost for something related to {topic}.",
        "Profiling, hypothesis, change, measurement, regression guard.",
    ),
    (
        "How do you gather requirements when stakeholders are unclear about {topic}?",
        "Questions, prototypes, iterative demos, written acceptance criteria.",
    ),
    (
        "Describe a time you used experimentation (A/B or similar) around {topic}.",
        "Hypothesis, design, ethics, analysis, decision.",
    ),
    (
        "What are common pitfalls you've seen with {topic}, and how do you avoid them?",
        "Specific pitfalls, prevention, detection, recovery.",
    ),
    (
        "How do you keep production changes safe when working on {topic}?",
        "Canary, rollbacks, feature flags, monitoring, runbooks.",
    ),
    (
        "Tell me about influencing without authority on a {topic} initiative.",
        "Trust, data, storytelling, coalition-building, outcome.",
    ),
    (
        "How do you approach ethical implications (bias, fairness) for {topic}?",
        "Awareness, review, mitigation, monitoring, escalation.",
    ),
    (
        "Describe breaking down a large ambiguous goal related to {topic} into milestones.",
        "Decomposition, dependencies, estimates, checkpoints.",
    ),
    (
        "What does operational excellence mean to you for systems involving {topic}?",
        "Runbooks, drills, error budgets, culture, continuous improvement.",
    ),
    (
        "How have you used CI/CD or release engineering practices for {topic}?",
        "Pipelines, gates, environments, release cadence, hotfix process.",
    ),
    (
        "Tell me about a creative solution you applied to a constraint in {topic}.",
        "Constraint, options, chosen path, why it worked.",
    ),
    (
        "How do you document and share decisions (ADRs, RFCs) for {topic}?",
        "When to write, template, audience, follow-up.",
    ),
    (
        "What would you teach a junior engineer first about {topic}?",
        "Foundations, mental model, common tasks, resources.",
    ),
    (
        "How do you validate that a solution for {topic} actually solves the user problem?",
        "User research, analytics, qualitative feedback, iteration.",
    ),
    (
        "Describe handling a production outage or severe bug tied to {topic}.",
        "Triage, comms, fix, retro, durable prevention.",
    ),
    (
        "How do you think about long-term maintainability for {topic}?",
        "Modularity, tests, ownership, deprecation, knowledge sharing.",
    ),
    (
        "Tell me about a time you improved collaboration between teams on {topic}.",
        "Friction, intervention, new norms, measurable improvement.",
    ),
    (
        "What questions would you ask us about how we approach {topic} here?",
        "Thoughtful, specific, shows research — not generic.",
    ),
    (
        "How do you balance technical perfection with business deadlines for {topic}?",
        "Principled trade-offs, incremental quality, stakeholder alignment.",
    ),
    (
        "Describe evaluating build vs buy for a component related to {topic}.",
        "Criteria, TCO, risk, timeline, support burden.",
    ),
    (
        "What is your approach to learning an unfamiliar subdomain of {topic} quickly?",
        "Map, experts, docs, small deliverables, feedback loops.",
    ),
    (
        "Tell me about a presentation or demo you gave on {topic}.",
        "Audience, goal, structure, Q&A handling, outcome.",
    ),
    (
        "How do you ensure reproducibility or auditability for work on {topic}?",
        "Versioning, pipelines, access logs, documentation.",
    ),
    (
        "Describe a time you simplified an over-engineered solution for {topic}.",
        "Signals of over-engineering, steps taken, risk managed, result.",
    ),
    (
        "What role does customer empathy play in how you implement {topic}?",
        "Examples of user impact driving technical choices.",
    ),
    (
        "How would you approach performance benchmarking for {topic}?",
        "Workload, environment, statistical rigor, avoiding cheating.",
    ),
    (
        "Tell me about coordinating with compliance or legal on {topic}.",
        "Early engagement, clarity, documentation, timelines.",
    ),
    (
        "What habits help you write clearer, more reviewable work for {topic}?",
        "Naming, structure, tests, comments when needed, self-review.",
    ),
    (
        "How do you decide what to instrument or log for services touching {topic}?",
        "User journeys, failure modes, cardinality, privacy.",
    ),
    (
        "Describe a time you improved developer experience for {topic}.",
        "Pain points, tooling, docs, automation, adoption metrics.",
    ),
    (
        "What is your take on monolith vs microservices when {topic} is central?",
        "Context-dependent answer with trade-offs, not dogma.",
    ),
    (
        "How do you approach capacity planning or load testing for {topic}?",
        "Growth assumptions, scenarios, safety margins, follow-up.",
    ),
    (
        "Tell me about a constructive debate you had about architecture for {topic}.",
        "Positions, evidence, decision process, outcome.",
    ),
    (
        "How do you keep security reviews practical and fast for changes in {topic}?",
        "Threat alignment, automation, checklists, escalation path.",
    ),
    (
        "What would you improve in our industry’s typical approach to {topic}?",
        "Insightful critique with nuance and examples.",
    ),
    (
        "Describe mentoring a team toward better practices for {topic}.",
        "Assessment, workshops, standards, reinforcement, metrics.",
    ),
    (
        "How do you prioritize tech roadmap items that involve {topic}?",
        "Framework (value/risk/effort), stakeholders, communication.",
    ),
    (
        "Tell me about a time you had to learn from a domain expert about {topic}.",
        "How you prepared, questions, synthesis, application.",
    ),
    (
        "What does ‘done’ mean to you for deliverables involving {topic}?",
        "Tests, docs, monitoring, handoff, acceptance criteria.",
    ),
    (
        "How do you approach pairing or mobbing sessions on {topic}?",
        "Goals, rotation, psychological safety, outcomes.",
    ),
    (
        "Describe a situation where data was messy or incomplete but you still shipped {topic}.",
        "Assumptions, validation, caveats, iterative improvement.",
    ),
    (
        "How do you foster psychological safety when discussing mistakes in {topic}?",
        "Blameless culture, learning focus, examples.",
    ),
    (
        "What is your strategy for staying organized across multiple threads of work on {topic}?",
        "Systems, tools, communication, saying no, WIP limits.",
    ),
    (
        "Tell me about influencing product direction using technical insights on {topic}.",
        "Evidence, framing, partnership with PM, outcome.",
    ),
    (
        "How would you approach documentation debt for {topic}?",
        "Triage, templates, ownership, incremental improvement.",
    ),
    (
        "Describe a time you used metrics to change team behavior around {topic}.",
        "Metric choice, gaming risks, narrative, result.",
    ),
    (
        "What are you hoping to learn next in the space of {topic}?",
        "Specific curiosity, plan, how role helps — authentic.",
    ),
]


def _tokens(text: str) -> list[str]:
    return [t.lower() for t in re.findall(r"[A-Za-z0-9+#]{3,}", text)]


def _topic_pool(jd_text: str, resume_summary: str) -> list[str]:
    """Ordered candidates: JD tokens, resume tokens, then generic professional topics."""
    seen: set[str] = set()
    pool: list[str] = []

    def add_many(words: Iterable[str]) -> None:
        for w in words:
            lw = w.lower()
            if lw in seen or len(lw) < 3:
                continue
            seen.add(lw)
            pool.append(w if w.islower() or w.isupper() else lw)

    add_many(_tokens(jd_text))
    add_many(_tokens(resume_summary))

    generics = [
        "cross-team delivery",
        "system design",
        "user impact",
        "quality and testing",
        "production operations",
        "technical communication",
        "mentoring",
        "prioritization",
        "stakeholder management",
        "security awareness",
        "performance optimization",
        "data integrity",
        "reliability engineering",
        "product collaboration",
        "continuous improvement",
        "risk management",
    ]
    add_many(generics)
    return pool


def build_questions(jd_text: str, resume_summary: str, count: int) -> list[dict]:
    """
    Produce `count` unique questions by shuffling many (template × topic) combinations.
    A fresh RNG each request keeps sessions different even for the same JD text.
    """
    rng = random.Random()
    topics = _topic_pool(jd_text, resume_summary)
    if not topics:
        topics = ["this role's core responsibilities"]

    deck = list(TEMPLATES)
    rng.shuffle(deck)

    candidates: list[dict] = []
    for tmpl, rubric in deck:
        # Pair each template with several topic slots (JD-derived + shuffled order)
        shuffled_topics = list(topics)
        rng.shuffle(shuffled_topics)
        for topic in shuffled_topics[: min(8, len(shuffled_topics))]:
            text = tmpl.format(topic=topic)
            exp = (
                f"{rubric} Tie examples to the job description and, where relevant, "
                "the candidate's background."
            )
            candidates.append({"text": text, "expected_answer": exp})

    rng.shuffle(candidates)

    seen: set[str] = set()
    out: list[dict] = []
    for c in candidates:
        if c["text"] in seen:
            continue
        seen.add(c["text"])
        out.append(c)
        if len(out) >= count:
            break

    # Rare: need more — cycle templates with numeric suffix topics (still unique)
    fill = 0
    while len(out) < count and fill < count * 5:
        tmpl, rubric = rng.choice(deck)
        topic = f"{topics[fill % len(topics)]} (angle {fill + 1})"
        fill += 1
        text = tmpl.format(topic=topic)
        if text in seen:
            continue
        seen.add(text)
        out.append(
            {
                "text": text,
                "expected_answer": f"{rubric} Tie to the JD and your experience.",
            }
        )

    return out[:count]
