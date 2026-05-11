"""
Test Makaron skill marketplace flow using browser-use.
Verifies: open home → see skills → click a skill → detail page opens.
"""
import asyncio
import os
from browser_use import Agent
from browser_use.llm.google.chat import ChatGoogle

async def main():
    llm = ChatGoogle(
        model="gemini-2.5-flash",
        api_key=os.environ.get("GOOGLE_API_KEY"),
    )
    print(f"Using GOOGLE_API_KEY: {'set' if os.environ.get('GOOGLE_API_KEY') else 'NOT SET'}")

    agent = Agent(
        task="""
        Go to https://www.makaron.app/home

        1. Wait for the page to load and look for skill cards (they have cover images and labels)
        2. Find a skill card that says "Daily Annotation" or has annotation/handwriting related text
        3. Click on that skill card
        4. Verify that a detail view or overlay opens showing more information about the skill
        5. Report what you see: the skill name, description, and whether there's an upload button or "Create" action
        """,
        llm=llm,
    )

    result = await agent.run()
    print("\n" + "=" * 60)
    print("RESULT:")
    print("=" * 60)
    print(result)

if __name__ == "__main__":
    asyncio.run(main())
