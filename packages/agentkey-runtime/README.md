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
