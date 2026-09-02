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

/**
 * A failure this handler has decided is TERMINAL, carrying the code the client will store
 * against the mutation. Thrown from inside a mutation's transaction so it takes the same
 * rollback path as a real database error and gets classified alongside one.
 */
export class TerminalPushError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code)
    this.name = 'TerminalPushError'
  }
}

// SQLSTATE classes (the first two characters) that a retry of the SAME payload can never
// get past, because the payload itself is what Postgres is refusing:
//   22 — data exception     (a bigint field that is not a number, a bad timestamp, a NUL
//                            byte in a text column…)
//   23 — integrity violation (not-null, foreign key, check, unique)
// Everything else — 08 connection, 40 rollback/deadlock/serialization, 53 out of
// resources, 57 operator intervention, and every non-SQLSTATE driver error — is transient
// by assumption and stays OMITTED so the client sends it again. Getting this backwards in
// either direction loses data: a terminal error omitted is retried forever and never
// reported, and a transient error rejected is dropped on the floor by a client that (per
// §5.1) treats `rejected` as final and never retries.
const TERMINAL_SQLSTATE_CLASSES: Record<string, string> = {
  '22': 'invalid_payload',
  '23': 'constraint_violation',
}

/**
 * Returns the error code to report with `outcome: 'rejected'`, or null when the failure is
 * transient and the mutation must be omitted from `results` instead (§5.1: omitting is how
 * the server says "I did not process this, send it again").
 */
export function classifyPushError(err: unknown): string | null {
  if (err instanceof TerminalPushError) return err.code
  const code = (err as { code?: unknown } | null | undefined)?.code
  // A real SQLSTATE is exactly five characters of [0-9A-Z]. Driver-level codes like
  // ECONNREFUSED or ETIMEDOUT also land in `.code` and must not be pattern-matched as if
  // their first two characters were a SQLSTATE class.
  if (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code)) return null
  return TERMINAL_SQLSTATE_CLASSES[code.slice(0, 2)] ?? null
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

// Plans whose memory can be shared with other people. `scope: 'team'` is the field that
// makes an observation visible beyond its author, so this is an authorization boundary, not
// a pricing detail: it decides who can read a memory, and it is enforced server-side for the
// same reason as the cloud gate itself (§9.3 — what is checked only in the renderer is not
// checked at all).
const TEAM_SCOPE_PLANS = new Set(['team', 'enterprise'])

