# AgentKey

**Owner-approved logins for AI agents. Your agent signs in. It never sees the password.**

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/tryagentkey.svg)](https://www.npmjs.com/package/tryagentkey)
[![CI](https://github.com/edan-ais/agentkey/actions/workflows/ci.yml/badge.svg)](https://github.com/edan-ais/agentkey/actions/workflows/ci.yml)

[![AgentKey | A password vault for AI agents](https://img.youtube.com/vi/lQje0CK_ZX4/hqdefault.jpg)](https://youtu.be/lQje0CK_ZX4)

> Launch film: [AgentKey | A password vault for AI agents](https://youtu.be/lQje0CK_ZX4). Agents ask, you approve. Your agents, your rules.

AgentKey is a password vault built for AI agents. The agent asks to log in, you approve, and AgentKey fills the credential into your browser page. The password does not pass through your agent or your model.

## Try it

```sh
npm install tryagentkey
npx tryagentkey
```

That sets up a local vault and coding-agent instructions. If your project already has a supported Playwright MCP existing-browser connection in `.mcp.json`, it registers AgentKey on that connection too. Restart the coding host's MCP connection once to load the new tools. The browser stays the same; AgentKey does not create a replacement browser or copy a profile.

The supported automatic connection is one `npx @playwright/mcp` server configured with `--extension`, `--cdp-endpoint=...`, or a project `--config` file that names an existing browser endpoint. Unsupported configurations are left unchanged with a reason. Setup does not grant website access: the owner still approves on the local approval page.

With that host connected, ask your agent to log in. It uses `agentkey_pages`, `agentkey_login`, and `agentkey_status`. Browser tools are paused while a login is in progress. Passwords are entered on the local owner approval page, never in agent messages. Completion requires sign-out evidence and the saved username on the original site. Sites with no exact identity evidence remain unverified.

Other frameworks can use explicit browser wiring. See [examples](examples/) for runnable files:

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

- Automatic browser registration currently supports the project Playwright MCP connection described above, not every agent. A host restart is required after its configuration changes. Other hosts use the existing SDK adapters or coding-agent instructions.
- You need a browser page your agent controls (Playwright or a supported framework).
- CAPTCHAs and two-step codes pause and hand control to you. AgentKey does not solve them.
- This is not a sandbox. Code running inside your agent process is trusted. See [SECURITY.md](SECURITY.md).
- Tests do not cover every site or browser. Try a throwaway login first.

## Help

[![Add to Kiro](https://kiro.dev/images/add-to-kiro.svg)](https://kiro.dev/launch/mcp/add?name=AgentKey&config=%7B%22url%22%3A%22https%3A%2F%2Fagentkey.waiwiser.com%2Fapi%2Fagent-connectors%2Fmcp%22%2C%22disabled%22%3Afalse%2C%22autoApprove%22%3A%5B%5D%7D)

- [Privacy policy](https://agentkey.waiwiser.com/privacy)
- Support: [agentkey@waiwiser.com](mailto:agentkey@waiwiser.com)

- [Troubleshooting and FAQ](docs/TROUBLESHOOTING.md)
- [Open an issue](https://github.com/edan-ais/agentkey/issues/new/choose) or start a [discussion](https://github.com/edan-ais/agentkey/discussions)
- [Contributing](CONTRIBUTING.md)
- Release notes: [releases/](releases/)

## License

Apache-2.0. Copyright 2026 AgentKey, Inc. The license permits commercial reuse and forks. It does not grant rights to the AgentKey brand. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The hosted application and backend are not in this repository.

Other MCP servers, browser extensions and arbitrary code under the same OS account are outside this wrapper's lock. Do not expose another browser-control channel or recording tool to the model during credential use. The exact Playwright MCP dependency is pinned to0.0.86, but npx downloads still trust the npm registry/package integrity process. This is not isolation from a compromised host or OS user. The installer leaves a0600 recovery backup of the prior MCP config; after verifying the new host connection, remove that named backup if no longer needed.


Security boundary: this bridge protects against a model whose only browser access is the filtered MCP tools on this connection. The local `machine.key` sits beside `vault.enc`. Any process running as the same OS user, including a model with shell access, can read the key and decrypt saved logins. In CDP mode another local process can drive that browser. This is not a sandbox, hardware-backed vault, or proof of human presence. The legacy approval wording about the computer means local storage, not isolation from other programs on it. Do not give the model another browser-control channel or shell access if this boundary is required. The busy window runs from accepting a login request until residual credential DOM is destroyed; other servers and extensions are not locked. Local vault writes do not support concurrent writers; use one bridge process per vault. Bare setup requires a desktop session and opens owner approval separately. Direct legacy `init` is for a human terminal, not an agent terminal.
