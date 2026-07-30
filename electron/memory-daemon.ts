// Sync scheduler — lives in Electron main, owns the only network connection to
// Supabase for memory replication. See docs/nest-memory-architecture.md §1.3, §4.
//
// Deliberately takes its dependencies as plain functions/objects (no direct `electron`
// import) so the scheduling/backoff/apply logic is unit-testable with a mocked fetch and
// vitest fake timers, without spinning up a BrowserWindow or a real network call.

import { MemoryStore, type MutationLogRow } from './memory-store'
import { resolveLWW, resolveTopicCollision, type LWWRow } from './memory-merge'

const DEBOUNCE_MS = 3_000
const MAX_WAIT_MS = 30_000
const INTERVAL_MS = 5 * 60_000
const FOCUS_PULL_RATE_LIMIT_MS = 30_000
const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 5 * 60_000
const QUIT_PUSH_BUDGET_MS = 2_000
const PUSH_BATCH_SIZE = 200
// M20: §4.5 "hard cap 50 000, after which the daemon compacts the queue".
const QUEUE_HARD_CAP = 50_000

export type DaemonStatus = 'idle' | 'syncing' | 'paused' | 'error'

export interface PushResultItem {
  sync_id: string
  outcome: 'applied' | 'superseded' | 'rejected'
  project_seq: number
  error?: string
}

export interface PulledRow extends LWWRow {
  deleted: boolean
  topicKey: string | null
  scope: string
  /** Local project_key (client-derived hash) — see mapRawPulledRow / C1. */
  projectKey: string
  supersededBy: string | null
  title?: string
  content?: string | null
  type?: string
  tags?: string[]
  originAi?: string
  originAccount?: string
  gitBranch?: string
  authorUserId?: string
  authorDisplay?: string
  contentHash?: string
  projectSeq?: number
}

export interface MemoryDaemonDeps {
  store: MemoryStore
  getSupabaseUrl: () => string | null
  getToken: () => string | null
  getDeviceId: () => string | null
  isOnline: () => boolean
  fetchImpl?: typeof fetch
  onStatusChange?: (status: DaemonStatus, detail?: string) => void
}

/** Exponential backoff with jitter — pure, no timers, easy to unit test in isolation. */
export class Backoff {
  private attempt = 0

  next(): number {
    const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.attempt)
    this.attempt = Math.min(this.attempt + 1, 10) // cap growth, avoid unbounded exponent
    const jitter = Math.floor(exp * 0.2 * Math.random())
    return exp + jitter
  }

  reset(): void {
    this.attempt = 0
  }

  get attemptCount(): number {
    return this.attempt
  }
}

function parseServerTimestamp(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  // Should not happen with well-formed server data — never throw from a mapping
  // function over network input; falling back to "now" keeps this row applyable
  // (worst case it loses an LWW tie it should have won) instead of crashing the pull.
  return Date.now()
}

/**
 * C1 fix: the RPCs return `to_jsonb(o)` — real Postgres column names (snake_case) and
 * real Postgres types (timestamptz -> an ISO 8601 string, not a ms-epoch number). The
 * previous code read `incoming.syncId`/`.updatedAt`/`.topicKey`/`.projectId` directly off
 * that raw object; every field was `undefined`, `store.get(undefined)` threw, the outer
 * try/catch swallowed it, the cursor never advanced, and NO row was EVER applied — pull
 * was completely broken. This is the mapping layer that was missing, plus timestamp
 * parsing. `project_key` is not a native column on memory_observations (the table only
 * has the cloud `project_id` UUID) — the memory-sync edge function denormalizes the
 * caller's local `project_key` onto every row before returning them (see
 * supabase/functions/memory-sync/index.ts's pull handler), specifically so this mapping
 * never needs a separate id->key lookup.
 */
export function mapRawPulledRow(raw: Record<string, unknown>): PulledRow {
  return {
    syncId: String(raw.sync_id ?? ''),
    updatedAt: parseServerTimestamp(raw.client_updated_at),
    lamport: Number(raw.lamport ?? 0),
    deleted: Boolean(raw.deleted),
    topicKey: (raw.topic_key as string | null | undefined) ?? null,
    scope: String(raw.scope ?? 'personal'),
    projectKey: String(raw.project_key ?? ''),
    supersededBy: (raw.superseded_by as string | null | undefined) ?? null,
    title: raw.title != null ? String(raw.title) : undefined,
    content: raw.content == null ? null : String(raw.content),
    type: raw.type != null ? String(raw.type) : undefined,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : undefined,
    originAi: (raw.origin_ai as string | undefined) ?? undefined,
    originAccount: (raw.origin_account as string | undefined) ?? undefined,
    gitBranch: (raw.git_branch as string | undefined) ?? undefined,
    authorDisplay: (raw.author_display as string | undefined) ?? undefined,
    contentHash: (raw.content_hash as string | undefined) ?? undefined,
    projectSeq: raw.project_seq != null ? Number(raw.project_seq) : undefined,
  }
}

