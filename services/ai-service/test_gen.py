import asyncio
import os
from dotenv import load_dotenv
from pathlib import Path

# Load env variables
_env = Path("/Users/maliktl/Documents/projects/AI-Interview-Final/services/ai-service/.env")
load_dotenv(_env)

from app.routers.generate import generate_questions, GenBody

async def test_gen():
    body = GenBody(
        resume_summary="Software Engineer with 5 years experience in React and Node.js.",
        jd_text="Looking for a Senior Frontend Developer skilled in React, TypeScript, and state management.",
        count=20,
        difficulty="Hard"
    )
    
    print("Testing question generation...")
    try:
        # We need to call the function directly as the endpoint
        res = await generate_questions(body)
        print("\n--- Result ---")
        print(f"Number of questions: {len(res.questions)}")
        print(f"First question: {res.questions[0]['text']}")
        if "Could you walk me through" in res.questions[0]['text']:
            print("\n❌ FALLBACK DETECTED")
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")

if __name__ == "__main__":
    asyncio.run(test_gen())
