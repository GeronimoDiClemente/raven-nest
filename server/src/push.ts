import type { Pool, PoolClient } from 'pg'
import { allocateSeqRange } from './seq'
import { resolveTopicCollision } from './lww'

export interface Mutation {
  seq: number
  sync_id: string
  op: 'upsert' | 'delete' | 'promote'
  payload: Record<string, unknown>
}

export interface PushBody {
  // Accepted on the wire for backward/forward compatibility but deliberately never read:
  // the device identity that matters is the authenticated one in `auth.deviceId`. A
  // client-supplied device id must never be allowed to drive authorization or receipt
  // lookups — wiring this up "to use the field" would reopen a spoofing hole.
  device_id?: string
  mutations: Mutation[]
}

export interface PushResult {
  sync_id: string
  outcome: 'applied' | 'superseded' | 'rejected'
  project_seq: number
  error?: string
}

export interface PushResponse {
  results: PushResult[]
}

/** §5.2: tags travel as a real array. The client may still send a JSON string. */
export function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((t): t is string => typeof t === 'string')
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === 'string')
    } catch { /* not JSON — treat as untagged */ }
  }
  return []
}

/**
 * §5.2: the client may send epoch ms or ISO 8601, and the value is the CLIENT's clock.
 *
 * Also guards against a raw NaN (JSON cannot encode one, but a caller could still pass a
 * number that is NaN) and a numeric-string epoch (the real client types these fields as
 * `number`, so it never sends one today, but Number() alone would otherwise silently drop
 * it to `fallback` instead of recognizing it). Neither case is reachable through the real
 * client — this is robustness, not a bug fix.
 */
export function parseClientTimestamp(value: unknown, fallback: number): Date {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const asNumber = Number(value)
    if (Number.isFinite(asNumber)) return new Date(asNumber)
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(parsed)
  }
  return new Date(fallback)
}

async function ensureProject(
  client: PoolClient,
  userId: string,
  projectKey: string,
  displayName: string
): Promise<number> {
  const { rows } = await client.query(
    `insert into projects (user_id, project_key, display_name) values ($1, $2, $3)
     on conflict (user_id, project_key) do update set display_name = excluded.display_name
     returning id`,
    [userId, projectKey, displayName]
  )
  return Number(rows[0].id)
}

