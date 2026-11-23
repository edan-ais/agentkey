# pip install tryagentkey browser-use
# browser-use drives its own Playwright page; sign in first, then hand the page to the agent.
import asyncio
from playwright.async_api import async_playwright
from tryagentkey import agentkey

async def main():
    ak = agentkey()
    async with async_playwright() as p:
        page = await (await p.chromium.launch(headless=False)).new_page()
        print(await ak.login("https://github.com/login", page=page))
        # Continue with browser-use on the same signed-in page/context.

asyncio.run(main())
