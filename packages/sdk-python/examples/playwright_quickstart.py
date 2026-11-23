# pip install "tryagentkey[playwright]" && playwright install chromium
from playwright.sync_api import sync_playwright
from tryagentkey import agentkey

ak = agentkey()  # Free Local Mode; cloud mode when AGENTKEY_API_KEY is set
with sync_playwright() as p:
    page = p.chromium.launch(headless=False).new_page()
    print(ak.login("https://github.com/login", page=page))  # {'outcome': 'completed', ...} — never the password
