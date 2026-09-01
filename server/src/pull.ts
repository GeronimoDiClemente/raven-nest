import type { Pool } from 'pg'

export interface PullBody {
  cursors?: Record<string, number>
  limit?: number
}

export interface PulledRow {
  sync_id: string
  project_key: string
  project_seq: number
  client_updated_at: string
  lamport: number
  scope: string
  type: string
  topic_key: string | null
  title: string
  content: string | null
  tags: string[]
  deleted: boolean
  superseded_by: string | null
  origin_ai: string | null
  origin_account: string | null
  git_branch: string | null
  author_display: string | null
  content_hash: string | null
}

export interface PullResponse {
  rows: PulledRow[]
  cursors: Record<string, number>
  next_poll_ms: number
}

const MAX_LIMIT = 500

// §11.4: the interval is the server's call, not the client's. It is the only real cost
// lever, because ~99% of pulls come back empty.
export const NEXT_POLL_MS = Number(process.env.NEXT_POLL_MS ?? 300_000)

export async function handlePull(
  pool: Pool,
  auth: { userId: string },
  body: PullBody
): Promise<PullResponse> {
  const cursors = body.cursors ?? {}
  const keys = Object.keys(cursors)

  // `limit` is device-controlled input, not trusted. A non-finite, fractional, or
  // negative value falls back to the max rather than being passed through to a bigint SQL
  // parameter, where Postgres would throw ("invalid input syntax for type bigint") and turn
  // a malformed client request into a 500 instead of a well-defined response.
  //
  // `limit: 0` is treated as a genuine zero-row request, not "unspecified" — a client
  // polling only to read `next_poll_ms` should get back zero rows, not up to MAX_LIMIT.
  // Only an omitted or malformed limit (undefined, NaN, negative) falls back to the max.
  const rawLimit = Number(body.limit)
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : MAX_LIMIT

  // Empty cursors deliberately means "nothing to report" and returns nothing — NOT "give
  // me everything." Iterating every project the caller has is exactly the hot-loop
  // regression described below that this handler exists to prevent: a device must name a
  // project before this handler will ever return rows for it.
  if (keys.length === 0) return { rows: [], cursors: {}, next_poll_ms: NEXT_POLL_MS }

  // Only projects whose cursor this device actually sent. Returning rows for unsent
  // cursors is what made the old client hot-loop: the server iterated every account
  // project and defaulted an unsent cursor to 0, so a project the device did not know
  // restarted from 0 on every pull, forever.
  //
  // Each cursor value is likewise device-controlled: a non-finite or negative value falls
  // back to 0, which means "send me everything for this project" — the same starting
  // point as a device that has never synced it. That is always safe: it can only cause
  // rows already seen to be re-sent, never a row to be skipped.
  const cursorValues = keys.map((k) => {
    const n = Number(cursors[k])
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
  })

  const { rows } = await pool.query(
    `select o.sync_id, p.project_key, o.project_seq, o.client_updated_at, o.lamport, o.scope,
            o.type, o.topic_key, o.title, o.content, o.tags, o.deleted, o.superseded_by,
            o.origin_ai, o.origin_account, o.git_branch, o.author_display, o.content_hash
       from observations o
       join projects p on p.id = o.project_id
       join unnest($2::text[], $3::bigint[]) as c(project_key, cursor) on c.project_key = p.project_key
      where p.user_id = $1 and o.project_seq > c.cursor
      order by o.project_seq asc
      limit $4`,
    [auth.userId, keys, cursorValues, limit]
  )

  // Seed `next` from the clamped values, not the raw `cursors` input — otherwise a
  // malformed cursor (e.g. a non-numeric string) would round-trip back to the client
  // unchanged: `seq > "not-a-number"` coerces to `seq > NaN`, which is always false, so
  // the bad value would never get overwritten by a real project_seq.
  const next: Record<string, number> = {}
  keys.forEach((k, i) => { next[k] = cursorValues[i] })
  const mapped: PulledRow[] = rows.map((r) => {
    const seq = Number(r.project_seq)
    if (seq > (next[r.project_key] ?? 0)) next[r.project_key] = seq
    return {
      sync_id: r.sync_id,
      project_key: r.project_key,
      project_seq: seq,
      client_updated_at: new Date(r.client_updated_at).toISOString(),
      lamport: Number(r.lamport),
      scope: r.scope,
      type: r.type,
      topic_key: r.topic_key,
      title: r.title,
      content: r.content,
      tags: Array.isArray(r.tags) ? r.tags : [],
      deleted: r.deleted,
      superseded_by: r.superseded_by,
      origin_ai: r.origin_ai,
      origin_account: r.origin_account,
      git_branch: r.git_branch,
      author_display: r.author_display,
      content_hash: r.content_hash,
    }
  })

  return { rows: mapped, cursors: next, next_poll_ms: NEXT_POLL_MS }
}
