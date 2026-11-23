# pip install tryagentkey openai-agents playwright
import asyncio
from playwright.async_api import async_playwright
from agents import Agent, Runner, function_tool
from tryagentkey import agentkey

ak = agentkey()

async def main():
    async with async_playwright() as p:
        page = await (await p.chromium.launch(headless=False)).new_page()

        @function_tool
        async def agentkey_login(url: str) -> dict:
            """Sign in with an owner-approved AgentKey login. Never returns the password."""
            return await ak.login(url, page=page)

        agent = Agent(name="Operator", tools=[agentkey_login])
        print((await Runner.run(agent, "Sign in to https://github.com/login")).final_output)

asyncio.run(main())
