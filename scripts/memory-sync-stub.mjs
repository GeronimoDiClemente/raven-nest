#!/usr/bin/env node
// Stub of the Nest Memory sync service — implements the wire contract of
// docs/superpowers/specs/2026-08-31-memory-sync-backend-design.md §5, and only that.
//
// WHY THIS EXISTS: the real service (§6 schema, Postgres, multi-tenant) is a separate
// plan and does not exist yet. Without something on the other end of the socket, the
// client changes C1-C8 can only be unit-tested — the thing they were built for, two Nest
// instances converging, cannot be exercised at all. This closes that gap today.
//
// WHAT IT IS NOT: not the real service. It keeps everything in memory (plus an optional
// JSON snapshot), has no tenancy, no quotas, no rate limits, and no durability story. Do
// not point a machine you care about at it and do not run it anywhere public. When the
// real service lands, delete this file.
//
// WHAT IT DOES GET RIGHT, deliberately, because these are the parts the client can
// actually be wrong about:
//   - §5.1 push: per-mutation outcomes, and idempotency keyed by (device_id, seq).
//   - §5.2 pull: project_key on every row, tags as a real array, client_updated_at
//     preserved as the CLIENT's timestamp rather than the server's.
//   - §5.3 status: including next_poll_ms, the one cost lever the design has.
//   - §5.4: serves the old Supabase-shaped routes as aliases, so it can be pointed at a
//     Nest build that predates the route change.
//   - §7: project_seq allocated by range, monotonic and gapless per project.
//   - §8.1: a topic collision SUPERSEDES the loser instead of rejecting it. The old
//     Supabase server rejected, the client marked the mutation pushed, and the memory was
//     lost forever. Getting this wrong is the whole reason the old backend is being
//     replaced, so the stub must not reproduce it.
//   - §8.2: tombstones. `content` may be null and `op: "delete"` is actually read — the
//     old server never looked at `op` at all, so deletes never crossed between machines.
//
// Usage:
//   node scripts/memory-sync-stub.mjs --port 8787 --token nmk_dev_token
//   node scripts/memory-sync-stub.mjs --port 8787 --token nmk_dev_token --state ./stub-state.json
//
// Then, in each Nest instance's ~/.raven-nest/memory/connection.json, set
//   "syncBaseUrl": "http://127.0.0.1:8787"
// and put the same token in via the Settings card.

import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

// ── args ────────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const PORT = Number(arg('port', '8787'))
const TOKEN = arg('token', 'nmk_dev_token')
const STATE_PATH = arg('state', null)
const NEXT_POLL_MS = Number(arg('poll', '300000'))
const VERBOSE = process.argv.includes('--verbose')

// The service stores only the hash, never the token (§9.1). Pointless for a local stub
// on its own, but it keeps the stub honest about the shape of the real thing.
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex')

// ── state ───────────────────────────────────────────────────────────────────

/**
 * projects: Map<project_key, { seqCounter, displayName }>
 * observations: Map<sync_id, row>
 * receipts: Map<`${device_id}:${seq}`, outcome>   // §5.1 idempotency
 * devices: Map<device_id, { name, lastSeenAt }>
 */
const state = {
  projects: new Map(),
  observations: new Map(),
  receipts: new Map(),
  devices: new Map(),
}

if (STATE_PATH && existsSync(STATE_PATH)) {
  const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
  state.projects = new Map(raw.projects ?? [])
  state.observations = new Map(raw.observations ?? [])
  state.receipts = new Map(raw.receipts ?? [])
  state.devices = new Map(raw.devices ?? [])
  log(`loaded state: ${state.observations.size} observations, ${state.projects.size} projects`)
}

function persist() {
  if (!STATE_PATH) return
  writeFileSync(
    STATE_PATH,
    JSON.stringify(
      {
        projects: [...state.projects],
        observations: [...state.observations],
        receipts: [...state.receipts],
        devices: [...state.devices],
      },
      null,
      2
    )
  )
}

function log(...parts) {
  console.log(`[stub] ${parts.join(' ')}`)
}

function vlog(...parts) {
  if (VERBOSE) log(...parts)
}

