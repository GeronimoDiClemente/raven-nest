// Sync scheduler — lives in Electron main, owns the only network connection to
// Supabase for memory replication. See docs/nest-memory-architecture.md §1.3, §4.
//
// Citation convention in this file: a bare `§X` refers to that architecture doc; `spec §X`
// refers to the sync-backend spec, docs/superpowers/specs/2026-08-31-memory-sync-backend-design.md.
//
// Deliberately takes its dependencies as plain functions/objects (no direct `electron`
// import) so the scheduling/backoff/apply logic is unit-testable with a mocked fetch and
// vitest fake timers, without spinning up a BrowserWindow or a real network call.

import { MemoryStore, type MutationLogRow } from './memory-store'
import { resolveLWW, resolveTopicCollision, type LWWRow } from './memory-merge'
import { GLOBAL_PROJECT_KEY } from './memory-project-key'

const DEBOUNCE_MS = 3_000
const MAX_WAIT_MS = 30_000
const INTERVAL_MS = 5 * 60_000
const FOCUS_PULL_RATE_LIMIT_MS = 30_000
const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 5 * 60_000
const QUIT_PUSH_BUDGET_MS = 2_000
const PUSH_BATCH_SIZE = 200
const PULL_PAGE_SIZE = 500
// M20: §4.5 "hard cap 50 000, after which the daemon compacts the queue".
const QUEUE_HARD_CAP = 50_000
// C6: without this, a hung backend wedges the daemon until the app restarts. The
// in-flight dedupe (M19) caches the request promise, and a promise that never settles
// never runs its `.finally`, so pullInFlight/pushInFlight stay set forever and every
// subsequent call returns the same dead promise. 30s is generous for a push of 200
// mutations over a bad connection and is still a cutoff, not a wait.
const FETCH_TIMEOUT_MS = 30_000

// 'plan_required' is distinct from 'error': it is not a credential problem (spec §9.3),
// the UI hangs its own Upgrade affordance off it (SettingsPanel.tsx), and — unlike a real
// auth failure — it must never trip the three-strikes breaker or stop the daemon. See
// classifyAuthFailure() and its call sites in push()/pull()/status() below.
export type DaemonStatus = 'idle' | 'syncing' | 'paused' | 'error' | 'plan_required'

// Task 8 (smoke/memory-bridge): a per-mutation rejection is TERMINAL or REVERSIBLE, and
// treating them the same loses data. Terminal (missing_sync_id, observation_too_large,
// team_scope_not_allowed, or anything unrecognized) can never succeed with this exact
// payload — markPushed() records it and moves on so it doesn't loop forever. Reversible is
// a plan limit the user can lift by paying or freeing space (server/src/push.ts's two
// PASADA-1/PASADA-2 rejections) — losing the mutation here is losing it at the exact moment
// of the sale: the Free user who pays for their second repo would get a cloud project with
// nothing in it, because everything they wrote while capped was already discarded. Blocked
// via store.blockMutations() instead — held, not retried every cycle, until status()'s
// unblock check (see doStatus() below) says the limit no longer applies.
const REVERSIBLE_REJECTIONS = new Set(['project_limit_reached', 'quota_exceeded'])

export interface PushResultItem {
  sync_id: string
  outcome: 'applied' | 'superseded' | 'rejected'
  project_seq: number
  error?: string
}

/** spec §5.3.1: one entry in the status roster — keys and display names, never rows. */
export interface StatusRosterProject {
  project_key: string
  display_name?: string
}

