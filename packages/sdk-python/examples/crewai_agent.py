# pip install tryagentkey crewai playwright
from playwright.sync_api import sync_playwright
from crewai import Agent, Task, Crew
from tryagentkey import agentkey
from tryagentkey.tools import crewai_tool

ak = agentkey()
with sync_playwright() as p:
    page = p.chromium.launch(headless=False).new_page()
    worker = Agent(role="Operator", goal="Sign in to sites the owner approved", backstory="Uses AgentKey; never sees passwords.", tools=[crewai_tool(ak, page)])
    Crew(agents=[worker], tasks=[Task(description="Sign in to https://github.com/login", expected_output="Signed in", agent=worker)]).kickoff()