// ── §7: project_seq by range ────────────────────────────────────────────────
// The spec forbids a global bigserial: sequences are consumed outside the transaction, so
// two concurrent writers can commit 105 before 104, and a client polling in between
// advances its cursor past 104 forever. Node is single-threaded so this is trivially safe
// here — the point is that the stub allocates the same SHAPE the real service must, so a
// client that depends on gapless per-project ordering is genuinely exercised.
function allocateSeqRange(projectKey, displayName, count) {
  let project = state.projects.get(projectKey)
  if (!project) {
    project = { seqCounter: 0, displayName: displayName ?? projectKey }
    state.projects.set(projectKey, project)
  }
  if (displayName && project.displayName !== displayName) project.displayName = displayName
  const start = project.seqCounter + 1
  project.seqCounter += count
  return start
}

// ── §8.1: topic collision resolves by superseding, never by rejecting ───────
// Same deterministic LWW the client computes in electron/memory-merge.ts: greater
// client_updated_at, then greater lamport, then greater sync_id lexicographically. Both
// sides must compute the same winner independently, so this cannot diverge from the
// client's rule without breaking convergence.
function lwwWinner(a, b) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  if (a.lamport !== b.lamport) return a.lamport > b.lamport ? a : b
  return a.syncId > b.syncId ? a : b
}

function findActiveTopicOwner(projectKey, scope, topicKey, excludeSyncId) {
  for (const row of state.observations.values()) {
    if (
      row.project_key === projectKey &&
      row.scope === scope &&
      row.topic_key === topicKey &&
      row.sync_id !== excludeSyncId &&
      !row.deleted &&
      row.superseded_by === null
    ) {
      return row
    }
  }
  return null
}

// ── handlers ────────────────────────────────────────────────────────────────

function normalizeTags(value) {
  if (Array.isArray(value)) return value.filter((t) => typeof t === 'string')
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.filter((t) => typeof t === 'string')
    } catch {
      /* not JSON — treat as untagged */
    }
  }
  return []
}

function parseClientTimestamp(value) {
  // §5.2: the client may send epoch ms or ISO 8601, and the value is the CLIENT's, not
  // the server's. Storing server time here would silently corrupt every LWW comparison.
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return Date.now()
}