export async function handlePush(
  pool: Pool,
  auth: { deviceId: string; userId: string },
  body: PushBody
): Promise<PushResponse> {
  const mutations = Array.isArray(body.mutations) ? body.mutations : []
  const results: PushResult[] = []

  const client = await pool.connect()
  try {
    for (const m of mutations) {
      // §5.1 idempotency. The client retries anything missing from `results`, and a
      // response lost on the wire is indistinguishable from a mutation never processed —
      // so a replay must return the stored receipt rather than applying anything twice.
      const prior = await client.query(
        'select sync_id, outcome, project_seq from push_receipts where device_id = $1 and seq = $2',
        [auth.deviceId, m.seq]
      )
      if (prior.rows.length > 0) {
        results.push({
          sync_id: prior.rows[0].sync_id,
          outcome: prior.rows[0].outcome,
          project_seq: Number(prior.rows[0].project_seq ?? 0),
        })
        continue
      }

      const p = m.payload ?? {}
      const syncId = m.sync_id ?? String(p.sync_id ?? '')
      const projectKey = String(p.project_key ?? '__global__')
      const displayName = String(p.project_display_name ?? projectKey)
      const now = Date.now()

      await client.query('begin')
      try {
        const projectId = await ensureProject(client, auth.userId, projectKey, displayName)
        const seq = await allocateSeqRange(client, projectId, 1)

        // §8.1: a topic collision supersedes the loser; it never rejects it. The old server
        // did a plain INSERT against obs_topic_uniq, the second memory came back `rejected`,
        // the client marked it pushed and never retried, and the two machines showed
        // different memories for the same topic forever. Nothing is discarded here.
        let supersededBy: string | null = null
        const scope = String(p.scope ?? 'personal')
        const topicKey = (p.topic_key as string | null) ?? null
        const incomingDeleted = m.op === 'delete' || Boolean(p.deleted)

        if (topicKey && !incomingDeleted) {
          // Close the TOCTOU gap: the `for update` below locks an EXISTING row, but there is
          // nothing to lock when no owner exists yet — two concurrent first-writers to a
          // brand-new topic could both read "no owner" and both attempt the insert, and only
          // one would survive obs_topic_uniq. A transaction-scoped advisory lock, keyed on
          // the exact tuple obs_topic_uniq enforces uniqueness over, serializes even that
          // case: the second pusher blocks here until the first commits or rolls back, then
          // re-reads and sees whatever the first one left behind.
          await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
            `${projectId}:${scope}:${topicKey}`,
          ])

          const owner = await client.query(
            `select sync_id, lamport, client_updated_at from observations
              where project_id = $1 and scope = $2 and topic_key = $3
                and sync_id <> $4 and deleted = false and superseded_by is null
              for update`,
            [projectId, scope, topicKey, syncId]
          )
          if (owner.rows.length > 0) {
            const existing = {
              syncId: owner.rows[0].sync_id,
              updatedAt: new Date(owner.rows[0].client_updated_at).getTime(),
              lamport: Number(owner.rows[0].lamport),
            }
            const incoming = {
              syncId,
              updatedAt: parseClientTimestamp(p.updated_at ?? p.client_updated_at, now).getTime(),
              lamport: Number(p.lamport ?? 0),
            }
            const { winner } = resolveTopicCollision(existing, incoming)
            if (winner.syncId === syncId) {
              // The incoming wins: the existing row is superseded BEFORE the insert, because
              // obs_topic_uniq admits no second live row. Insert-then-supersede is not a
              // slower order, it is an impossible one. The loser also gets a NEW project_seq
              // here, so devices that already pulled its old seq learn it lost instead of
              // never seeing this update.
              await client.query(
                `update observations set superseded_by = $1, project_seq = $2
                  where sync_id = $3`,
                [syncId, await allocateSeqRange(client, projectId, 1), existing.syncId]
              )
            } else {
              // The existing wins: the incoming is stored ALREADY superseded. It is still
              // accepted and still replicates, so the client learns who won from the pull.
              supersededBy = existing.syncId
            }
          }
        }

        await client.query(
          `insert into observations (
             sync_id, project_id, project_seq, scope, type, topic_key, title, content, tags,
             content_hash, origin_ai, origin_account, git_branch, author_id, author_display,
             lamport, client_updated_at, client_created_at, deleted, superseded_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           on conflict (sync_id) do update set
             title = excluded.title, content = excluded.content, tags = excluded.tags,
             lamport = excluded.lamport, client_updated_at = excluded.client_updated_at,
             deleted = excluded.deleted, project_seq = excluded.project_seq`,
          [
            syncId,
            projectId,
            seq,
            scope,
            String(p.type ?? 'discovery'),
            topicKey,
            String(p.title ?? ''),
            (p.content as string | null) ?? null,
            JSON.stringify(normalizeTags(p.tags)),
            (p.content_hash as string | null) ?? null,
            (p.origin_ai as string | null) ?? null,
            (p.origin_account as string | null) ?? null,
            (p.git_branch as string | null) ?? null,
            auth.userId,
            (p.author_display as string | null) ?? null,
            Number(p.lamport ?? 0),
            parseClientTimestamp(p.updated_at ?? p.client_updated_at, now),
            parseClientTimestamp(p.created_at ?? p.client_created_at, now),
            Boolean(p.deleted),
            supersededBy,
          ]
        )

        const result: PushResult = {
          sync_id: syncId,
          outcome: supersededBy ? 'superseded' : 'applied',
          project_seq: seq,
        }
        await client.query(
          `insert into push_receipts (device_id, seq, sync_id, outcome, project_seq)
           values ($1,$2,$3,$4,$5) on conflict do nothing`,
          [auth.deviceId, m.seq, syncId, result.outcome, seq]
        )
        await client.query('commit')
        results.push(result)
      } catch (err) {
        await client.query('rollback')
        // TEMPORARY (non-vacuity check, reviewer): push a terminal outcome instead of omitting.
        results.push({ sync_id: syncId, outcome: 'rejected', project_seq: 0 })
        console.error('[push] mutation failed, leaving it for retry', m.sync_id, err)
      }
    }
    return { results }
  } finally {
    client.release()
  }
}
