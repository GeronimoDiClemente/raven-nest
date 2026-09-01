import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Pool } from 'pg'
import { authenticate } from './auth'
import { handlePush } from './push'
import { handlePull } from './pull'
import { handleStatus } from './status'
import { handleDeleteData } from './delete-data'

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

/**
 * Reads the request body as ONE utf8 decode over the concatenated bytes.
 *
 * The previous version did `data += chunk` with `data` a string, which decodes every
 * chunk INDEPENDENTLY. Node hands `data` events out in ~64 KB Buffers, so any multibyte
 * character that straddles a chunk boundary is split across two decodes and each half
 * becomes U+FFFD. Reproduced end to end: a 680 KB body of Spanish markdown came back with
 * 9 replacement characters, and the push still answered `applied` — so the client marked
 * it pushed and the corruption was permanent. 680 KB is the TYPICAL batch (200 mutations
 * at the spec's measured 3407 B average), so this was the default case, not an edge one.
 *
 * The size cap sums `chunk.length`, which is BYTES. `data.length` on the old string was
 * UTF-16 code units, which undercounts every non-ASCII body.
 */
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let done = false

    const fail = (message: string, status: number) => {
      done = true
      chunks.length = 0
      reject(Object.assign(new Error(message), { status }))
    }

    req.on('data', (chunk: Buffer) => {
      if (done) return
      bytes += chunk.length
      if (bytes > MAX_BODY_BYTES) return fail('too large', 413)
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (done) return
      if (chunks.length === 0) return resolve({})
      let parsed: unknown
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return fail('bad json', 400)
      }
      // Valid JSON that is not an object (`null`, `42`, `"x"`, `[]`) used to sail through
      // and blow up downstream — `body.mutations` on a null body throws a TypeError inside
      // the caller's try and got reported as a 500. It is bad client input, so it is a 400
      // here, and the 500 channel stays clean for actual server faults.
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fail('bad json', 400)
      }
      resolve(parsed)
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
  // §5.5, option 2: the right-to-delete endpoint the spec left undefined. `/v1/sync/
  // delete-data` is the real name; the Supabase-shaped path is served as an alias exactly
  // like §5.4 does for push and pull, because `electron/main.ts` still posts to it and a
  // 404 there breaks the right to delete SILENTLY (the client only reads `res.ok`).
  const isDelete =
    path === '/v1/sync/delete-data' || path === '/functions/v1/memory-sync/delete-cloud-data'

  if (!isPush && !isPull && !isStatus && !isDelete) return send(res, 404, { error: 'not_found' })

  try {
    const auth = await authenticate(pool, req.headers.authorization)
    if (!auth.ok) return send(res, auth.status, { error: auth.error })

    if (isStatus) return send(res, 200, await handleStatus(pool, auth))
    // Takes no input — everything it deletes is scoped by the authenticated identity — so
    // the body is deliberately not read. The client posts `{}`.
    if (isDelete) return send(res, 200, await handleDeleteData(pool, auth))

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