// §9.1/§5.1: device identity for idempotency is resolved from the auth token, never from
// the request body. `body.device_id` is still accepted on the wire (the real client sends
// it) and used only for the `devices` map below, which is display bookkeeping, not the
// receipt key. A receipt key a client can pick at will is not idempotency, it is a
// client-chosen namespace — a device could pick a fresh device_id on every retry and
// double-apply anything it wanted. Keying it on the token instead is what the real service
// does (server/src/push.ts resolves `auth.deviceId` from the bearer token and comments
// that the body field must never drive receipt lookups); a stub that trusted the body
// field instead was hiding exactly the mismatch that a contract check against the real
// service caught: two runs sharing a token do NOT get isolated receipt buckets just
// because they claim different device_id strings.
function handlePush(body) {
  const claimedDeviceId = body.device_id ?? 'unknown-device'
  const deviceId = TOKEN_HASH
  const mutations = Array.isArray(body.mutations) ? body.mutations : []
  if (mutations.length > 500) return { status: 413, body: { error: 'batch_too_large' } }

  // `name` keeps the client-claimed device_id for readability in logs/state dumps — it is
  // never used as a lookup key. The map key (`deviceId`) is the token-derived identity.
  state.devices.set(deviceId, {
    name: state.devices.get(deviceId)?.name ?? claimedDeviceId,
    lastSeenAt: Date.now(),
  })

  const results = []

  // One range for the whole batch, matching §7's single UPDATE ... RETURNING per push.
  const byProject = new Map()
  for (const m of mutations) {
    const key = m.payload?.project_key ?? '__global__'
    byProject.set(key, (byProject.get(key) ?? 0) + 1)
  }
  const nextSeq = new Map()
  for (const [key, count] of byProject) {
    const displayName = mutations.find((m) => m.payload?.project_key === key)?.payload?.project_display_name
    nextSeq.set(key, allocateSeqRange(key, displayName, count))
  }

  for (const m of mutations) {
    const receiptKey = `${deviceId}:${m.seq}`
    const prior = state.receipts.get(receiptKey)
    if (prior) {
      // §5.1 idempotency: a replay of the same (device_id, seq) returns the stored
      // outcome without applying anything again. The client retries any mutation missing
      // from `results`, and a lost response is indistinguishable from an unprocessed one.
      results.push(prior)
      vlog(`replay ${receiptKey} -> ${prior.outcome}`)
      continue
    }

    const p = m.payload ?? {}
    const syncId = m.sync_id ?? p.sync_id
    const projectKey = p.project_key ?? '__global__'
    const scope = p.scope ?? 'personal'
    const topicKey = p.topic_key ?? null
    const updatedAt = parseClientTimestamp(p.updated_at ?? p.client_updated_at)
    const lamport = Number(p.lamport ?? 0)
    const isDelete = m.op === 'delete' // §8.2 — the old server never read this

    const seq = nextSeq.get(projectKey)
    nextSeq.set(projectKey, seq + 1)

    let supersededBy = null

    if (topicKey && !isDelete) {
      const owner = findActiveTopicOwner(projectKey, scope, topicKey, syncId)
      if (owner) {
        const incoming = { syncId, updatedAt, lamport }
        const existing = { syncId: owner.sync_id, updatedAt: owner.client_updated_at, lamport: owner.lamport }
        const winner = lwwWinner(existing, incoming)
        if (winner === incoming) {
          // §8.1: the incoming wins, so the OLD row is superseded and keeps existing.
          // Nothing is discarded — append first. Rejecting here is what lost memories.
          owner.superseded_by = syncId
          owner.project_seq = allocateSeqRange(projectKey, undefined, 1)
          vlog(`topic collision on ${topicKey}: ${syncId} wins, superseded ${owner.sync_id}`)
        } else {
          // The existing wins, so the incoming is stored ALREADY superseded. It is still
          // accepted and still replicates — the client learns who won from the pull.
          supersededBy = owner.sync_id
          vlog(`topic collision on ${topicKey}: ${owner.sync_id} wins, ${syncId} stored superseded`)
        }
      }
    }

    state.observations.set(syncId, {
      sync_id: syncId,
      project_key: projectKey,
      project_seq: seq,
      scope,
      type: p.type ?? 'discovery',
      topic_key: topicKey,
      title: p.title ?? '',
      // §8.2: nullable on purpose. A delete nulls the content and the row still travels.
      content: isDelete ? null : (p.content ?? null),
      tags: normalizeTags(p.tags),
      content_hash: p.content_hash ?? null,
      origin_ai: p.origin_ai ?? null,
      origin_account: p.origin_account ?? null,
      git_branch: p.git_branch ?? null,
      author_display: p.author_display ?? null,
      lamport,
      client_updated_at: updatedAt,
      server_created_at: Date.now(),
      deleted: isDelete || Boolean(p.deleted),
      superseded_by: supersededBy,
    })

    const result = {
      sync_id: syncId,
      outcome: supersededBy ? 'superseded' : 'applied',
      project_seq: seq,
    }
    state.receipts.set(receiptKey, result)
    results.push(result)
  }

  persist()
  return { status: 200, body: { results } }
}

function handlePull(body) {
  const cursors = body.cursors ?? {}
  const limit = Math.min(Number(body.limit ?? 500), 500)

  const rows = []
  for (const row of state.observations.values()) {
    const cursor = cursors[row.project_key]
    // A project this device never registered is simply not returned. The real service
    // must do the same: returning rows for unsent cursors is what made the old client
    // hot-loop, re-fetching from 0 forever (the M25 fix in memory-daemon.ts).
    if (cursor === undefined) continue
    if (row.project_seq > cursor) rows.push(row)
  }
  rows.sort((a, b) => a.project_seq - b.project_seq)
  const page = rows.slice(0, limit)

  const nextCursors = { ...cursors }
  for (const row of page) {
    if (row.project_seq > (nextCursors[row.project_key] ?? 0)) {
      nextCursors[row.project_key] = row.project_seq
    }
  }

  return {
    status: 200,
    body: {
      // §5.2: project_key on every row (the client maps by key, never looks up by id),
      // tags as a genuine array, and client_updated_at as the client's own timestamp.
      rows: page.map((r) => ({
        sync_id: r.sync_id,
        project_key: r.project_key,
        project_seq: r.project_seq,
        client_updated_at: r.client_updated_at,
        lamport: r.lamport,
        scope: r.scope,
        type: r.type,
        topic_key: r.topic_key,
        title: r.title,
        content: r.content,
        tags: r.tags,
        deleted: r.deleted,
        superseded_by: r.superseded_by,
        origin_ai: r.origin_ai,
        origin_account: r.origin_account,
        git_branch: r.git_branch,
        author_display: r.author_display,
        content_hash: r.content_hash,
      })),
      cursors: nextCursors,
      next_poll_ms: NEXT_POLL_MS,
    },
  }
}

