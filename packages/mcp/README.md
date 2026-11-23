# AgentKey MCP over stdio

This server exposes request, request status, grant use and operation receipt. It does not expose secret reads, owner approval, agent enrollment or credential contents.

Run Node22+ with `AGENTKEY_SERVICE_URL` set to your actual deployed control-plane HTTPS origin or the website API baseURL `https://agentkey.waiwiser.com/api/public/agentkey-api` and `AGENTKEY_ACCESS_TOKEN` supplied through the client's secure environment configuration:

```
node packages/mcp/server.mjs
```

Do not paste tokens into chat, model prompts or command arguments. The caller's enrolled agent token stays in the process environment. The server writes only newline-delimited JSON-RPC messages to stdout. Initialization versions supported:2025-06-18 and2024-11-05. Tool arguments reject unlisted fields and ambiguous origin paths. Outputs use an allowlist and never forward upstream errors or credential fields.

This is a local stdio integration, not remote Streamable HTTP. The Fly preview is not a configured control plane, and an already-running, paired extension is still required for credential fill. Grant use queues an operation reference and does not prove login. Integration installation depends on the host application's MCP support; saying "connect to AgentKey" alone cannot install an integration without that host's consent or configuration flow.

Protocol sources:
- https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- https://modelcontextprotocol.io/specification/2025-06-18/server/tools
