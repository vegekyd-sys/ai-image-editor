"""
Test: CUI video upload flow on localhost:3002
1. Login with test account
2. Open an existing project
3. Open CUI (chat)
4. Upload a video file
5. Verify poster appears in attachment area
6. Send message
7. Verify video appears in timeline
"""
import asyncio
import os

async def main():
    from browser_use import Agent
    from browser_use.llm.google.chat import ChatGoogle

    llm = ChatGoogle(
        model="gemini-2.5-flash",
        api_key=os.environ.get("GOOGLE_API_KEY"),
    )

    task = """
    Go to http://localhost:3002/login
    1. Click "去登录" button
    2. Fill email: test-claude@makaron.app
    3. Fill password: TestAccount2026!
    4. Click "登录" button
    5. Wait for redirect to projects page
    6. Click on the first project card to open it
    7. Wait for editor to load (look for the image canvas)
    8. Report what you see — is there an upload button? Is there a chat button?
    """

    agent = Agent(task=task, llm=llm)
    result = await agent.run(max_steps=15)
    print("Result:", result)

if __name__ == "__main__":
    asyncio.run(main())
