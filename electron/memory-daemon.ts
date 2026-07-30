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

export type DaemonStatus = 'idle' | 'syncing' | 'paused' | 'error'

export interface PushResultItem {
  sync_id: string
  outcome: 'applied' | 'superseded' | 'rejected'
  project_seq: number
}

export interface PulledRow extends LWWRow {
  deleted: boolean
  topicKey: string | null
  scope: string
  projectId: string
  supersededBy: string | null
  title?: string
  content?: string
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

  /** §4.1 "Network regain" trigger — full drain. */
  onNetworkRegain(): void {
    this.backoff.reset()
    this.consecutiveAuthFailures = 0
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
    await this.pull()
    await this.push()
  }

  private fetch(input: string, init: RequestInit): Promise<Response> {
    const impl = this.deps.fetchImpl ?? fetch
    return impl(input, init)
  }

  async push(): Promise<void> {
    const { store, getSupabaseUrl, getToken, isOnline } = this.deps
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
      // Every accepted/rejected mutation is marked pushed — rejected ones carry their
      // own local error but must not loop forever (§4.2).
      store.markPushed(pending.map((m) => m.seq))
      store.setSyncState('__account__', { lastSuccessAt: Date.now(), lastError: null })
      this.setStatus('idle')
      void body // reserved for per-project cursor bookkeeping in a later phase
    } catch (err) {
      store.setSyncState('__account__', { lastError: err instanceof Error ? err.message : String(err) })
      this.setStatus('error', err instanceof Error ? err.message : String(err))
      this.scheduleBackoffRetry(() => void this.push())
    }
  }

  async pull(): Promise<void> {
    const { store, getSupabaseUrl, getToken, isOnline } = this.deps
    if (!isOnline()) {
      this.setStatus('paused', 'offline')
      return
    }
    const url = getSupabaseUrl()
    const token = getToken()
    if (!url || !token) return

    try {
      const state = store.getSyncState('__account__')
      const response = await this.fetch(`${url}/functions/v1/memory-sync/pull`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cursors: { __account__: state.pullCursor }, limit: 500 }),
      })
      if (!response.ok) throw new Error(`pull failed: ${response.status}`)
      const body = (await response.json()) as { rows: PulledRow[]; cursors: Record<string, number> }
      for (const row of body.rows) this.applyPulledRow(row)
      const nextCursor = Object.values(body.cursors)[0]
      if (typeof nextCursor === 'number') store.setSyncState('__account__', { pullCursor: nextCursor, lastSuccessAt: Date.now(), lastError: null })
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
        incoming.projectId ?? '__global__',
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
      projectKey: incoming.projectId ?? '__global__',
      scope: incoming.scope,
      topicKey: incoming.topicKey,
      type: (incoming.type as string) ?? 'discovery',
      title: (incoming.title as string) ?? '',
      content: (incoming.content as string) ?? '',
      tags: incoming.tags as string[] | undefined,
      originAi: incoming.originAi as string | undefined,
      originAccount: incoming.originAccount as string | undefined,
      gitBranch: incoming.gitBranch as string | undefined,
      authorUserId: incoming.authorUserId as string | undefined,
      authorDisplay: incoming.authorDisplay as string | undefined,
      contentHash: incoming.contentHash as string | undefined,
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