export class MemoryDaemon {
  private readonly deps: MemoryDaemonDeps
  private debounceTimer: NodeJS.Timeout | null = null
  private maxWaitTimer: NodeJS.Timeout | null = null
  private intervalTimer: NodeJS.Timeout | null = null
  private backoffTimer: NodeJS.Timeout | null = null
  private lastFocusPullAt = 0
  private consecutiveAuthFailures = 0
  private backoff = new Backoff()
  private status: DaemonStatus = 'idle'
  private running = false
  // M18: 3 consecutive auth failures used to only stop the BACKOFF chain from
  // re-scheduling itself — every OTHER trigger (a fresh on-write debounce, pane-exit,
  // window focus, the 5-minute interval) still called push()/pull() directly and hit
  // the revoked-token endpoint again. This flag is checked at the top of both push()
  // and pull(), so every entry point is gated the same way. Cleared by
  // onNetworkRegain() — the reconnect flow's actual "the user acted" signal.
  private authBlocked = false
  // M19: concurrent triggers (e.g. a debounced push firing at the same moment as the
  // 5-minute interval's drain) used to fire independent overlapping requests — double
  // POSTs of the same batch, or a later pull's cursor write racing an earlier one's.
  // These in-flight promises are returned to a second caller instead of starting a
  // second request.
  private pushInFlight: Promise<void> | null = null
  private pullInFlight: Promise<void> | null = null

  constructor(deps: MemoryDaemonDeps) {
    this.deps = deps
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.intervalTimer = setInterval(() => void this.drain(), INTERVAL_MS)
  }

