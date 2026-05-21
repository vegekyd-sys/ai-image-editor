"""
Test: Full video upload flow
- Login → open project → open CUI → upload video → verify poster in attachments → send
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

    video_path = "/Users/tianyicai/Downloads/IMG_3725.mp4"

    task = f"""
    Go to http://localhost:3002/login
    1. Click "去登录" button
    2. Fill email: test-claude@makaron.app
    3. Fill password: TestAccount2026!
    4. Click "登录" button
    5. Wait 3 seconds for redirect
    6. Click on the first project card
    7. Wait 3 seconds for editor to load
    8. Now find the chat input area (textarea with placeholder "你想怎么修改这张图片？") and click on it
    9. Find the file upload input (it should accept "image/*,video/*") — it has aria-label="Upload photo to editor" or similar. Upload the file: {video_path}
    10. Wait 5 seconds for video processing (poster extraction)
    11. Take a screenshot and report what you see — especially look for:
        - A small video thumbnail with a play icon (▶) in the attachment area near the input
        - Any loading/processing indicators
        - The send button state (should be active/purple if video is attached)
    """

    agent = Agent(task=task, llm=llm)
    result = await agent.run(max_steps=20)
    print("\n\nFinal Result:", result.final_result() if hasattr(result, 'final_result') else str(result)[-500:])

if __name__ == "__main__":
    asyncio.run(main())