export interface StatusResponseBody {
  device_id?: string
  user_id?: string
  plan?: string
  next_poll_ms?: number
  server_time?: string
  quota?: { used_bytes: number; max_bytes: number }
  /**
   * Absent entirely on an older service or the pre-roster stub — that means "no discovery
   * available", not an error, so `status()` must treat a missing field as a no-op rather
   * than a failure.
   */
  projects?: StatusRosterProject[]
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
  /** C4: base of the sync service, not necessarily Supabase. See spec §5.4. */
  getSyncBaseUrl: () => string | null
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
 * C5: the store persists `tags` as a JSON string in a TEXT column, and a queued
 * mutation's payload is a raw snapshot of that row, so without this the push sends a
 * string where the contract expects an array (spec §5.2) and the pull discards anything
 * that isn't already an Array. Tags were lost in both directions with no error at all.
 */
function normalizeTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((t): t is string => typeof t === 'string')
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === 'string')
    } catch { /* not JSON — treat as no tags */ }
  }
  return undefined
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
    tags: normalizeTags(raw.tags),
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
  // Renamed from `status` (the field) to `currentStatus` so the public `status()` method
  // (§5.3.1, GET /v1/sync/status) can have that name — the field and the method are
  // unrelated: this one is the daemon's idle/syncing/paused/error indicator surfaced via
  // getStatus()/onStatusChange, not the sync service's health-check response.
  private currentStatus: DaemonStatus = 'idle'
  private running = false
  // M18: 3 consecutive auth failures used to only stop the BACKOFF chain from
  // re-scheduling itself — every OTHER trigger (a fresh on-write debounce, pane-exit,
  // window focus, the 5-minute interval) still called push()/pull() directly and hit
  // the revoked-token endpoint again. This flag is checked at the top of both push()
  // and pull(), so every entry point is gated the same way. Cleared by
  // onNetworkRegain() — the reconnect flow's actual "the user acted" signal.
  private authBlocked = false
  // Task 8: the plan last reported by status(), used only to detect a CHANGE — a project
  // cap the client has no way to evaluate itself (unlike a byte quota, it doesn't know the
  // new plan's limit), so any change is treated as "might have lifted project_limit_reached"
  // and unblocks on spec. Worst case the very next push is rejected again and re-blocks it.
  // Starts undefined so the very FIRST status() response never counts as "a change".
  private lastSeenPlan: string | undefined
  // La ultima cuota que reporto el servidor. El cliente NO la calcula: los limites de
  // nube los hace cumplir el servicio y el cliente los muestra (corte comercial, Task 3).
  // Se retiene entre respuestas porque un `status` sin el campo significa "no vino este
  // tick", no "el usuario ya no tiene cuota".
  private lastQuota: { used_bytes: number; max_bytes: number } | null = null
  // M19: concurrent triggers (e.g. a debounced push firing at the same moment as the
  // 5-minute interval's drain) used to fire independent overlapping requests — double
  // POSTs of the same batch, or a later pull's cursor write racing an earlier one's.
  // These in-flight promises are returned to a second caller instead of starting a
  // second request.
  private pushInFlight: Promise<void> | null = null
  private pullInFlight: Promise<void> | null = null
  // §11.4 / spec §5.3.1: the server's call, not a client constant. `status()` reads
  // `next_poll_ms` off every response and, when it names a different number, reschedules
  // the interval to it via applyPollInterval(). Starts at the hard-coded fallback because
  // nothing has answered a status() call yet — see spec §5.3.1's "next_poll_ms — the only
  // real cost lever, which had no reader until this change" for why this used to just be
  // INTERVAL_MS forever, unread server value or not.
  private pollIntervalMs = INTERVAL_MS

  constructor(deps: MemoryDaemonDeps) {
    this.deps = deps
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.scheduleIntervalTimer()
  }

  /** Re-armed by applyPollInterval() whenever the server's next_poll_ms changes. */
  private scheduleIntervalTimer(): void {
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    this.intervalTimer = setInterval(() => void this.drain(), this.pollIntervalMs)
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
    this.currentStatus = status
    this.deps.onStatusChange?.(status, detail)
  }

  getStatus(): DaemonStatus {
    return this.currentStatus
  }

  /** La ultima cuota reportada por el servidor, o null si todavia no reporto ninguna. */
  getQuota(): { used_bytes: number; max_bytes: number } | null {
    return this.lastQuota
  }

  // M26: exposed so memory-ipc-server.ts's pull-through search fallback (a zero-result
  // memory_search triggers an immediate pull()) can decide WITHOUT calling pull() at all
  // whether one is worth attempting — pull() already no-ops when offline (doPull()'s own
  // isOnline() check), but skipping the call entirely on a disconnected/offline machine
  // avoids even the Promise/timeout machinery around it, and lets callers (and their
  // tests) assert "no pull attempted" instead of "a pull was attempted and no-opped".
  isOnline(): boolean {
    return this.deps.isOnline()
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
    // spec §5.3.1: drain() is reached from exactly the two triggers the spec names —
    // start()'s interval timer ("on each interval tick") and onNetworkRegain(), which is
    // what the memory:connect IPC handler calls after seeding known projects ("on
    // connect") — so calling status() here, before pull(), covers both without a second
    // call site. ensureProject() inside status() writes synchronously, so a project this
    // call just discovered is already in store.listProjects() by the time pull() (right
    // below) builds its cursors — not just "the next pull" as the spec describes, but
    // this very same drain cycle's pull.
    await this.status()
    await this.pull()
    await this.push()
  }

  /**
   * C6 part 2: `fetch` settles as soon as the RESPONSE HEADERS arrive, so the original
   * `.finally(() => clearTimeout(timer))` disarmed the abort right there — before
   * `await response.json()` had read a single byte. A server that answers 200 + headers
   * and then stalls the body left that `.json()` promise pending forever, which is
   * exactly the wedge C6 was written to close, just moved one step later: the in-flight
   * dedupe (M19) caches a promise that never settles, so pushInFlight/pullInFlight stay
   * set and every later call returns the same dead promise.
   *
   * So the timer stays ARMED across the handoff and the caller disarms it with
   * `release()` only after the body is consumed (or after it decides not to read one).
   * An abort that fires while the body is still streaming errors the body stream, so
   * `response.json()` rejects and the caller's normal error path takes over instead of
   * hanging. `fetchImpl` keeps its exact contract — a plain fetch-shaped function — so
   * every test can still substitute it unchanged.
   */
  private async fetchWithTimeout(
    input: string,
    init: RequestInit
  ): Promise<{ response: Response; release: () => void }> {
    const impl = this.deps.fetchImpl ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await impl(input, { ...init, signal: controller.signal })
      return { response, release: () => clearTimeout(timer) }
    } catch (err) {
      // Never reached the handoff, so nobody will ever call release() — disarm here.
      clearTimeout(timer)
      throw err
    }
  }

  /**
   * spec §9.3: on a 401/403 the server names the reason with `{ error: <code> }` —
   * `plan_required`, `not_in_beta`, or `unauthorized` — so push()/pull()/status() can
   * branch on WHY instead of lumping every 401/403 into "the token is bad". Consumes the
   * response body, so callers must not read it again afterwards (none of the 401/403
   * branches below do).
   *
   * Never throws: a non-JSON or empty body — e.g. a 403 from a proxy sitting in front of
   * the service rather than from the service itself — falls back to `'unauthorized'`,
   * which is exactly the pre-existing treatment for an unrecognized 401/403. That keeps
   * the real auth breaker (M18) as the safe default: an unparseable body must never be
   * silently treated as a non-auth-failure code and skip the breaker.
   */
  private async classifyAuthFailure(
    response: Response
  ): Promise<'plan_required' | 'not_in_beta' | 'device_limit' | 'unauthorized'> {
    try {
      const body = (await response.json()) as { error?: unknown }
      if (body?.error === 'plan_required') return 'plan_required'
      if (body?.error === 'not_in_beta') return 'not_in_beta'
      // Task 9 (smoke/memory-bridge): server/src/auth.ts returns this 403 when the
      // authenticated device isn't among the N oldest machines the plan's device cap
      // allows. A perfectly valid token — the account just registered one machine too
      // many — so this must NOT count toward consecutiveAuthFailures/authBlocked (M18)
      // any more than plan_required or not_in_beta do. Reintroduced the exact "any other
      // 401/403 reads as a bad token" bug those two already fixed: before this, the
      // FOURTH machine on a Free account read "your credentials are revoked" and the
      // daemon stopped retrying — even after a slot freed up, since authBlocked only
      // clears on onNetworkRegain(), not on its own.
      if (body?.error === 'device_limit_reached') return 'device_limit'
    } catch {
      // Not JSON, or no body at all — treat like any other unrecognized 401/403.
    }
    return 'unauthorized'
  }

  push(): Promise<void> {
    // M19: dedupe concurrent callers onto the same in-flight request.
    if (this.pushInFlight) return this.pushInFlight
    const run = this.doPush().finally(() => { this.pushInFlight = null })
    this.pushInFlight = run
    return run
  }

  private async doPush(): Promise<void> {
    const { store, getSyncBaseUrl, getToken, isOnline } = this.deps
    if (this.authBlocked) return // M18: gate every entry point, not just the backoff chain
    if (!isOnline()) {
      this.setStatus('paused', 'offline')
      return
    }
    const url = getSyncBaseUrl()
    const token = getToken()
    if (!url || !token) return

    const pending = store.pendingMutations(PUSH_BATCH_SIZE)
    if (pending.length === 0) {
      this.setStatus('idle')
      return
    }

    this.setStatus('syncing')
    // C6 part 2: disarmed in this try's `finally`, i.e. only AFTER `response.json()` has
    // consumed the body — see fetchWithTimeout().
    let release: (() => void) | null = null
    try {
      const deviceId = this.deps.getDeviceId()
      // Gap #2 fix (cloud display_name defaulting to the raw project_key hash, see
      // CLAUDE.md task notes): the edge function reads `payload.project_display_name`
      // (supabase/functions/memory-sync/index.ts, push handler) but no writer ever put
      // it there — store.save()/appendMutation() persist a plain ObservationRow
      // snapshot with no display-name field. Resolved HERE, at push time, rather than
      // by threading displayName through save()/applyRowUpdate/insertRow and
      // re-serializing every queued mutation_log payload: a project's display name can
      // change locally (rename, or ensureProject learning a remote_url later) after a
      // mutation was already queued, and a push-time join against the CURRENT
      // `projects` table is always fresh, whereas a value baked in at save() time could
      // go stale while still sitting in the offline queue. One listProjects() call per
      // batch is a single indexed-PK read per row, not a per-mutation query.
      const displayNameByProjectKey = new Map(store.listProjects().map((p) => [p.projectKey, p.displayName]))
      const { response, release: releaseTimer } = await this.fetchWithTimeout(`${url}/v1/sync/push`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          mutations: pending.map((m: MutationLogRow) => {
            const payload = JSON.parse(m.payload) as Record<string, unknown>
            const projectKey = (payload.project_key as string | undefined) ?? GLOBAL_PROJECT_KEY
            // C5: `source_ref` carries an absolute path with the user's real name
            // (memory-importers/markdown.ts:51) and the server doesn't even store it —
            // it only rode along to end up in the logs of whatever proxy sits in
            // between. Pruned here, the end that controls the wire.
            const { source_ref: _dropped, ...rest } = payload
            return {
              seq: m.seq,
              sync_id: m.sync_id,
              op: m.op,
              payload: {
                ...rest,
                // `?? []`, not `?? null`: the push RPC does `tags = COALESCE(v_payload->'tags',
                // '[]'::jsonb)` (supabase/migrations/20260730000000_nest_memory.sql) using `->`,
                // which yields jsonb, not text. A present key holding JSON `null` is a jsonb null
                // *scalar*, not SQL NULL, so COALESCE never fires and the column would silently
                // store `null` instead of `[]` — contradicting its own `NOT NULL DEFAULT '[]'`.
                // Sending `[]` here matches what COALESCE would have produced without depending
                // on it firing, and keeps the key always present with the shape the wire expects.
                tags: normalizeTags(payload.tags) ?? [],
                project_display_name: displayNameByProjectKey.get(projectKey) ?? projectKey,
              },
            }
          }),
        }),
      })
      release = releaseTimer

      if (response.status === 401 || response.status === 403) {
        const code = await this.classifyAuthFailure(response)
        if (code === 'plan_required') {
          // spec §9.3: the token is fine — the account's plan just doesn't include cloud
          // sync. NOT an auth failure: must not touch consecutiveAuthFailures/authBlocked,
          // or the daemon would stay dead (M18's gate at the top of every entry point)
          // even after the user upgrades, until the app is restarted. Leaving authBlocked
          // false keeps every trigger — the interval, window focus, on-write debounce,
          // pane exit — retrying normally, so sync resumes on its own the moment the
          // server starts accepting again, no restart required.
          this.setStatus('plan_required')
          return
        }
        if (code === 'not_in_beta') {
          // Also not a credential problem (spec §9.1's single-account allowlist), but
          // unlike plan_required there is nothing in the UI the user can click to fix it
          // — only an operator adding a row server-side helps. So this doesn't get its
          // own DaemonStatus; it stays a generic 'error' but with a distinct detail
          // ('not_in_beta', not 'auth'). What matters most: it must NOT touch the auth
          // breaker either. A perfectly valid token must never read to the user (or to
          // this daemon's own retry logic) as "your credentials are revoked" — it just
          // keeps quietly retrying on the normal interval until the allowlist changes.
          this.setStatus('error', 'not_in_beta')
          return
        }
        if (code === 'device_limit') {
          // Task 9: same shape as not_in_beta — no click-to-fix affordance in this UI today
          // (that would be "remove another device", not implemented), so this stays a
          // generic 'error' with its own detail. Must not touch the auth breaker: the
          // token is fine, the account just has one machine too many registered, and a
          // freed slot should resume sync on its own via status()'s unblock check — not
          // require the user to notice "credentials revoked" and manually reconnect.
          this.setStatus('error', 'device_limit')
          return
        }
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
      // at all, and rejected mutations left no error trail. Per §4.2: accepted mutations
      // are marked pushed. A rejected one is TERMINAL or REVERSIBLE (Task 8, see
      // REVERSIBLE_REJECTIONS above) — terminal is marked pushed too, with the reason, so
      // it doesn't loop forever; reversible is blocked instead of marked pushed, so it
      // isn't discarded. A mutation with NO matching result (the whole call errored before
      // reaching it, or the server response is malformed) is left in the queue for retry.
      const resultBySyncId = new Map(results.map((r) => [r.sync_id, r]))
      const toMark: Array<number | { seq: number; error?: string | null }> = []
      const toBlock: Array<{ seq: number; reason: string }> = []
      for (const m of pending) {
        let payloadSyncId: string | undefined
        try { payloadSyncId = JSON.parse(m.payload).sync_id } catch { /* leave undefined */ }
        const result = payloadSyncId ? resultBySyncId.get(payloadSyncId) : undefined
        if (!result) continue // not acknowledged by the server — retry next cycle
        if (result.outcome !== 'rejected') {
          toMark.push(m.seq)
          continue
        }
        const reason = result.error ?? 'rejected'
        if (REVERSIBLE_REJECTIONS.has(reason)) toBlock.push({ seq: m.seq, reason })
        else toMark.push({ seq: m.seq, error: reason })
      }
      store.markPushed(toMark)
      store.blockMutations(toBlock)

      store.setSyncState('__account__', { lastSuccessAt: Date.now(), lastError: null })
      this.setStatus('idle')

      // M22 fix: a full PUSH_BATCH_SIZE batch used to just sit idle after a successful
      // push until the NEXT external trigger (5-min interval, a fresh mutation debounce,
      // etc.) — per §4 the daemon is supposed to *drain* the queue, not push one batch per
      // trigger. A ~2000-mutation initial migration measured ~25 minutes to finish because
      // of this. Chain the next batch immediately, but only when THIS batch made real
      // progress (`toMark` or `toBlock` non-empty, i.e. the server acknowledged at least
      // one mutation either way) — chaining on a zero-progress response (malformed body /
      // nothing matched) would hot-loop the same unacknowledged batch against the server
      // instead of leaving it to the existing retry/backoff path. `toBlock` counts as
      // progress too (Task 8): if this whole batch got blocked by ONE project's limit,
      // there may still be pendingMutationCount() > 0 left over from OTHER projects that
      // have nothing to do with that limit — worth draining right away rather than waiting
      // for the next external trigger. `setImmediate` (not `queueMicrotask`) is deliberate:
      // doPush() is still executing here, so `push()`'s `.finally` hasn't cleared
      // `pushInFlight` yet — a microtask-scheduled call lands BEFORE that `.finally` runs
      // (queued earlier in the same microtask flush) and would see pushInFlight still set,
      // silently deduping into a no-op per M19. A macrotask runs after the entire microtask
      // queue (including that `.finally`) has drained, so by the time it fires
      // pushInFlight is guaranteed clear and the chained push() actually starts a new
      // request instead of returning the just-finished promise.
      if ((toMark.length > 0 || toBlock.length > 0) && store.pendingMutationCount() > 0) {
        setImmediate(() => void this.push())
      }
    } catch (err) {
      store.setSyncState('__account__', { lastError: err instanceof Error ? err.message : String(err) })
      this.setStatus('error', err instanceof Error ? err.message : String(err))
      this.scheduleBackoffRetry(() => void this.push())
    } finally {
      release?.()
    }
  }

  /**
   * spec §5.3.1: the ONLY place a device can learn a project exists. `handlePull` returns
   * rows only for cursors the device already sent — correct, deliberate, and it's what
   * keeps M25's fix intact (see doPull's own `cursors` comment below) — so a project this
   * device has never seen locally can never appear in a pull response no matter how long
   * it waits, and a freshly installed device with an empty `projects` table would pull
   * nothing, forever, with no error and no symptom. `status()` closes that from the other
   * end: it fetches the account's roster (project keys and display names, never rows) and
   * registers anything not already known via `store.ensureProject()`. That project then
   * has a sync_state cursor of 0 and shows up in `store.listProjects()` — and therefore in
   * doPull()'s `cursors` — on the very next pull. No row is ever handed back for a cursor
   * the device didn't ask for, so nothing here reintroduces the hot loop M25 fixed.
   *
   * Uses the same fetchWithTimeout() push/pull already go through, so a hung status
   * endpoint can't wedge the daemon any differently than a hung push or pull already
   * could (C6).
   */
  async status(): Promise<StatusResponseBody | null> {
    const { store, getSyncBaseUrl, getToken, isOnline } = this.deps
    if (this.authBlocked) return null // M18: gate every entry point, not just push/pull
    if (!isOnline()) return null
    const url = getSyncBaseUrl()
    const token = getToken()
    if (!url || !token) return null

    let release: (() => void) | null = null
    try {
      const { response, release: releaseTimer } = await this.fetchWithTimeout(`${url}/v1/sync/status`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
      release = releaseTimer

      if (response.status === 401 || response.status === 403) {
        const code = await this.classifyAuthFailure(response)
        if (code === 'plan_required') {
          // See doPush()'s identical branch — not an auth failure, breaker untouched.
          this.setStatus('plan_required')
          return null
        }
        if (code === 'not_in_beta') {
          // See doPush()'s identical branch — not a credential problem, breaker untouched.
          this.setStatus('error', 'not_in_beta')
          return null
        }
        if (code === 'device_limit') {
          // Task 9: see doPush()'s identical branch — not a credential problem, breaker untouched.
          this.setStatus('error', 'device_limit')
          return null
        }
        // Feeds the SAME shared counter/flag doPush() trips on 401/403 (M18), rather than
        // keeping an independent one — status() must not gate push/pull any differently
        // than a push auth failure already does, and both push() and pull() already check
        // this exact flag at entry.
        this.consecutiveAuthFailures += 1
        if (this.consecutiveAuthFailures >= 3) {
          this.authBlocked = true
          this.setStatus('error', 'auth')
        }
        return null
      }
      if (!response.ok) return null

      const body = (await response.json()) as StatusResponseBody
      this.consecutiveAuthFailures = 0

      this.applyPollInterval(body.next_poll_ms)

      // Task 8: re-admit mutations blocked by a REVERSIBLE server rejection once the limit
      // that caused it no longer applies — see doPush()'s REVERSIBLE_REJECTIONS split.
      //
      // project_limit_reached can't be evaluated from numbers the client has: it doesn't
      // know the new plan's project cap, only that the plan CHANGED. So any plan change
      // (skipped on the very first status() response, where "changed" is meaningless)
      // unblocks it unconditionally — worst case the next push is rejected again and
      // re-blocks it, which is a wasted request, not a correctness problem.
      //
      // quota_exceeded IS a number the client has: `used_bytes < max_bytes` is checked
      // fresh on every status() response, plan change or not, rather than piggybacking on
      // the plan-change branch — an upgrade's relief shows up here automatically once the
      // server reports the new max_bytes, and deleting old memories to free space (with no
      // plan change at all) has to work exactly the same way.
      if (typeof body.plan === 'string') {
        if (this.lastSeenPlan !== undefined && body.plan !== this.lastSeenPlan) {
          store.unblockMutations(['project_limit_reached'])
        }
        this.lastSeenPlan = body.plan
      }
      if (body.quota) {
        this.lastQuota = body.quota
        if (body.quota.used_bytes < body.quota.max_bytes) {
          store.unblockMutations(['quota_exceeded'])
        }
      }

      // A missing `projects` field means "no discovery available" — an older service, or
      // the pre-roster stub — not an error. Nothing to register, not a failure.
      if (Array.isArray(body.projects)) {
        const known = new Set(store.listProjects().map((p) => p.projectKey))
        for (const project of body.projects) {
          const projectKey = project?.project_key
          if (typeof projectKey !== 'string' || projectKey === '' || known.has(projectKey)) continue
          // ensureProject() is itself idempotent, but the `known` check above means an
          // unchanging roster does ZERO writes per tick after the first, not just zero
          // EFFECTIVE ones — so a roster that never changes can't turn this into a
          // repeated-write (or repeated-pull) loop of its own.
          store.ensureProject({
            projectKey,
            displayName:
              typeof project.display_name === 'string' && project.display_name ? project.display_name : projectKey,
          })
          known.add(projectKey)
        }
      }

      return body
    } catch {
      // Network/timeout failure, not an auth failure — nothing to count. Quiet by design:
      // pull() runs right after this inside drain() and reports its own error state; a
      // status() that also screamed here would just be noise on top of that.
      return null
    } finally {
      release?.()
    }
  }

  /**
   * §11.4: the interval is the server's call, not a client constant. Falls back to
   * whatever is already armed (the hard-coded INTERVAL_MS the first time) when the field
   * is absent or not a positive number — an older service or the stub before it grew this
   * field must not leave the daemon with no interval at all.
   */
  private applyPollInterval(nextPollMs: unknown): void {
    if (typeof nextPollMs !== 'number' || !Number.isFinite(nextPollMs) || nextPollMs <= 0) return
    const next = Math.floor(nextPollMs)
    if (next === this.pollIntervalMs) return
    this.pollIntervalMs = next
    if (this.running) this.scheduleIntervalTimer()
  }

  pull(): Promise<void> {
    // M19: dedupe concurrent callers onto the same in-flight request.
    if (this.pullInFlight) return this.pullInFlight
    const run = this.doPull().finally(() => { this.pullInFlight = null })
    this.pullInFlight = run
    return run
  }

  private async doPull(): Promise<void> {
    const { store, getSyncBaseUrl, getToken, isOnline } = this.deps
    if (this.authBlocked) return // M18
    if (!isOnline()) {
      this.setStatus('paused', 'offline')
      return
    }
    const url = getSyncBaseUrl()
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
    // spec §5.3.1: this used to be the OTHER half of the "a fresh device pulls nothing,
    // ever" bug — `store.listProjects()` reflects only what this device already has
    // locally, so a device that has never written anything of its own returned here on
    // every single pull, forever, with no error and no symptom. It is no longer fatal:
    // status() runs immediately before this, in the same drain() cycle (see drain()'s own
    // comment), and registers every project in the account's roster via ensureProject()
    // BEFORE this line runs — so a fresh device's very first drain() already has a
    // non-empty `projects` here. It stays as a real early return rather than falling
    // through to an empty-cursors request: a project-less device (one that hasn't
    // connected, or whose account genuinely has no projects yet) would otherwise send
    // `{cursors: {}}` on every pull, which the server already treats as "nothing to
    // report" (pull.ts's own `keys.length === 0` short-circuit) — so removing this line
    // would trade a local no-op for a pointless round trip that accomplishes the exact
    // same nothing, working against §11.4's whole point (~99% of pulls come back empty;
    // don't make one on purpose when it's known in advance to be empty).
    if (projects.length === 0) return

    const cursors: Record<string, number> = {}
    for (const project of projects) {
      cursors[project.projectKey] = store.getSyncState(project.projectKey).pullCursor
    }

    // C6 part 2: disarmed in this try's `finally`, i.e. only AFTER `response.json()` has
    // consumed the body — see fetchWithTimeout().
    let release: (() => void) | null = null
    try {
      const { response, release: releaseTimer } = await this.fetchWithTimeout(`${url}/v1/sync/pull`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cursors, limit: PULL_PAGE_SIZE }),
      })
      release = releaseTimer

      if (response.status === 401 || response.status === 403) {
        const code = await this.classifyAuthFailure(response)
        if (code === 'plan_required') {
          // See doPush()'s identical branch — not an auth failure, breaker untouched.
          this.setStatus('plan_required')
          return
        }
        if (code === 'not_in_beta') {
          // See doPush()'s identical branch — not a credential problem, breaker untouched.
          this.setStatus('error', 'not_in_beta')
          return
        }
        if (code === 'device_limit') {
          // Task 9: see doPush()'s identical branch — not a credential problem, breaker untouched.
          this.setStatus('error', 'device_limit')
          return
        }
        // Coherence fix: doPull() used to have NO 401/403 handling at all — it fell
        // through to the generic `!response.ok` throw below, landed in the catch block,
        // and never touched consecutiveAuthFailures. Three real revoked-token responses
        // from pull() alone never tripped the breaker, unlike push()/status() already did
        // — an inconsistency across the three entry points that gate identically on
        // `authBlocked` (M18) but disagreed on what counted toward it. Feeds the same
        // shared counter/flag push()/status() use.
        this.consecutiveAuthFailures += 1
        if (this.consecutiveAuthFailures >= 3) {
          this.authBlocked = true
          this.setStatus('error', 'auth')
        }
        return
      }
      if (!response.ok) throw new Error(`pull failed: ${response.status}`)
      const body = (await response.json()) as { rows: Array<Record<string, unknown>>; cursors: Record<string, number> }
      for (const raw of body.rows) this.applyPulledRow(mapRawPulledRow(raw))

      const now = Date.now()
      // Tracked while writing back cursors below — used by the M25 chain guard.
      let cursorAdvanced = false
      for (const [projectKey, cursor] of Object.entries(body.cursors ?? {})) {
        if (typeof cursor === 'number') {
          if (cursor > (cursors[projectKey] ?? 0)) cursorAdvanced = true
          // M25 hot-loop fix: the server (supabase/functions/memory-sync/index.ts's pull
          // handler) iterates EVERY account project, not just the ones THIS device sent a
          // cursor for, and defaults an unsent cursor to 0 — so an account-owned project
          // this device never registered locally (`projectKey` absent from `cursors`,
          // built from store.listProjects() above) restarts from 0 on every single pull.
          // setSyncState below WOULD persist its returned cursor, but that partition is
          // keyed by project_key with no FK to `projects` — persisting a sync_state row
          // for a project_key `projects` doesn't know about is exactly the pre-existing
          // inconsistency this heals: without a matching `projects` row, listProjects()
          // (and therefore the cursors object built at the top of every doPull() call,
          // including the very next chained one) never includes it, so the persisted
          // cursor is never SENT back — the client always resends 0 for it, the server
          // always reports "progress" from 0, `cursorAdvanced` is always true, and with
          // >= PULL_PAGE_SIZE rows in that project the M25 chain above loops forever
          // re-fetching the same page. Field evidence: a device's local `projects` table
          // had 2 rows while pulling 6 account partitions. Registering the project here —
          // BEFORE persisting its cursor — means the NEXT request (including this same
          // chained one) builds its cursors from a `listProjects()` that now includes it,
          // so the cursor actually gets sent and progress persists instead of resetting.
          // ensureProject() is idempotent and always inserts enrolled=1 (matching its
          // documented default) — verified nothing reads `enrolled` as a push/pull gate
          // today (see main.ts's own ensureProject call site for the same reasoning), so
          // this can't silently change sync behavior for the project once it exists.
          if (!(projectKey in cursors)) {
            store.ensureProject({ projectKey, displayName: projectKey })
          }
          store.setSyncState(projectKey, { pullCursor: cursor, lastSuccessAt: now, lastError: null })
        }
      }
      store.setSyncState('__account__', { lastSuccessAt: now, lastError: null })
      this.consecutiveAuthFailures = 0
      this.backoff.reset()

      // M25 fix: doPull() suffered the exact same disease M22 fixed on the push side — it
      // fetched ONE page (limit: PULL_PAGE_SIZE) and returned, so a backlog bigger than
      // one page only advanced on the NEXT external trigger (the 5-minute interval). A
      // ~2000-row first sync measured ~20+ minutes to catch up this way, one page every 5
      // minutes. Chain the next pull immediately when this page came back full —
      // `body.rows.length === PULL_PAGE_SIZE` — mirroring M22's own "this trigger's shape"
      // signal. Not `has_more`: the memory-sync edge function's pull handler always
      // returns `has_more: false` (dead/unused on the server today) — do not trust it.
      //
      // Guard: only chain when a cursor actually advanced. The edge function loops one
      // `memory_sync_pull` RPC call per LOCAL project and concatenates every project's
      // rows into a single `body.rows` array (supabase/functions/memory-sync/index.ts's
      // pull handler) — with more than one project, `body.rows.length === PULL_PAGE_SIZE`
      // is a coincidental SUM across projects, not proof any single project's page was
      // actually full. The RPC itself (`memory_sync_pull`, nest_memory migration) returns
      // `COALESCE(max(project_seq), p_cursor)` as the new cursor, so a project's cursor can
      // only stay put when that project returned zero rows — "a project returned >0 rows"
      // and "that project's cursor advanced" are the same fact reported two different
      // ways. Comparing each response cursor against the cursor WE SENT for that project
      // (captured in `cursors` above, before the fetch) is the honest per-project check:
      // it can't be fooled by the aggregate-length coincidence, and — same reasoning as
      // M22 — it can't hot-loop, because a response that advances no project's cursor can
      // never chain again. `setImmediate` (not `queueMicrotask`), same reason as M22:
      // doPull() is still executing here, so pull()'s `.finally` hasn't cleared
      // `pullInFlight` (M19) yet — a microtask-scheduled call would run before that
      // `.finally` and see `pullInFlight` still set, silently deduping into a no-op. A
      // macrotask fires only after the microtask queue (including that `.finally`) drains.
      if (body.rows.length === PULL_PAGE_SIZE && cursorAdvanced) {
        setImmediate(() => void this.pull())
      }
    } catch (err) {
      store.setSyncState('__account__', { lastError: err instanceof Error ? err.message : String(err) })
      this.setStatus('error', err instanceof Error ? err.message : String(err))
    } finally {
      release?.()
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
    // C2: the case that was missing. If the incoming row WINS, the local one must be
    // superseded inside the same transaction as the insert; otherwise both stay active on
    // the same slot, idx_obs_topic blows up, the exception bubbles to doPull()'s catch,
    // the cursor never advances and the device never syncs again.
    let supersedeLocal: string | null = null
    // `&& !incoming.deleted`: a tombstone must NEVER take a topic slot away from a live
    // row. findActiveTopicOwner only returns live rows, so without this guard a pulled
    // tombstone that is merely NEWER than a live local row on the same
    // (project_key, scope, topic_key) marks that live row superseded_by = <the tombstone>.
    // The slot goes empty and the local memory disappears from search(), context() and
    // count(), all of which filter superseded_by IS NULL. A tombstone deletes its own
    // sync_id and nothing else.
    if (incoming.topicKey && !incoming.deleted) {
      const existingTopicOwner = this.deps.store.findActiveTopicOwner(
        incoming.projectKey || GLOBAL_PROJECT_KEY,
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
        else supersedeLocal = loser.syncId
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
      supersedeLocal,
      serverSeq: incoming.projectSeq,
    })
  }

  private scheduleBackoffRetry(fn: () => void): void {
    if (this.backoffTimer) clearTimeout(this.backoffTimer)
    const delay = this.backoff.next()
    this.backoffTimer = setTimeout(fn, delay)
  }
}
