# tryagentkey

**30-second auth & local secrets vault for AI agents. Zero config, local-first.**

```bash
npm install tryagentkey && npx tryagentkey   # sets up the vault, writes agentkey.mjs for your framework, runs checks
```
```js
const ak = await agentkey(); await ak.login("https://github.com/login", { page });
```

No card. No cloud account. The password is entered on a local Approve page and filled into your own
browser page — your agent and model never see it.

## Frameworks

**Vercel AI SDK**
```js
ak.setPage(page);
await generateText({ model, tools: ak.tools, prompt: "Sign in to GitHub and star agentkey" });
```
**OpenAI Agents / LangChain** — `ak.tools` is a ready tool array: `new Agent({ tools: ak.tools })`.

**MCP** — `ak.tools.tools` lists schemas; `ak.tools.call(name, args)` handles calls.

**Playwright (plain)**
```js
await ak.withAuth("https://github.com/login", async (page) => page.goto("https://github.com/settings"), { page });
```

CommonJS works too: `const { agentkey } = require("tryagentkey")` (Node 22.12+).

## Commands
`npx tryagentkey init` · `doctor` · `status` · `secret set NAME` · `link`

CAPTCHA or two-step code? AgentKey pauses, brings the window forward, and continues once you finish.
Cookies are never saved; every run signs in fresh.

AI assistant? Read `node_modules/tryagentkey/AGENTKEY_GUIDE.md`.

## Free Local vs Cloud