// §5.3. The device identity here is the TOKEN-derived one, never a client-supplied
// `device_id` query parameter. This used to echo `?device_id=` straight back, which made
// the stub model an identity a client can pick at will — precisely the spoofable shape the
// real service refuses (src/auth.ts resolves the device from the bearer token). A stub
// that is more permissive than the service under test weakens every result obtained
// against it, which already cost one round of evidence here.
// §5.3.1: the roster — every project this stub knows about, keys and display names only,
// never rows. It is populated the same way the real service's `projects` table is: by
// `allocateSeqRange` on every push, so anything pushed by ANY device sharing this token
// shows up here. This is what makes a fresh second device's `status()` call register the
// first device's projects locally and pull them on the next request — the whole point of
// §5.3.1. The real service scopes this by `user_id`; the stub has exactly one tenant (the
// token), so every project it knows is already "this caller's".
function handleStatus() {
  const deviceId = TOKEN_HASH
  const used = [...state.observations.values()].reduce(
    (n, r) => n + (r.content ? Buffer.byteLength(r.content) : 0),
    0
  )
  const projects = [...state.projects.entries()].map(([projectKey, p]) => ({
    project_key: projectKey,
    display_name: p.displayName ?? projectKey,
  }))
  return {
    status: 200,
    body: {
      device_id: deviceId,
      user_id: 'stub-user',
      plan: 'pro',
      // §11.4: the interval is the server's call, not the client's. It is the only real
      // cost lever, because ~99% of pulls come back empty.
      next_poll_ms: NEXT_POLL_MS,
      server_time: new Date().toISOString(),
      quota: { used_bytes: used, max_bytes: 1024 * 1024 * 1024 },
      projects,
    },
  }
}

// ── server ──────────────────────────────────────────────────────────────────

function authorized(req) {
  const header = req.headers.authorization ?? ''
  const presented = header.replace(/^Bearer\s+/i, '')
  if (!presented) return false
  return createHash('sha256').update(presented).digest('hex') === TOKEN_HASH
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 20 * 1024 * 1024) reject(new Error('body too large'))
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function send(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname

  // §5.4: the old Supabase-shaped routes are served as aliases so the stub can be pointed
  // at a Nest build from before the route change. Delete these when nothing needs them.
  const isPush = path === '/v1/sync/push' || path === '/functions/v1/memory-sync/push'
  const isPull = path === '/v1/sync/pull' || path === '/functions/v1/memory-sync/pull'
  const isStatus = path === '/v1/sync/status'
  const isHealth = path === '/health'

  if (isHealth) return send(res, 200, { ok: true, observations: state.observations.size })

  if (!isPush && !isPull && !isStatus) return send(res, 404, { error: 'not_found', path })

  if (!authorized(req)) {
    log(`401 ${path} — bad or missing token`)
    return send(res, 401, { error: 'unauthorized' })
  }

  try {
    if (isStatus) return send(res, 200, handleStatus().body)
    const body = await readBody(req)
    const out = isPush ? handlePush(body) : handlePull(body)
    if (isPush) {
      const applied = out.body.results?.filter((r) => r.outcome === 'applied').length ?? 0
      const superseded = out.body.results?.filter((r) => r.outcome === 'superseded').length ?? 0
      log(`push  ${body.mutations?.length ?? 0} mutations -> ${applied} applied, ${superseded} superseded`)
    } else {
      log(`pull  -> ${out.body.rows.length} rows`)
    }
    return send(res, out.status, out.body)
  } catch (err) {
    log(`500 ${path} — ${err.message}`)
    return send(res, 500, { error: 'stub_error', detail: err.message })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  log(`listening on http://127.0.0.1:${PORT}`)
  log(`token: ${TOKEN}`)
  log(`state: ${STATE_PATH ?? 'in-memory only (lost on exit)'}`)
  log(`routes: /v1/sync/{push,pull,status} + the Supabase-shaped aliases, /health`)
})

process.on('SIGINT', () => {
  persist()
  log('bye')
  process.exit(0)
})
