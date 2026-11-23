# pip install tryagentkey langchain langchain-openai playwright
from playwright.sync_api import sync_playwright
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from tryagentkey import agentkey
from tryagentkey.tools import langchain_tool

ak = agentkey()
with sync_playwright() as p:
    page = p.chromium.launch(headless=False).new_page()
    agent = create_react_agent(ChatOpenAI(model="gpt-4o-mini"), [langchain_tool(ak, page)])
    agent.invoke({"messages": [("user", "Sign in to https://github.com/login")]})
