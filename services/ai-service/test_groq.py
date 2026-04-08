import asyncio
import os
import json
from openai import AsyncOpenAI
from pydantic import BaseModel

class TestModel(BaseModel):
    hello: str

client = AsyncOpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL", "https://api.groq.com/openai/v1")
)

async def test():
    try:
        completion = await client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
               {"role": "system", "content": "Return a JSON object containing a property 'hello' with a string."},
               {"role": "user", "content": "say hi"}
            ],
            response_format={"type": "json_object"}
        )
        content = completion.choices[0].message.content
        parsed = TestModel.model_validate_json(content)
        print("Success:", parsed)
    except Exception as e:
        print("Error:", repr(e))

asyncio.run(test())
