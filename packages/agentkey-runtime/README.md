# AgentKey runtime (no extension)

Use AgentKey from the browser your agent already runs. No extension, no hosted browser.
Base URL: `https://agentkey.waiwiser.com/api/public/agentkey-api`

## 0. Ask AgentKey first
```js
const g = await AgentKeyRuntime.guide({agentToken, goal: {origin: 'https://news.ycombinator.com', site_name: 'Hacker News'}})
// g.path, g.next_action, g.next_call, g.blockers — using your live state
```
`POST /v1/guide` with `{environment: {browser: 'automation'|'extension'|'none', can_run_code}, goal: {origin, site_name, signin_url?}}`. `GET /v1` describes every route. Every error carries a `help` object with the fix; `RuntimeError.help` exposes it.

## 1. Enroll once
```js
import {AgentKeyRuntime, exportRuntimeKey} from '@tryagentkey/runtime'
const {runtime, key, approvalURL} = await AgentKeyRuntime.enroll({agentToken, agentId, label: 'My agent browser',
  onSession: s => secretStore.save('session', s)})
await secretStore.save('key', await exportRuntimeKey(key))
// Send approvalURL to the owner ("here is your link"). They compare the key and tap Trust.
await runtime.waitUntilEnabled()
```
API: `POST /v1/executor/pairings` (agent token, code hash only) -> `POST /v1/executor/redeem` (code + your public key, returns a session sealed to your key) -> `GET /v1/executor/self` until enabled. Code-based pairing from the owner page also works: skip `pairings` and redeem the owner's code.

## 2. Ask for a login (agent token, unchanged)
`POST /v1/requests` -> send link -> `POST /v1/grants/<id>/use` -> operation queued.
For an exact page: `runtime.registerTarget({origin})` then `POST /v2/target-requests` with the target id.

## 3. Fill in your existing page
```js
for (const op of await runtime.pending()) await runtime.fillOperation(op.operation_id, page, {verify: p => p.locator('text=Sign out').isVisible()})
```
Fails closed when the page origin differs or the form is ambiguous. Reports exactly one outcome. A submitted form without `verify` is `unknown`, never proof of login. Never retry an uncertain submission.

## Executor routes (executor session token)
`GET self`, `POST heartbeat`, `GET pending`, `GET operations/<id>` (no ciphertext), `POST operations/<id>/claim`, `POST target-operations/<id>/claim`, `POST operations/<id>/complete {completed|failed|unknown}`, `POST target-support`, `POST targets`, `POST session/refresh`. All under `/v1/executor/`.

Owner disabling the runtime stops new claims; poll `self()` and stop when it returns nothing.

## Agent-created login proposals (0.1.1)

An enrolled executor hosting an open Glove session can stage an encrypted login proposal for its owner. The session binds the owner, requesting agent, and executor. These methods do not create a website account by themselves, approve a grant, or import a login into an owner vault.

- `ownerRecipientKey(sessionId)` fetches the session owner's published recipient key.
- `proposeCreatedLogin({sessionId, agentId, origin, username, title, password})` seals the credential to that key and stages a proposal. `agentId` must match the agent bound to the session. `origin` must be an exact HTTPS origin. It returns a proposal identifier and state, not the password.
- `proposalStatus(proposalId, sessionId)` reads its state.
- `confirmLoginProposal(proposalId, sessionId)` records confirmed account creation. Call only after the website outcome is verified.
- `markLoginProposalUncertain(proposalId, sessionId)` preserves an uncertain outcome for owner recovery. Do not blindly repeat signup.
- `retractLoginProposal(proposalId, sessionId)` retracts a staged proposal when appropriate.
- `proposeLogin({sessionId, origin, recipientKeyId, ciphertext})` is the lower-level staging method for an already sealed envelope.

The exported `sealAgentLogin(login, scope, recipientPublicKeyB64)` helper uses an ephemeral X25519 key, HKDF-SHA256, and AES-256-GCM with the owner, agent, recipient-key identifier, and origin bound into authenticated data. The owner's recipient private key is needed to open the result. Server-side authorization and state checks still apply.

This runtime handles plaintext within the trusted executor process while sealing. Do not put a real password in a model prompt, tool result, log, or source file. A caller that passes a password string directly already has access to that string; this API alone does not hide it from that caller. Owner-vault import, backup, and device notification delivery are separate workflows and are not proved by staging or confirming a proposal.
