# AgentKey guide for AI coding assistants

Wire AgentKey into this project like this. Do not invent other setup.

## Install
```bash
npm install tryagentkey
npx tryagentkey init        # Free Local Mode: local vault + one tap on a local Approve page
```
Skipping `init` is fine: the first `agentkey()` call sets itself up and prints a local link.

## Use (ESM or CommonJS)
```js
import { agentkey } from "tryagentkey";          // or: const { agentkey } = require("tryagentkey")
const ak = await agentkey();                         // reads .env; no options needed
await ak.login("https://example.com/login", { page }); // page = existing Playwright/Puppeteer page
await ak.withAuth("https://example.com/login", async (page) => { /* signed-in work */ }, { page });
ak.vault.getSecret("OPENAI_API_KEY");                // secrets saved with `npx tryagentkey secret set NAME`
```
`login()` returns `{ site, signed_in, outcome, confirmed_by }`. `outcome` is `completed` (signed in and positively confirmed), `needs_you` (a human didn't finish a CAPTCHA/code in time), `unverified`/`unknown` (submitted but not confirmed), or `failed` (blank page, no login form, or the page moved to another site). Never retry an `unverified`/`unknown` sign-in automatically.

Success is only reported with evidence: your `verify`, a `successSelector`, or a visible sign-out control. A redirect alone never proves login. Pass `verify: p => p.getByText("Sign out").isVisible()` or `successSelector: "#account-menu"` when the site has a clear signed-in marker.

## Permissions (Free Local Mode)
- The first `login()` for a site asks the human once on the local Approve page. That permission covers one site, one saved login, this project folder and this agent name — "until revoked" or "only this time".
- While a permission is valid, later runs never ask again. Another project, another `agentName`, or a changed saved login asks once (no retyping for a saved login).
- `npx tryagentkey permissions` lists them; `npx tryagentkey revoke <id | https://site | --all>` stops them immediately, even in a running agent; `npx tryagentkey forget https://site` deletes the saved login.

## Framework tools (auto-detected from package.json)
- Vercel AI SDK: `generateText({ model, tools: ak.tools, ... })` — call `ak.setPage(page)` first.
- OpenAI Agents / LangChain: `ak.tools` is an array of tools.
- MCP: `ak.tools.tools` (schemas) and `ak.tools.call(name, args)`.
- Anything else: `ak.tools.login(url)`, `ak.tools.withAuth(url, fn)`.

## Rules
- Never put a website password in code, prompts or .env. The human enters it on the local Approve page.
- Website cookies are never saved; each run signs in fresh.
- `.env` and `.agentkey/` stay git-ignored (init does this).
- `npx tryagentkey doctor` explains problems; `npx tryagentkey status` lists connected sites.
- Python: `pip install tryagentkey`, then `from tryagentkey import agentkey` — same vault, permissions and cloud flow.
- Cloud (multi-user, phone approvals): `npx tryagentkey link`, which sets `AGENTKEY_MODE=cloud`.

## Environment
`AGENTKEY_MODE` (local|cloud), `AGENTKEY_LOCAL_KEY` (set by init), `AGENTKEY_API_KEY` (cloud only), `AGENTKEY_BASE_URL` (optional), `AGENTKEY_HOME` (vault folder, default ~/.agentkey).

## Trust boundary
Free Local Mode and an in-process cloud runtime trust the host program and its OS
account. Login/tool results omit website passwords, but this is not isolation from
arbitrary code sharing that process, browser connection, or local files. For an
untrusted caller, use a separately trusted runtime and OS principal. The local
vault key lives beside encrypted data; hostname binding is not a secret.