  stop(): void {
    this.running = false
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer)
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    if (this.backoffTimer) clearTimeout(this.backoffTimer)
    this.debounceTimer = this.maxWaitTimer = this.intervalTimer = this.backoffTimer = null
  }

  private setStatus(status: DaemonStatus, detail?: string): void {
    this.status = status
    this.deps.onStatusChange?.(status, detail)
  }

  getStatus(): DaemonStatus {
    return this.status
  }

  /** §4.1 "On write" trigger — debounce 3s, max-wait 30s so a chatty session still pushes. */
  scheduleMutationPush(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      if (this.maxWaitTimer) { clearTimeout(this.maxWaitTimer); this.maxWaitTimer = null }
      void this.push()
    }, DEBOUNCE_MS)

    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => {
        this.maxWaitTimer = null
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null }
        void this.push()
      }, MAX_WAIT_MS)
    }
  }

  /** §4.1 "Window focus" trigger — rate-limited to once per 30s. */
  onWindowFocus(): void {
    const now = Date.now()
    if (now - this.lastFocusPullAt < FOCUS_PULL_RATE_LIMIT_MS) return
    this.lastFocusPullAt = now
    void this.pull()
  }

  /** §4.1 "Network regain" trigger — full drain. Also the "user acted" reset for M18. */
  onNetworkRegain(): void {
    this.backoff.reset()
    this.consecutiveAuthFailures = 0
    this.authBlocked = false
    void this.drain()
  }

  /** §4.1 "Pane exit" trigger. */
  onPaneExit(): void {
    void this.push()
  }

  /** §4.1 "App quit" trigger — best-effort push within a 2s budget, never blocks exit. */
  async onQuit(): Promise<void> {
    await Promise.race([
      this.push(),
      new Promise((resolve) => setTimeout(resolve, QUIT_PUSH_BUDGET_MS)),
    ]).catch(() => { /* quitting regardless */ })
  }

  private async drain(): Promise<void> {
    // M20: offline-queue maintenance — previously pruneAckedMutations() had zero call
    // sites (dead code) and there was no cap enforcement at all, so the queue could grow
    // unbounded. Runs once per drain cycle (interval tick or an explicit
    // onNetworkRegain()) — cheap, and every trigger eventually funnels through here or
    // through push()/pull() directly, so this cadence is frequent enough per §4.5.
    this.deps.store.pruneAckedMutations()
    if (this.deps.store.pendingMutationCount() > QUEUE_HARD_CAP) {
      this.deps.store.compactMutationLog()
    }
    await this.pull()
    await this.push()
  }

  private fetch(input: string, init: RequestInit): Promise<Response> {
    const impl = this.deps.fetchImpl ?? fetch
    return impl(input, init)
  }

  push(): Promise<void> {
    // M19: dedupe concurrent callers onto the same in-flight request.
    if (this.pushInFlight) return this.pushInFlight
    const run = this.doPush().finally(() => { this.pushInFlight = null })
    this.pushInFlight = run
    return run
  }

  private async doPush(): Promise<void> {
    const { store, getSupabaseUrl, getToken, isOnline } = this.deps
    if (this.authBlocked) return // M18: gate every entry point, not just the backoff chain
    if (!isOnline()) {
      this.setStatus('paused', 'offline')
      return
    }
    const url = getSupabaseUrl()
    const token = getToken()
    if (!url || !token) return

    const pending = store.pendingMutations(PUSH_BATCH_SIZE)
    if (pending.length === 0) {
      this.setStatus('idle')
      return
    }

    this.setStatus('syncing')
    try {
      const deviceId = this.deps.getDeviceId()
      const response = await this.fetch(`${url}/functions/v1/memory-sync/push`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          mutations: pending.map((m: MutationLogRow) => ({ seq: m.seq, sync_id: m.sync_id, op: m.op, payload: JSON.parse(m.payload) })),
        }),
      })

      if (response.status === 401 || response.status === 403) {
        this.consecutiveAuthFailures += 1
        if (this.consecutiveAuthFailures >= 3) {
          this.authBlocked = true
          this.setStatus('error', 'auth')
          return // stop retrying until the user acts, per §4.1
        }
        this.scheduleBackoffRetry(() => void this.push())
        return
      }
      if (!response.ok) throw new Error(`push failed: ${response.status}`)

      this.consecutiveAuthFailures = 0
      this.backoff.reset()
      const body = (await response.json()) as { results?: PushResultItem[] }
      const results = body.results ?? []

      // M21 fix: this used to unconditionally `store.markPushed(pending.map(seq))` and
      // discard `body.results` entirely (`void body`) — no distinction between what the
      // server actually applied/superseded/rejected vs. what it may never have touched
      // at all, and rejected mutations left no error trail. Per §4.2: accepted AND
      // rejected mutations are both marked pushed (so a permanently-rejected item, e.g.
      // a plan limit, doesn't loop forever) — rejected ones just also record why. A
      // mutation with NO matching result (the whole call errored before reaching it, or
      // the server response is malformed) is left in the queue for the next attempt.
      const resultBySyncId = new Map(results.map((r) => [r.sync_id, r]))
      const toMark: Array<number | { seq: number; error?: string | null }> = []
      for (const m of pending) {
        let payloadSyncId: string | undefined
        try { payloadSyncId = JSON.parse(m.payload).sync_id } catch { /* leave undefined */ }
        const result = payloadSyncId ? resultBySyncId.get(payloadSyncId) : undefined
        if (!result) continue // not acknowledged by the server — retry next cycle
        toMark.push(result.outcome === 'rejected' ? { seq: m.seq, error: result.error ?? 'rejected' } : m.seq)
      }
      store.markPushed(toMark)

      store.setSyncState('__account__', { lastSuccessAt: Date.now(), lastError: null })
      this.setStatus('idle')
    } catch (err) {
      store.setSyncState('__account__', { lastError: err instanceof Error ? err.message : String(err) })
      this.setStatus('error', err instanceof Error ? err.message : String(err))
      this.scheduleBackoffRetry(() => void this.push())
    }
  }

  pull(): Promise<void> {
    // M19: dedupe concurrent callers onto the same in-flight request.
    if (this.pullInFlight) return this.pullInFlight
    const run = this.doPull().finally(() => { this.pullInFlight = null })
    this.pullInFlight = run
    return run
  }

  private async doPull(): Promise<void> {
    const { store, getSupabaseUrl, getToken, isOnline } = this.deps
    if (this.authBlocked) return // M18
    if (!isOnline()) {
      this.setStatus('paused', 'offline')
      return
    }
    const url = getSupabaseUrl()
    const token = getToken()
    if (!url || !token) return

    // M17 fix: this used to send a single `{__account__: cursor}` cursor and keep only
    // `Object.values(body.cursors)[0]` from the response — with more than one local
    // project, every project past the first permanently never advanced its cursor (or
    // advanced the WRONG project's cursor onto the account-wide one), silently missing
    // all of its pulled rows forever. Each known local project now gets its own cursor,
    // read from and written back to its own sync_state partition (keyed by project_key,
    // matching how push() already scopes mutations per project).
    const projects = store.listProjects()
    if (projects.length === 0) return // nothing pushed yet — nothing to pull

    const cursors: Record<string, number> = {}
    for (const project of projects) {
      cursors[project.projectKey] = store.getSyncState(project.projectKey).pullCursor
    }

    try {
      const response = await this.fetch(`${url}/functions/v1/memory-sync/pull`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cursors, limit: 500 }),
      })
      if (!response.ok) throw new Error(`pull failed: ${response.status}`)
      const body = (await response.json()) as { rows: Array<Record<string, unknown>>; cursors: Record<string, number> }
      for (const raw of body.rows) this.applyPulledRow(mapRawPulledRow(raw))

      const now = Date.now()
      for (const [projectKey, cursor] of Object.entries(body.cursors ?? {})) {
        if (typeof cursor === 'number') {
          store.setSyncState(projectKey, { pullCursor: cursor, lastSuccessAt: now, lastError: null })
        }
      }
      store.setSyncState('__account__', { lastSuccessAt: now, lastError: null })
      this.consecutiveAuthFailures = 0
      this.backoff.reset()
    } catch (err) {
      store.setSyncState('__account__', { lastError: err instanceof Error ? err.message : String(err) })
      this.setStatus('error', err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * Applies one pulled row locally using the same LWW rules a Postgres-side apply would
   * use (§4.3) — exposed as its own method so tests can drive it directly with
   * synthetic rows instead of a live server.
   */
  applyPulledRow(incoming: PulledRow): void {
    const local = this.deps.store.get(incoming.syncId)
    if (local) {
      // Same sync_id on both sides, so comparing `.syncId` can never tell winner from
      // loser — compare object IDENTITY against the two candidates instead (§4.3 rule a).
      const localCandidate = { syncId: local.sync_id, updatedAt: local.updated_at, lamport: local.lamport }
      const incomingCandidate = { syncId: incoming.syncId, updatedAt: incoming.updatedAt, lamport: incoming.lamport }
      const winner = resolveLWW(localCandidate, incomingCandidate)
      if (winner !== incomingCandidate) return // local unpushed edit wins — stays queued
    }
    // Topic collision check against a DIFFERENT sync_id sharing the same topic slot.
    let supersededBy: string | null = null
    if (incoming.topicKey) {
      const existingTopicOwner = this.deps.store.findActiveTopicOwner(
        incoming.projectKey || '__global__',
        incoming.scope,
        incoming.topicKey,
        incoming.syncId
      )
      if (existingTopicOwner) {
        const { winner, loser } = resolveTopicCollision(
          { syncId: existingTopicOwner.sync_id, updatedAt: existingTopicOwner.updated_at, lamport: existingTopicOwner.lamport },
          { syncId: incoming.syncId, updatedAt: incoming.updatedAt, lamport: incoming.lamport }
        )
        if (loser.syncId === incoming.syncId) supersededBy = winner.syncId
      }
    }

    this.deps.store.applyIncomingObservation({
      syncId: incoming.syncId,
      projectKey: incoming.projectKey || '__global__',
      scope: incoming.scope,
      topicKey: incoming.topicKey,
      type: incoming.type ?? 'discovery',
      title: incoming.title ?? '',
      content: incoming.content ?? null,
      tags: incoming.tags,
      originAi: incoming.originAi,
      originAccount: incoming.originAccount,
      gitBranch: incoming.gitBranch,
      authorUserId: incoming.authorUserId,
      authorDisplay: incoming.authorDisplay,
      contentHash: incoming.contentHash,
      updatedAt: incoming.updatedAt,
      lamport: incoming.lamport,
      deleted: incoming.deleted,
      supersededBy,
      serverSeq: incoming.projectSeq,
    })
  }

  private scheduleBackoffRetry(fn: () => void): void {
    if (this.backoffTimer) clearTimeout(this.backoffTimer)
    const delay = this.backoff.next()
    this.backoffTimer = setTimeout(fn, delay)
  }
}
