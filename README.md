# AgentKey

**Owner-approved logins for AI agents. Your agent signs in. It never sees the password.**

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/tryagentkey.svg)](https://www.npmjs.com/package/tryagentkey)
[![CI](https://github.com/edan-ais/agentkey/actions/workflows/ci.yml/badge.svg)](https://github.com/edan-ais/agentkey/actions/workflows/ci.yml)

> Demo film: coming soon. This space is reserved for a short real recording of an agent logging in through AgentKey.

AgentKey is a password vault built for AI agents. The agent asks to log in, you approve, and AgentKey fills the credential into your browser page. The password does not pass through your agent or your model.

## Try it

```sh
npm install tryagentkey
npx tryagentkey
```

That sets up a local vault, writes a starter file for your agent framework, and runs checks. Then connect it to your agent with a few lines. See [examples](examples/) for runnable files:

```js
import { agentkey } from "tryagentkey";
const ak = await agentkey();
await ak.login("https://github.com/login", { page }); // page is your Playwright page
```

Python:

```sh
pip install "tryagentkey[playwright]"
```
```python
from tryagentkey import agentkey
ak = agentkey()
ak.login("https://github.com/login", page=page)
```

Node 22.12 or newer. Python 3.9 or newer.

## Free local mode, and what Cloud adds

The free local mode is the whole SDK, not a trial. It works offline with no account and no card. You can read the code, run it, and fork it (Apache-2.0).

| | Free Local | AgentKey Cloud (paid) |
|---|---|---|
| Price | Free | See [agentkey.waiwiser.com/builders](https://agentkey.waiwiser.com/builders) |
| Users | You, on one machine | Many users and teams |
| Logins stored | On your computer | End-to-end encrypted, synced across devices |
| Approvals | Local approve page | Phone approval |
| Needs internet or account | No | Yes |

Cloud is for sync, multiple users and phone approval. It is not needed to use the SDK locally.

## Packages

| Package | Purpose |
| --- | --- |
| [`tryagentkey`](packages/sdk) | JavaScript SDK, CLI, local vault and connector helpers |
| [`tryagentkey` (Python)](packages/sdk-python) | Python SDK with Playwright, LangChain, OpenAI Agents, CrewAI and browser-use examples |
| [`@tryagentkey/runtime`](packages/agentkey-runtime) | Approved credential use in a browser page your agent already runs (cloud mode) |
| [`@tryagentkey/mcp`](packages/mcp) | MCP server for cloud mode. It needs an AgentKey Cloud token and is not a local-mode integration. |

## Limits, stated plainly

- Setup still ends with a step that connects AgentKey to your agent. Check `npx tryagentkey` output for the next step.
- You need a browser page your agent controls (Playwright or a supported framework).
- CAPTCHAs and two-step codes pause and hand control to you. AgentKey does not solve them.
- This is not a sandbox. Code running inside your agent process is trusted. See [SECURITY.md](SECURITY.md).
- Tests do not cover every site or browser. Try a throwaway login first.

## Help

- [Troubleshooting and FAQ](docs/TROUBLESHOOTING.md)
- [Open an issue](https://github.com/edan-ais/agentkey/issues/new/choose) or start a [discussion](https://github.com/edan-ais/agentkey/discussions)
- [Contributing](CONTRIBUTING.md)
- Release notes: [releases/](releases/)

## License

Apache-2.0. Copyright 2026 AgentKey, Inc. The license permits commercial reuse and forks. It does not grant rights to the AgentKey brand. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The hosted application and backend are not in this repository.
