// AgentKey embedded developer SDK - DRAFT v0.1 proposal.
// Server-side helper for a developer's own backend: create a developer account,
// provision persistent embedded clients, and keep a neutral usage journal.
// Service-role only: the key never leaves the developer's backend, and no user
// credential or secret is ever returned here. No rates, no charges, no billing.
import { randomBytes, randomUUID } from 'node:crypto'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const EMBEDDED_REDIRECT = 'https://agentkey.waiwiser.com/agent-connectors/code'
const HOSTED_BRANDS = ['chatgpt', 'claude', 'town', 'cursor', 'meta/muse', 'openclaw']

function validUrl(u) {
  const x = new URL(u)
  if (x.protocol !== 'https:' || x.origin !== u || x.username || x.password) throw Error('invalid_url')
  return u
}
function validId(id, err = 'invalid_id') {
  if (typeof id !== 'string' || !uuid.test(id)) throw Error(err)
  return id
}
function validName(name) {
  if (typeof name !== 'string') throw Error('invalid_developer_metadata')
  const t = name.trim()
  if (!t || t.length > 80 || /[\u0001-\u001f\u007f]/.test(t)) throw Error('invalid_developer_metadata')
  return t
}
function validClientName(name) {
  const t = validName(name)
  if (HOSTED_BRANDS.includes(t.toLowerCase())) throw Error('invalid_client_metadata')
  return t
}
function validKind(kind) {
  if (typeof kind !== 'string' || kind.length < 1 || kind.length > 64 || /[\u0001-\u001f\u007f]/.test(kind)) throw Error('invalid_event')
  return kind
}
function validPeriod(period) {
  if (typeof period !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(period)) throw Error('invalid_period')
  return period
}

// newClientId: server-acceptable embedded client id, generated so callers cannot squat names.
export function newClientId() {
  return 'ak-emb-' + randomBytes(24).toString('base64url')
}

// createAgentKeyDeveloper({ supabaseUrl, serviceKey, fetchImpl })
// supabaseUrl: https origin of the AgentKey project's Supabase instance.
// serviceKey: string or async function returning the developer's service-role key.
//   A function keeps the key out of long-lived fields and lets callers rotate it.
export function createAgentKeyDeveloper({ supabaseUrl, serviceKey, fetchImpl = fetch } = {}) {
  const base = validUrl(supabaseUrl)
  if (typeof serviceKey !== 'string' && typeof serviceKey !== 'function') throw Error('invalid_service_key')
  if (typeof fetchImpl !== 'function') throw Error('invalid_client')
  const key = typeof serviceKey === 'function' ? serviceKey : async () => serviceKey

  async function rpc(fn, args) {
    const r = await fetchImpl(base + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: await key(),
        Authorization: 'Bearer ' + await key(),
      },
      body: JSON.stringify(args),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    const data = await r.json().catch(() => null)
    if (!r.ok) {
      const e = Error('agentkey_provisioning_failed')
      e.status = r.status
      if (data && typeof data.code === 'string') e.code = data.code
      throw e
    }
    return data
  }

  return {
    // One developer account per developer. Returns its id; store it server-side.
    async createAccount({ name } = {}) {
      const id = await rpc('ak_developer_account_create', { p_name: validName(name) })
      if (typeof id !== 'string' || !uuid.test(id)) throw Error('invalid_response')
      return { developerId: id }
    },

    // Provision one persistent embedded client (one per end user, or per install).
    // Idempotent on client id: created=false means the id already existed.
    // Cap: 100 clients per developer, enforced server-side.
    async provisionClient({ developerId, clientName, clientId = newClientId() } = {}) {
      validId(developerId, 'invalid_developer_id')
      const name = validClientName(clientName)
      if (typeof clientId !== 'string' || !/^ak-emb-[A-Za-z0-9_-]{32}$/.test(clientId)) throw Error('invalid_client_metadata')
      const created = await rpc('ak_developer_client_provision', {
        p_developer: developerId, p_client: clientId, p_name: name, p_redirect: EMBEDDED_REDIRECT,
      })
      if (typeof created !== 'boolean') throw Error('invalid_response')
      return { clientId, created }
    },

    // Record one neutral usage event. Retries are safe: the same eventId records once
    // and later attempts return recorded=false. Kinds are descriptive labels only;
    // they are not billable classifications.
    async recordUsage({ clientId, ownerId, kind, eventId = randomUUID() } = {}) {
      if (typeof clientId !== 'string' || !/^ak-emb-[A-Za-z0-9_-]{32}$/.test(clientId)) throw Error('invalid_client_id')
      validId(ownerId, 'invalid_owner_id')
      validId(eventId, 'invalid_event')
      const recorded = await rpc('ak_developer_usage_record', {
        p_event: eventId, p_client: clientId, p_owner: ownerId, p_kind: validKind(kind),
      })
      if (typeof recorded !== 'boolean') throw Error('invalid_response')
      return { eventId, recorded }
    },

    // Monthly rollup: named users (enabled bindings today) vs active users (distinct
    // owners with an event in the period). No billable unit is computed anywhere.
    async usageMonthly({ developerId, period } = {}) {
      validId(developerId, 'invalid_developer_id')
      const rows = await rpc('ak_developer_usage_monthly', { p_developer: developerId, p_period: validPeriod(period) })
      if (!Array.isArray(rows) || rows.length !== 1) throw Error('invalid_response')
      const row = rows[0]
      for (const k of ['named_users', 'active_users', 'events']) {
        if (!Number.isSafeInteger(row?.[k]) || row[k] < 0) throw Error('invalid_response')
      }
      return { namedUsers: row.named_users, activeUsers: row.active_users, events: row.events }
    },
  }
}
