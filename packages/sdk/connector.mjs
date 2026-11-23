// AgentKey embedded connector SDK - DRAFT v0.3 proposal.
// Lets a developer's agent embed AgentKey as its password vault:
// register -> connect URL -> user consent -> tokens -> MCP tools.
// No credential is ever returned to the caller; tools are server-redacted.
import { randomBytes, createHash } from 'node:crypto'

const DEFAULT_ISSUER = 'https://agentkey.waiwiser.com'
const SCOPES = ['agentkey:updates', 'agentkey:inventory', 'agentkey:request', 'agentkey:fill']
const b64u = buf => Buffer.from(buf).toString('base64url')
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

function validIssuer(issuer) {
  const u = new URL(issuer)
  if (u.protocol !== 'https:' || u.origin !== issuer || u.username || u.password) throw Error('invalid_issuer')
  return issuer
}
function validClientId(id) {
  if (typeof id !== 'string' || !/^[-_A-Za-z0-9]{10,128}$/.test(id)) throw Error('invalid_client_id')
  return id
}
function validRedirect(u) {
  const x = new URL(u)
  const loop = x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname)
  if ((x.protocol !== 'https:' && !loop) || x.username || x.password || x.hash) throw Error('invalid_redirect_uri')
  return u
}
function validState(s) {
  if (typeof s !== 'string' || s.length < 16 || s.length > 2048) throw Error('invalid_state')
  return s
}
function validScopeList(list) {
  if (!Array.isArray(list) || !list.length || list.some(s => !SCOPES.includes(s) && s !== 'offline_access') || new Set(list).size !== list.length) throw Error('invalid_scope')
  return list.join(' ')
}
// Never print or return bearer material beyond the token object fields the API defines.
function tokenView(data) {
  if (!data || typeof data !== 'object' || typeof data.access_token !== 'string' || data.token_type !== 'Bearer') throw Error('invalid_token_response')
  return { access_token: data.access_token, refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : null, expires_in: data.expires_in, scope: typeof data.scope === 'string' ? data.scope : '' }
}