| | Free Local | AgentKey Cloud |
|---|---|---|
| Price | Free forever | $475 Founding Builder Pack ([details](https://agentkey.waiwiser.com/builders)) |
| Users | You (single user) | Many users and teams |
| Logins | Locked on your computer | End-to-end encrypted, synced |
| Approvals | Local Approve page | Phone, with Face ID |
| Needs internet/account | No | Yes |

---

## Cloud mode (after `npx tryagentkey link`)

# AgentKey embedded connector SDK (draft v0.3)

Embed AgentKey as your agent's password vault. Your agent asks for login
permission; the vault owner approves once on an AgentKey page; your agent uses
the approved login through AgentKey's executor. Passwords are never returned
to your agent or your servers.

## Install (once published)

```bash
npm install tryagentkey
```

## Quickstart

```js
import { registerAgentKeyClient, createAgentKeyConnector } from 'tryagentkey'

// 1. Once per agent: self-serve registration.
const { clientId } = await registerAgentKeyClient({
  clientName: 'Your Agent Name',
  redirectUris: ['https://agentkey.waiwiser.com/agent-connectors/code'],
})

// 2. Per end user: build a one-tap connect link.
const ak = createAgentKeyConnector({
  clientId,
  redirectUri: 'https://agentkey.waiwiser.com/agent-connectors/code',
  onTokens: t => saveTokensForYourUser(yourUserId, t), // you own storage
})
const { url, verifier, state } = ak.connectUrl()
// Send `url` to your user in your own channel. They sign in to AgentKey,
// review your agent's exact permissions, and approve once.
// The code page shows a one-time code (2-minute TTL).

// 3. Redeem the code your user pastes back.
await ak.completeConnect({ code: codeFromUser, verifier })

// 4. Use the vault. Restore tokens first if your process restarted.
ak.restore(loadTokensForYourUser(yourUserId))
const { logins } = (await ak.inventory())[0]
const [req] = await ak.requestLogin({
  origin: 'https://example.com',
  siteName: 'Example',
  signinUrl: 'https://example.com/login',
})
// Send req.signin_link to your user. They tap it to seal the login.
const [status] = await ak.requestStatus(req.request_id)
// Once approved: await ak.useGrant(status.grant_id)

// 5. Disconnect
await ak.disconnect()
```

## What the owner sees and controls

- One-time consent naming your agent, its permissions and the verified executor.
- Login requests arrive as tap-to-approve AgentKey links; a standing grant
  covers repeat use ("approve once").
- Revocation is owner-controlled in AgentKey at any time.

## Two integration models

**Owner-account (above).** Each end user has their own AgentKey account and one
verified executor. Register your agent with `registerAgentKeyClient` and use
`createAgentKeyConnector`.

**Embedded (developer-provisioned).** Your end users never create an AgentKey
account. AgentKey provisions a vault per end user behind your one-time consent
page tap, and your agent talks to AgentKey with the same token + MCP surface as
above.

Embedded client ids look like `ak-emb-<32 chars>`. AgentKey includes
a signed-in, owner-scoped developer console at `/developers` to create an
embedded developer account, provision clients, view named/active usage,
inspect connected end users and revoke an end user's access. The backend
uses authenticated service-only RPCs and owner-specific tenant scoping.

**Release status:** The self-serve console and API have source and database
tests, but a fresh developer's full live onboarding and published SDK
installation are not yet accepted. Do not give developers an AgentKey
service-role key. The `createAgentKeyDeveloper` helper in `./developer`
is an **internal operator-only** service-key helper, not a customer SDK
authentication method. Developer billing is not connected.

```js
import { createEmbeddedConnector } from 'tryagentkey/connector'

// Per end user, once provisioned:
const ak = createEmbeddedConnector({ clientId: 'ak-emb-...' ,
  onTokens: t => saveTokens(yourUserId, t) })
const { url, verifier } = ak.connectUrl()
// Send `url` to your user. They review your agent on an AgentKey page, set a
// vault passphrase and approve once - no AgentKey account is created.
// The code page shows a one-time code (2-minute TTL).
await ak.completeConnect({ code: codeFromUser, verifier })
// Inventory, login requests, grant use and disconnect work exactly as above.
```

The embedded redirect is always AgentKey's first-party code page
(`https://agentkey.waiwiser.com/agent-connectors/code`), pinned server-side.

## Usage journal (embedded)

AgentKey records neutral setup events for your provisioned users
(`provision`, `connection_completed`) and keeps monthly named-user and
distinct-active-user counts. These are descriptive records, not billable
classifications; no rates or charging exist yet. Rollups are available to the
operator via `usageMonthly` in `./developer`.

## Guarantees and limits (both models)

- Tool responses are server-redacted: site origins and account labels only,
  never passwords, cookies or one-time codes.
- The connector cannot approve itself, widen its own scope or pick a different
  executor.
- Owner-account model: each end user needs an AgentKey account and one
  verified executor (the AgentKey app or Chrome extension).
- Embedded model: end-user revocation is available in the authenticated
  developer console. Client-side SDK revocation acts only on the holder's
  own OAuth token; tenant-wide administrative revocation stays server-side.

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


## Existing agent-browser integration (staged release)

`tryagentkey/browser` exports setupExistingBrowserAgentKey for an already-running, owner-authorized Playwright-compatible browser with AgentKey's paired extension. Additional entry points are browser/puppeteer, browser/playwright, browser/framework, browser/openai-agents and browser/conformance. This never opens another browser or copies a profile. The trusted host must disable recordings and expose only the returned gated browser tools. Use the owner's verified executor public key, not a key supplied by the model.

An observed human-verification check returns challenge_required with challenge_type human_verification. The owner completes it in that same browser. Call resume to recheck the existing attempt, never to refill or solve the check. The original verification window is at most five minutes and is not extended. Expiry or an unrecognized challenge stays unverified. A fill or submission is not a successful sign-in.

Production acceptance is pending an authorized original browser/profile and paired executor. Minimum extension version for the explicit human_verification state is 0.3.1. The installed extension must support the matching challenge state. Store0.3.0 supports target-v2 but does not report human_verification yet. This integration does not remotely control the owner's personal browser or connect Instinct to it.


## Bare setup for coding agents

Run `npx tryagentkey`. Free Local Mode needs no AgentKey account. Setup first preflights all instruction files, then appends a managed section to project AGENTS.md and to an existing CLAUDE.md, preserving other text. Your coding agent reads those instructions and wires the local SDK into its actual existing browser tools; the developer does not add the lines manually. Existing instruction files with symlinks, hard links, conflicting managed markers or a different managed section are refused before setup begins. Existing files are never rewritten. Writes are append-only with checks before and after, not a multi-file transaction or a guarantee against concurrent edits. A late failure reports partial changes; inspect them before retrying. Existing cloud configurations are preserved and their doctor check may contact the cloud service. Free Local Mode makes no AgentKey cloud calls.

This installs instructions, not a running MCP server or automatic browser attachment. Agent wiring remains pending until the supported coding agent carries it out and a real authorized login completes. Runtime agents that cannot edit their project still need a browser bridge. No website login permission is granted by setup.
