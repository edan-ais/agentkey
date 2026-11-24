# Security

## Report a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private reporting: go to the Security tab of this repository and choose "Report a vulnerability". If that is unavailable, open an issue that says only "security contact request" with no details, and we will reach out.

We aim to reply within 3 business days.

## What AgentKey protects

- The agent and the model are not given the password. It is filled into your browser page after you approve.
- Credentials are not returned by SDK or MCP tools.

## What it does not protect against

- Malicious code running inside your agent process. That process is trusted.
- A page you approve that is not the site you meant. Check the site on the approve page.
- Every site and browser. Tests are not exhaustive.
- Saving a login from a web page prompt is part of the browser extension, which is not in this repository.
