# Troubleshooting and FAQ

## Does it cost anything?
No. Free local mode needs no account or card. Cloud is a separate paid service for sync, multiple users and phone approval.

## After `npx tryagentkey`, nothing logs in.
Setup creates the vault and a starter file. You still connect it to your agent. Import the tools from the generated `agentkey.mjs` and give them to your agent, or call `ak.login(url, { page })` in a script.

## Does the model ever see my password?
No. You enter it on the local approve page and it is filled into your browser page.

## A CAPTCHA or two-step code appeared.
AgentKey pauses and brings the window forward. Finish the step yourself and it continues. It does not solve them.

## Node version errors.
Use Node 22.12 or newer.

## It does not work on my site.
Some sites change their forms or block automation. Open an issue with the site, your framework and the output of `npx tryagentkey doctor`. Do not include passwords.

## Which agent frameworks work?
See [examples](../examples/) and the [Python examples](../packages/sdk-python/examples). Playwright, Vercel AI SDK, OpenAI Agents and LangChain are covered. Others may work if you control a Playwright or Puppeteer page.

## Can I self-host?
Free local mode runs entirely on your machine. The Cloud backend is not part of this repository.
