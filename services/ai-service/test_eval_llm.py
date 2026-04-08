import asyncio
import os
import json
from dotenv import load_dotenv
from pathlib import Path

# Load env variables
_env = Path("/Users/maliktl/Documents/projects/AI-Interview-Final/services/ai-service/.env")
load_dotenv(_env)

from app.routers.evaluate import evaluate_answer, EvaluateBody

async def test_evaluation():
    # Mock data
    body = EvaluateBody(
        question="Explain the difference between Props and State in React.",
        expected_answer="Props are passed into a component from its parent and are immutable, whereas State is managed within the component and is mutable.",
        acceptable_variants=["Props are external, State is internal", "Props are read-only, State can change"],
        keywords=["props", "state", "immutable", "mutable", "parent", "component"],
        evaluation_rubric={
            "definition": "Clear distinction between ownership (parent vs internal)",
            "mutability": "Mention that props are read-only and state is changeable",
            "react_context": "Understand context of components"
        },
        candidate_answer="So, props are things you get from the parent component. They basically don't change once you get them, they are like read-only. State on the other hand is something the component keeps track of itself, like a counter, and it can change over time.",
        video_meta={"gaze_center_score": 85, "eye_contact_proxy": 80}
    )

    print("Running LLM-based evaluation...")
    result = await evaluate_answer(body)
    
    print("\n--- Evaluation Result ---")
    print(json.dumps(result, indent=2))
    
    if result["debug"]["method"] == "groq_llm":
        print("\n✅ Verification Successful: Used Groq LLM for grading.")
    else:
        print("\n❌ Verification Failed: Fell back to local heuristics.")

if __name__ == "__main__":
    asyncio.run(test_evaluation())
