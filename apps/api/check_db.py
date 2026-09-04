import asyncio
from prisma import Prisma

async def main():
    db = Prisma()
    await db.connect()
    
    # Get the latest response with analysisMeta
    response = await db.response.find_first(
        order={'createdAt': 'desc'},
        where={'analysisMeta': {'not': None}}
    )
    
    if response:
        print(f"Latest Response ID: {response.id}")
        print(f"Analysis Meta: {response.analysisMeta}")
    else:
        print("No responses with analysisMeta found.")
        
    await db.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
