# AgentKey for Python

30-second auth for AI agents. Works on Windows, macOS and Linux (Python 3.9+).

```
pip install "tryagentkey[playwright]"
```
```python
from tryagentkey import agentkey
ak = agentkey()
ak.login("https://github.com/login", page=page)   # sync or async Playwright
```

- **Free Local Mode** (default): a local Approve page opens the first time; the login is locked on this computer in `~/.agentkey/vault.enc` (shared with the JS SDK). No website cookies are saved.
- **Permissions**: each approval covers one site, one saved login, this project folder and this agent name ("until revoked" or "only this time"). Valid permissions are reused without asking; `tryagentkey permissions` / `tryagentkey revoke <id|site|--all>` manage them.
- **Positive confirmation**: `signed_in` is only true with evidence (your `verify`, `success_selector`, or a visible sign-out control on a nonblank page without a login form or challenge). Blank or unsupported pages return `failed`; an unconfirmed submit returns `unverified` and is never retried.
- **Cloud mode**: set `AGENTKEY_API_KEY` (from `npx tryagentkey link`). The same one call does it all: trust this browser once, owner approval link, fill in your page, confirm. Paid plans sync across iPhone, web and Chrome.
- **MCP**: `uvx --from tryagentkey tryagentkey-mcp` (or `npx -y @tryagentkey/mcp`).
- **CLI**: `tryagentkey status`, `tryagentkey doctor`, `tryagentkey permissions`, `tryagentkey revoke`, `tryagentkey secret set NAME VALUE`.
- Starters in `examples/`: Playwright, LangChain, CrewAI, OpenAI Agents, browser-use.

Your agent and model never receive the password.

## Local host trust and login evidence

Free Local Mode trusts the code and OS account that run the SDK. It keeps saved
website passwords out of public login results and the normal vault facade, but
is not a sandbox against arbitrary code in that process or OS account. Its local
key is stored beside encrypted vault data; hostname binding is not a secret.
Use a separately trusted runtime/OS principal when the calling program itself
must not be able to read credentials. Do not give untrusted model-generated code
access to the SDK process, its files, browser connection, or execution account.

A navigation away from a login page never proves sign-in. Supply a site-specific
account verifier or authenticated success selector when possible. Without one,
the generic fallback requires a visible sign-out control on a nonblank page
without a login form or challenge. This generic signal does not identify which
account signed in; verify the account identity before account-sensitive work.
