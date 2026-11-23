"""Pre-shaped tool specs for LangChain, CrewAI and OpenAI Agents. None return passwords."""
LOGIN_SCHEMA = {"type": "object", "properties": {"url": {"type": "string", "description": "https sign-in page"}}, "required": ["url"], "additionalProperties": False}

def openai_tools():
    return [{"type": "function", "function": {"name": "agentkey_login", "description": "Sign the agent's browser in to a site with an owner-approved login. Never returns the password.", "parameters": LOGIN_SCHEMA}}]

def langchain_tool(ak, page):
    from langchain_core.tools import tool
    @tool("agentkey_login")
    def agentkey_login(url: str) -> dict:
        """Sign in to a site with an owner-approved AgentKey login. Never returns the password."""
        return ak.login(url, page=page)
    return agentkey_login

def crewai_tool(ak, page):
    from crewai.tools import tool
    @tool("agentkey_login")
    def agentkey_login(url: str) -> dict:
        """Sign in to a site with an owner-approved AgentKey login. Never returns the password."""
        return ak.login(url, page=page)
    return agentkey_login
