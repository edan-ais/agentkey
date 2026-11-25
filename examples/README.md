# Examples

Run `npm install tryagentkey playwright` first. Each file asks you to approve the login on a local page. The password never reaches the script or the model.

| File | What it shows |
| --- | --- |
| [playwright-login.mjs](playwright-login.mjs) | Plain Playwright: log in to a site with one call |
| [vercel-ai-agent.mjs](vercel-ai-agent.mjs) | An LLM agent that logs in when you ask in plain English |
| [puppeteer-login.mjs](puppeteer-login.mjs) | Plain Puppeteer: log in to a site with one call |
| [openai-agents.mjs](openai-agents.mjs) | An OpenAI Agents agent that logs in with the ready-made tool array |

Python examples live in [packages/sdk-python/examples](../packages/sdk-python/examples): Playwright, LangChain, OpenAI Agents, CrewAI and browser-use.

Use a throwaway login the first time.
