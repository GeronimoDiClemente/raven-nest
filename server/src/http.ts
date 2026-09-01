import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Pool } from 'pg'
import { authenticate } from './auth'
import { handlePush } from './push'
import { handlePull } from './pull'
import { handleStatus } from './status'

const MAX_BATCH = 500
const MAX_BODY_BYTES = 20 * 1024 * 1024

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > MAX_BODY_BYTES) reject(Object.assign(new Error('too large'), { status: 413 }))
    })
    req.on('end', () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Everything from `authenticate` down runs inside this try/catch, not just the JSON
 * parsing and the handler calls. `authenticate` itself does a DB query and can reject
 * (e.g. the pool is briefly unreachable) — if that rejection happened outside a catch, it
 * would surface as an unhandled rejection on the async request listener, which crashes the
 * whole process on one bad request. Routing a request that never reaches `authenticate`
 * needs no such guard (nothing async has happened yet), so only the auth-and-onward path is
 * wrapped.
 */
async function handleRequest(pool: Pool, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const path = url.pathname

  if (path === '/health') return send(res, 200, { ok: true })

  // §5.4: the old Supabase-shaped routes are served as aliases so this service can be
  // pointed at a Nest build that predates the client's route change. This is a bring-up
  // affordance, not a permanent surface — delete the aliases once nothing depends on them.
  const isPush = path === '/v1/sync/push' || path === '/functions/v1/memory-sync/push'
  const isPull = path === '/v1/sync/pull' || path === '/functions/v1/memory-sync/pull'
  const isStatus = path === '/v1/sync/status'

  if (!isPush && !isPull && !isStatus) return send(res, 404, { error: 'not_found' })

  try {
    const auth = await authenticate(pool, req.headers.authorization)
    if (!auth.ok) return send(res, auth.status, { error: auth.error })

    if (isStatus) return send(res, 200, await handleStatus(pool, auth))

    const body = (await readBody(req)) as Record<string, unknown>
    if (isPush) {
      const mutations = Array.isArray(body.mutations) ? body.mutations : []
      // Decided on the mutation count alone, before handlePush ever opens a connection or
      // starts a transaction — a batch this large is rejected outright, not partially run.
      if (mutations.length > MAX_BATCH) return send(res, 413, { error: 'batch_too_large' })
      return send(res, 200, await handlePush(pool, auth, { mutations } as never))
    }
    return send(res, 200, await handlePull(pool, auth, body as never))
  } catch (err) {
    // A `status` on the error means it is the client's fault (bad JSON, an oversized body)
    // and safe to echo back. Anything else is ours — log it server-side and hand the client
    // a generic code instead of leaking internals (a stack trace, a driver error message).
    const status = (err as { status?: number }).status ?? 500
    if (status === 500) console.error('[http]', path, err)
    return send(res, status, { error: status === 500 ? 'internal_error' : (err as Error).message })
  }
}

export function createApp(pool: Pool) {
  return createServer((req, res) => {
    handleRequest(pool, req, res).catch((err) => {
      // Last-resort net: handleRequest already catches everything reachable through the
      // routes above. This exists only so a bug in that catch itself still can't produce
      // an unhandled rejection that takes the process down.
      console.error('[http] unhandled', err)
      if (!res.headersSent) send(res, 500, { error: 'internal_error' })
    })
  })
}