export function createAgentKeyConnector({ issuer = DEFAULT_ISSUER, clientId, redirectUri, fetchImpl = fetch, onTokens } = {}) {
  validIssuer(issuer)
  validClientId(clientId)
  validRedirect(redirectUri)
  if (typeof fetchImpl !== 'function' || (onTokens !== undefined && typeof onTokens !== 'function')) throw Error('invalid_client')
  const resource = issuer + '/api/agent-connectors/mcp'
  const ep = {
    register: issuer + '/api/agent-connectors/oauth/register',
    authorize: issuer + '/api/agent-connectors/oauth/authorize',
    token: issuer + '/api/agent-connectors/oauth/token',
    revoke: issuer + '/api/agent-connectors/oauth/revoke',
  }
  let tokens = null
  let generation = 0
  let rotating = null
  let revoking = null
  const setTokens = t => { tokens = t; return onTokens?.(t) }

  async function postForm(url, form) {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    const data = await r.json().catch(() => null)
    if (!r.ok) { const e = Error('agentkey_oauth_failed'); e.status = r.status; e.code = data && data.error; throw e }
    return data
  }

  return {
    issuer, clientId, redirectUri, resource,

    // Step 2: build the connect URL the end user taps inside the developer's agent UX.
    connectUrl({ scopes = [...SCOPES, 'offline_access'], state } = {}) {
      const verifier = b64u(randomBytes(32))
      const challenge = b64u(createHash('sha256').update(verifier).digest())
      const st = state || b64u(randomBytes(24))
      validState(st)
      const q = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
        resource, scope: validScopeList(scopes), state: st,
        code_challenge: challenge, code_challenge_method: 'S256',
      })
      return { url: ep.authorize + '?' + q.toString(), verifier, state: st }
    },

    // Step 3: after the owner consents, redeem the one-time code (2-minute TTL).
    async completeConnect({ code, verifier }) {
      if (typeof code !== 'string' || !/^[-_A-Za-z0-9]{20,128}$/.test(code)) throw Error('invalid_code')
      if (typeof verifier !== 'string' || verifier.length < 43 || verifier.length > 128) throw Error('invalid_verifier')
      const started = generation
      if (revoking) throw Error('disconnecting')
      const data = await postForm(ep.token, {
        grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        client_id: clientId, code_verifier: verifier, resource,
      })
      const view = tokenView(data); view.obtained_at = Date.now()
      if (generation !== started || revoking) throw Error('connection_changed')
      generation++
      await setTokens(view)
      return { scope: view.scope, expires_in: view.expires_in }
    },

    async refresh() {
      if (revoking || !tokens?.refresh_token) throw Error('not_connected')
      if (rotating?.generation === generation) return rotating.work
      const started = generation
      const refreshToken = tokens.refresh_token
      const work = (async () => {
        const data = await postForm(ep.token, {
          grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, resource,
        })
        if (generation !== started) throw Error('connection_changed')
        const view = tokenView(data)
        view.obtained_at = Date.now()
        await setTokens(view)
        return { scope: view.scope, expires_in: view.expires_in }
      })()
      rotating = { generation: started, work }
      try { return await work } finally { if (rotating?.work === work) rotating = null }
    },

    async accessToken() {
      const started = generation
      if (!tokens || revoking) throw Error('not_connected')
      if (Date.now() - tokens.obtained_at >= tokens.expires_in * 1000 ||
          (tokens.refresh_token && Date.now() - tokens.obtained_at > (tokens.expires_in - 60) * 1000)) await this.refresh()
      if (!tokens || revoking || generation !== started) throw Error('connection_changed')
      return tokens.access_token
    },

    // Persist/restore tokens so an embedded agent survives restarts.
    // The caller owns safe storage; this accepts only the fields the token endpoint issues.
    restore(view) {
      if (!view || typeof view.access_token !== 'string' || (view.refresh_token !== null && typeof view.refresh_token !== 'string') || !Number.isSafeInteger(view.obtained_at) || (view.expires_in !== undefined && (!Number.isSafeInteger(view.expires_in) || view.expires_in < 1))) throw Error('invalid_token_view')
      if (revoking) throw Error('disconnecting')
      generation++
      return setTokens({ access_token: view.access_token, refresh_token: view.refresh_token, expires_in: view.expires_in || 600, scope: view.scope || '', obtained_at: view.obtained_at })
    },

    // Step 4: MCP tool calls. Returns the server-redacted tool payload only.
    async callTool(name, args = {}) {
      if (typeof name !== 'string' || !/^agentkey_[a-z_]+$/.test(name)) throw Error('invalid_tool')
      const bearer = await this.accessToken()
      const r = await fetchImpl(resource, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': 'Bearer ' + bearer,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      })
      const text = await r.text()
      if (!r.ok) { const e = Error('agentkey_mcp_failed'); e.status = r.status; throw e }
      let payload = null
      for (const line of text.split('\n')) if (line.startsWith('data:')) { payload = line.slice(5).trim(); break }
      const msg = JSON.parse(payload || text)
      if (msg.error) { const e = Error('agentkey_tool_error'); e.code = msg.error.code; e.toolMessage = msg.error.message; throw e }
      const content = msg.result && msg.result.content
      if (!Array.isArray(content) || content.some(c => !c || c.type !== 'text' || typeof c.text !== 'string')) throw Error('invalid_tool_response')
      if (msg.result.isError) { const e = Error('agentkey_tool_rejected'); e.toolMessage = content.map(c => c.text).join(' '); throw e }
      return content.map(c => c.text).map(t => { try { return JSON.parse(t) } catch { return { text: t } } })
    },

    async updates() { return this.callTool('agentkey_updates') },
    async inventory() { return this.callTool('agentkey_inventory') },
    // origin must be the exact https origin; signinUrl is the site's real login page.
    async requestLogin({ origin, siteName, signinUrl }) {
      const o = new URL(origin)
      if (o.protocol !== 'https:' || o.origin !== origin) throw Error('invalid_origin')
      if (typeof siteName !== 'string' || !siteName || siteName.length > 200) throw Error('invalid_site_name')
      const s = new URL(signinUrl)
      if (s.protocol !== 'https:' || s.origin !== origin) throw Error('signin_url_must_be_same_origin')
      return this.callTool('agentkey_request_login', { origin, site_name: siteName, signin_url: signinUrl })
    },
    async requestStatus(requestId) {
      if (!uuid.test(requestId)) throw Error('invalid_id')
      return this.callTool('agentkey_request_status', { request_id: requestId })
    },
    async useGrant({ grantId, origin, executorKeyId, idempotencyKey = crypto.randomUUID() }) {
      if (!uuid.test(grantId) || !uuid.test(executorKeyId) || !uuid.test(idempotencyKey)) throw Error('invalid_id')
      const o = new URL(origin)
      if (o.protocol !== 'https:' || o.origin !== origin) throw Error('invalid_origin')
      return this.callTool('agentkey_use_grant', { grant_id: grantId, origin, executor_key_id: executorKeyId, idempotency_key: idempotencyKey })
    },

    // Disconnect: revokes this agent's whole token family server-side.
    async disconnect() {
      if (revoking) return revoking
      const started = generation
      if (!tokens) { generation++; return { revoked: false } }
      const work = (async () => {
        if (rotating?.generation === started) await rotating.work.catch(() => {})
        if (!tokens || generation !== started) throw Error('connection_changed')
        await postForm(ep.revoke, { token: tokens.refresh_token || tokens.access_token, client_id: clientId })
        generation++
        await setTokens(null)
        return { revoked: true }
      })()
      revoking = work
      try { return await work } finally { if (revoking === work) revoking = null }
    },
  }
}

// Embedded model: the developer provisions a vault per end user and the end user never
// creates an AgentKey account. Client ids come from operator provisioning
// (createAgentKeyDeveloper in ./developer); the redirect is always AgentKey's
// first-party code page, which the provisioning RPC pins server-side.
export function createEmbeddedConnector({ issuer = DEFAULT_ISSUER, clientId, fetchImpl = fetch, onTokens } = {}) {
  validIssuer(issuer)
  if (typeof clientId !== 'string' || !/^ak-emb-[A-Za-z0-9_-]{32}$/.test(clientId)) throw Error('invalid_client_id')
  return createAgentKeyConnector({ issuer, clientId, redirectUri: issuer + '/agent-connectors/code', fetchImpl, onTokens })
}

// Self-serve dynamic client registration (one call, developer side).
export async function registerAgentKeyClient({ issuer = DEFAULT_ISSUER, clientName, redirectUris, fetchImpl = fetch } = {}) {
  validIssuer(issuer)
  if (typeof clientName !== 'string' || !clientName || clientName.length > 200 || /[\r\n]/.test(clientName)) throw Error('invalid_client_name')
  if (!Array.isArray(redirectUris) || !redirectUris.length || redirectUris.length > 2) throw Error('invalid_redirect_uri')
  redirectUris.forEach(validRedirect)
  const r = await fetchImpl(issuer + '/api/agent-connectors/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName, redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', scope: [...SCOPES, 'offline_access'].join(' '),
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  const data = await r.json().catch(() => null)
  if (!r.ok) { const e = Error('agentkey_registration_failed'); e.status = r.status; e.code = data && data.error; throw e }
  if (!data || typeof data.client_id !== 'string') throw Error('invalid_registration_response')
  return { clientId: data.client_id, redirectUris: data.redirect_uris }
}
