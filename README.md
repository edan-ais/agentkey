# AgentKey developer packages

Scoped, owner-approved credential access for AI agents, using the browser your agent already controls.

| Package | Purpose |
| --- | --- |
| `tryagentkey` | JavaScript SDK, local vault and connector helpers |
| `@tryagentkey/runtime` | Approved credential-use runtime for an existing browser page |
| `@tryagentkey/mcp` | MCP server and client configuration |

## Install

```sh
npm install tryagentkey
npx tryagentkey init
```

Free Local Mode is free forever. Hosted AgentKey Cloud is a separate paid service. See the [SDK guide](packages/sdk/README.md) and [runtime guide](packages/agentkey-runtime/README.md) for setup, approval boundaries and limitations.

This repository contains only the developer packages and their documentation. The hosted application and backend are not included. Package tests are not a guarantee of every browser, website or integration. Use a synthetic login to test your own setup before relying on it.

## License

Apache-2.0. Copyright 2026 AgentKey, Inc. The license permits commercial reuse and forks; it does not grant rights to the AgentKey brand. See LICENSE and NOTICE.