export async function handlePush(
  pool: Pool,
  auth: { deviceId: string; userId: string; plan: string },
  body: PushBody
): Promise<PushResponse> {
  const mutations = Array.isArray(body.mutations) ? body.mutations : []
  const results: PushResult[] = []

  const client = await pool.connect()
  try {
    // `ensureProject` used to run once PER MUTATION, so a 200-mutation batch for one
    // project did 200 upserts against the same `projects` row — ~400 dead tuples per push
    // on a row that is also the seq counter every push has to lock. Resolve each distinct
    // project_key ONCE, up front. The last display_name in the batch still wins, exactly
    // as it did when each mutation overwrote the previous one's.
    //
    // Deliberately BEFORE the per-mutation transactions rather than hoisted inside one:
    // the transaction boundaries are unchanged (still one per mutation), and a project id
    // cached from a transaction that later rolled back would name a row that no longer
    // exists. Resolving them here, in autocommit, means the id stays valid no matter which
    // mutations fail. A project created for a batch whose mutations all fail is an empty
    // row holding a seq counter — harmless, and the retry reuses it.
    const displayNames = new Map<string, string>()
    for (const m of mutations) {
      const p = m.payload ?? {}
      const key = String(p.project_key ?? '__global__')
      displayNames.set(key, String(p.project_display_name ?? key))
    }
    const projectIds = new Map<string, number>()
    const projectErrors = new Map<string, unknown>()
    for (const [key, displayName] of displayNames) {
      try {
        projectIds.set(key, await ensureProject(client, auth.userId, key, displayName))
      } catch (err) {
        // Kept per-key instead of thrown: one unusable project_key must not take down the
        // whole batch. The error is re-thrown inside each affected mutation's transaction
        // below, so it goes through the same terminal/transient classification.
        projectErrors.set(key, err)
      }
    }

    for (const m of mutations) {
      const p = m.payload ?? {}
      const syncId = m.sync_id ?? String(p.sync_id ?? '')
      const projectKey = String(p.project_key ?? '__global__')
      const now = Date.now()

      // Without this, a mutation carrying neither `sync_id` nor `payload.sync_id` became
      // the empty string — a perfectly valid text primary key — so EVERY malformed push
      // from every account in the world collided on one row and overwrote each other.
      // Terminal on purpose: no retry of the same payload can grow a sync_id.
      if (!syncId) {
        results.push({
          sync_id: '',
          outcome: 'rejected',
          project_seq: 0,
          error: 'missing_sync_id',
        })
        continue
      }

      // The scope travels in the payload, so without this check the client is the only
      // thing deciding whether a memory is private or shared with the whole account.
      // Terminal on purpose: the same payload on the same plan can never succeed, and
      // omitting it instead would make the device retry a write it is not allowed to make,
      // forever.
      if (String(p.scope ?? 'personal') === 'team' && !TEAM_SCOPE_PLANS.has(auth.plan)) {
        results.push({
          sync_id: syncId,
          outcome: 'rejected',
          project_seq: 0,
          error: 'team_scope_not_allowed',
        })
        continue
      }

      await client.query('begin')
      let rolledBack = false
      try {
        // §5.1 idempotency, and the MUTEX for it. The receipt used to be read before the
        // transaction and written at the end, which left the whole apply unguarded: two
        // concurrent pushes of the same (device_id, seq) — precisely what the client
        // produces when its AbortSignal timeout fires and it retries while the first
        // request is still in flight — both read "no receipt", both applied, and the
        // receipt ended up naming a project_seq that no row had, leaving a permanent hole
        // in the seq space.
        //
        // Claiming the receipt FIRST closes that: the second transaction blocks on the
        // uncommitted primary key, and when the first commits, `do nothing` returns no
        // row. `outcome` is a placeholder until the outcome is actually known — it is
        // updated below, in this same transaction, so the placeholder can never be
        // observed by anyone.
        const claim = await client.query(
          `insert into push_receipts (device_id, seq, sync_id, outcome, project_seq)
           values ($1, $2, $3, 'pending', null)
           on conflict do nothing returning device_id`,
          [auth.deviceId, m.seq, syncId]
        )
        if (claim.rowCount === 0) {
          // Somebody else owns this (device_id, seq). Since the insert above waits out any
          // in-flight conflicting transaction, "no row" means that one COMMITTED — so the
          // stored receipt is there to be read and returned, exactly as a replay would.
          rolledBack = true
          await client.query('rollback')
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
          }
          // No stored receipt after all (the other transaction rolled back between the
          // conflict and this read): omit it and let the client send it again.
          continue
        }

        const projectId = projectIds.get(projectKey)
        if (projectId === undefined) throw projectErrors.get(projectKey) ?? new Error('no project')
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
          // DEFENSE IN DEPTH, and redundant TODAY — kept deliberately, so read this before
          // deleting it as dead weight or copying it as a pattern:
          //
          // (a) The TOCTOU window this closes is already shut. `allocateSeqRange` ran a few
          //     lines up and its `update projects ... where id = $1` takes a row lock on
          //     this project that Postgres holds until commit. Two concurrent pushes to the
          //     same project therefore cannot both sit between the owner read below and the
          //     insert further down: the second one is already waiting on that row.
          // (b) This lock is what keeps the §8.1 guarantee true if seq allocation ever
          //     STOPS locking the projects row. Note which direction the risk runs: the
          //     batching optimization the plan contemplates (one range per project per
          //     push instead of one per mutation) makes that row lock STRONGER, not weaker.
          //     The real hazard is replacing the counter with a Postgres sequence, with a
          //     separate table, or with an in-process cached range — any of those drops the
          //     row lock, and without this line the topic guarantee would evaporate in
          //     silence, with nothing failing and nobody noticing.
          // (c) `pg_advisory_xact_lock` shares ONE 64-bit key space with every other
          //     advisory lock in this process, including `MIGRATION_LOCK_KEY` in db.ts.
          //     The key here is a hash of a tuple string, so a collision with that constant
          //     is not credible, but any new advisory lock added anywhere in this service
          //     lands in the same namespace and has to be chosen with that in mind.
          //
          // Keyed on the exact tuple obs_topic_uniq enforces uniqueness over, and
          // transaction-scoped: a session-scoped lock would leak across pooled requests.
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

        const upsert = await client.query(
          `insert into observations (
             sync_id, project_id, project_seq, scope, type, topic_key, title, content, tags,
             content_hash, origin_ai, origin_account, git_branch, author_id, author_display,
             lamport, client_updated_at, client_created_at, deleted, superseded_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           on conflict (sync_id) do update set
             project_id = excluded.project_id, project_seq = excluded.project_seq,
             scope = excluded.scope, type = excluded.type, topic_key = excluded.topic_key,
             title = excluded.title, content = excluded.content, tags = excluded.tags,
             content_hash = excluded.content_hash, lamport = excluded.lamport,
             client_updated_at = excluded.client_updated_at, deleted = excluded.deleted,
             superseded_by = excluded.superseded_by
           where observations.author_id = excluded.author_id`,
          [
            syncId,
            projectId,
            seq,
            scope,
            String(p.type ?? 'discovery'),
            topicKey,
            String(p.title ?? ''),
            // §8.2: the old server never read `op` at all, so a delete on one machine
            // never reached the other. `incomingDeleted` already reads `op` for the
            // topic-collision guard above; reuse it here so a tombstone that only sets
            // `op: 'delete'` (without redundantly setting `payload.deleted`) still nulls
            // its content and marks the row deleted below.
            incomingDeleted ? null : ((p.content as string | null) ?? null),
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
            incomingDeleted,
            supersededBy,
          ]
        )

        // Three things depend on that SET list being complete and on this guard:
        //
        // - `where observations.author_id = excluded.author_id` makes the update
        //   SAME-TENANT. `sync_id` is a GLOBAL primary key and the client derives it
        //   deterministically from (projectKey, scope, type, contentHash, topicKey) with no
        //   per-user salt (`deriveImportSyncId` in electron/memory-store.ts), so two
        //   accounts genuinely collide on it. Without the guard, user B's push overwrote
        //   user A's row and answered `applied` — a cross-tenant write that also silently
        //   discarded B's own memory. A conflict the guard blocks updates no rows, which is
        //   what `rowCount === 0` detects, and it is terminal: retrying can never succeed.
        // - `superseded_by = excluded.superseded_by` — without it a re-pushed row kept a
        //   STALE marker. Reproduced: A loses to B, A is re-pushed as the LWW winner, so B
        //   gets superseded_by = A while A still says superseded_by = B. A cycle, zero live
        //   owners for the topic, and the memory vanishes from the active view everywhere.
        // - `project_id = excluded.project_id` — `project_seq` was already in the SET list
        //   without it, so a row whose project_key changed (a repo re-cloned to a different
        //   path) kept its OLD project while taking a seq from the NEW project's counter,
        //   violating unique (project_id, project_seq). The mutation was then omitted and
        //   retried forever, invisibly.
        if (upsert.rowCount === 0) {
          throw new TerminalPushError(
            'sync_id_conflict',
            `sync_id ${syncId} already belongs to another account`
          )
        }

        const result: PushResult = {
          sync_id: syncId,
          outcome: supersededBy ? 'superseded' : 'applied',
          project_seq: seq,
        }
        await client.query(
          `update push_receipts set sync_id = $3, outcome = $4, project_seq = $5
            where device_id = $1 and seq = $2`,
          [auth.deviceId, m.seq, syncId, result.outcome, seq]
        )
        await client.query('commit')
        results.push(result)
      } catch (err) {
        if (!rolledBack) await client.query('rollback')
        const rejection = classifyPushError(err)
        if (rejection) {
          // Terminal: no retry of this payload can ever succeed, so saying `rejected` (with
          // the reason) is the honest answer. Omitting it instead is the mirror image of
          // the bug this service exists to fix — the client would resend it forever and
          // nothing anywhere would report a problem.
          console.error('[push] mutation rejected as terminal', syncId, rejection, err)
          results.push({ sync_id: syncId, outcome: 'rejected', project_seq: 0, error: rejection })
        } else {
          // Transient: omitted from `results` on purpose. Per §5.1 that is how the server
          // says "I did not process this, send it again" — and the receipt claim rolled
          // back with the rest, so the retry can take it cleanly.
          console.error('[push] mutation failed, leaving it for retry', syncId, err)
        }
      }
    }
    return { results }
  } finally {
    client.release()
  }
}
