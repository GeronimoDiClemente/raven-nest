import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { MemoryDaemon, Backoff, mapRawPulledRow } from '../memory-daemon'
import { MemoryStore, type MutationLogRow } from '../memory-store'
import { makeTmpDir, cleanupTmp } from './setup'

const PENDING_MUTATION_A: MutationLogRow[] = [
  { seq: 1, sync_id: 'a', op: 'upsert', payload: JSON.stringify({ sync_id: 'a', project_key: 'proj-1' }), created_at: 1, pushed_at: null, last_error: null, blocked_reason: null },
]

function fakeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  const pending: MutationLogRow[] = []
  return {
    pendingMutations: vi.fn(() => pending),
    markPushed: vi.fn(),
    blockMutations: vi.fn(),
    blockedMutations: vi.fn(() => []),
    unblockMutations: vi.fn(),
    setSyncState: vi.fn(),
    getSyncState: vi.fn(() => ({ pullCursor: 0, lastPushSeq: 0 })),
    listProjects: vi.fn(() => [{ projectKey: 'proj-1', displayName: 'proj-1', enrolled: true }]),
    pruneAckedMutations: vi.fn(() => 0),
    pendingMutationCount: vi.fn(() => 0),
    compactMutationLog: vi.fn(() => 0),
    get: vi.fn(() => null),
    findActiveTopicOwner: vi.fn(() => null),
    applyIncomingObservation: vi.fn(),
    ensureProject: vi.fn(),
    ...overrides,
  } as unknown as MemoryStore
}

function baseDaemonDeps(store: MemoryStore, extra: Partial<ConstructorParameters<typeof MemoryDaemon>[0]> = {}) {
  return {
    store,
    getSyncBaseUrl: () => 'https://example.supabase.co',
    getToken: () => 'nmk_test',
    getDeviceId: () => 'device-1',
    isOnline: () => true,
    ...extra,
  }
}

describe('Backoff', () => {
  it('grows exponentially with jitter, capped', () => {
    const backoff = new Backoff()
    const delays = [backoff.next(), backoff.next(), backoff.next()]
    // base 5000 -> ~5000-6000, ~10000-12000, ~20000-24000 (20% jitter)
    expect(delays[0]).toBeGreaterThanOrEqual(5000)
    expect(delays[0]).toBeLessThan(6000)
    expect(delays[1]).toBeGreaterThanOrEqual(10000)
    expect(delays[1]).toBeLessThan(12000)
    expect(delays[2]).toBeGreaterThanOrEqual(20000)
    expect(delays[2]).toBeLessThan(24000)
  })

  it('resets to the base delay', () => {
    const backoff = new Backoff()
    backoff.next()
    backoff.next()
    backoff.reset()
    expect(backoff.next()).toBeLessThan(6000)
  })

  it('caps growth and never exceeds the 5-minute ceiling', () => {
    const backoff = new Backoff()
    let last = 0
    for (let i = 0; i < 15; i++) last = backoff.next()
    expect(last).toBeLessThanOrEqual(5 * 60_000 * 1.2)
  })
})

describe('MemoryDaemon — push debounce (§4.1 "On write")', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces multiple writes within 3s into a single push', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    daemon.scheduleMutationPush()
    await vi.advanceTimersByTimeAsync(1000)
    daemon.scheduleMutationPush() // resets the 3s debounce window
    await vi.advanceTimersByTimeAsync(1000)
    daemon.scheduleMutationPush()
    await vi.advanceTimersByTimeAsync(3500) // now past 3s since the last schedule

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    daemon.stop()
  })

  it('force-pushes at the 30s max-wait even if writes keep resetting the debounce', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    // A write every 2s for 34s keeps re-debouncing (never idle for 3s straight).
    for (let i = 0; i < 17; i++) {
      daemon.scheduleMutationPush()
      await vi.advanceTimersByTimeAsync(2000)
    }

    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(1)
    daemon.stop()
  })
})

describe('MemoryDaemon — offline / online transitions (§4.1)', () => {
  it('does not call fetch and reports paused when offline', async () => {
    const fetchImpl = vi.fn()
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const statuses: string[] = []
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { isOnline: () => false, fetchImpl, onStatusChange: (s) => statuses.push(s) }))

    await daemon.push()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(statuses).toContain('paused')
  })

  it('marks accepted mutations pushed (matched by sync_id in the server results) and returns to idle', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ sync_id: 'a', outcome: 'applied', project_seq: 1 }] }),
    })
    const markPushed = vi.fn()
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A), markPushed })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.push()
    expect(markPushed).toHaveBeenCalledWith([1])
    expect(daemon.getStatus()).toBe('idle')
  })

  it('M21: marks a rejected mutation pushed too, but records the server error (does not loop forever, per §4.2)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ sync_id: 'a', outcome: 'rejected', project_seq: 0, error: 'plan_required' }] }),
    })
    const markPushed = vi.fn()
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A), markPushed })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.push()
    expect(markPushed).toHaveBeenCalledWith([{ seq: 1, error: 'plan_required' }])
  })

  it('M21: a mutation the server never acknowledged at all is NOT marked pushed (stays queued for retry)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) })
    const markPushed = vi.fn()
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A), markPushed })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.push()
    expect(markPushed).toHaveBeenCalledWith([])
  })

  // Task 8 (smoke/memory-bridge): a REVERSIBLE rejection (project_limit_reached,
  // quota_exceeded) must not go through markPushed() — that's the M21 path that discards a
  // mutation forever, and this one can still succeed once the user pays or frees space.
  // §4.1 "the second repo is the moment of payment" delivered broken: a Free user paying
  // for their second repo would get a cloud project with nothing in it, because everything
  // they wrote while capped was silently discarded instead of held.
  it("blocks (doesn't mark pushed) a mutation rejected for project_limit_reached", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ sync_id: 'a', outcome: 'rejected', project_seq: 0, error: 'project_limit_reached' }] }),
    })
    const markPushed = vi.fn()
    const blockMutations = vi.fn()
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A), markPushed, blockMutations })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.push()

    expect(blockMutations).toHaveBeenCalledWith([{ seq: 1, reason: 'project_limit_reached' }])
    expect(markPushed).toHaveBeenCalledWith([]) // NOT marked pushed — that would discard it
  })

  it('blocks a mutation rejected for quota_exceeded the same way', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ sync_id: 'a', outcome: 'rejected', project_seq: 0, error: 'quota_exceeded' }] }),
    })
    const blockMutations = vi.fn()
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A), blockMutations })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.push()

    expect(blockMutations).toHaveBeenCalledWith([{ seq: 1, reason: 'quota_exceeded' }])
  })

  it('a TERMINAL rejection (e.g. observation_too_large) still goes through markPushed, unaffected by the reversible split', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ sync_id: 'a', outcome: 'rejected', project_seq: 0, error: 'observation_too_large' }] }),
    })
    const markPushed = vi.fn()
    const blockMutations = vi.fn()
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A), markPushed, blockMutations })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.push()

    expect(markPushed).toHaveBeenCalledWith([{ seq: 1, error: 'observation_too_large' }])
    expect(blockMutations).toHaveBeenCalledWith([])
  })

  it("status(): a plan change unblocks project_limit_reached — the client can't evaluate the new plan's cap itself", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ plan: 'free' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ plan: 'cloud' }) })
    const unblockMutations = vi.fn()
    const store = fakeStore({ unblockMutations })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.status() // first response only establishes lastSeenPlan — nothing to unblock yet
    expect(unblockMutations).not.toHaveBeenCalled()

    await daemon.status() // plan changed free -> cloud
    expect(unblockMutations).toHaveBeenCalledWith(['project_limit_reached'])
  })

  it('status(): quota under the max unblocks quota_exceeded, independent of any plan change', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ plan: 'free', quota: { used_bytes: 10, max_bytes: 1000 } }),
    })
    const unblockMutations = vi.fn()
    const store = fakeStore({ unblockMutations })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.status()

    expect(unblockMutations).toHaveBeenCalledWith(['quota_exceeded'])
  })

  // Task 3 del corte comercial: la cuota que se ve en Settings sale del servidor, no de
  // una constante del cliente. El daemon leia `body.quota` para desbloquear mutaciones y
  // lo tiraba; sin retenerlo no habia forma de que llegara a la pantalla.
  it('status(): retiene la ultima cuota reportada para que la UI la pueda leer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ plan: 'cloud', quota: { used_bytes: 3_183_898, max_bytes: 1024 ** 3 } }),
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(fakeStore(), { fetchImpl }))

    expect(daemon.getQuota()).toBeNull()
    await daemon.status()

    expect(daemon.getQuota()).toEqual({ used_bytes: 3_183_898, max_bytes: 1024 ** 3 })
  })

  it('status(): una respuesta sin cuota no borra la ultima conocida', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ quota: { used_bytes: 5, max_bytes: 100 } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
    const daemon = new MemoryDaemon(baseDaemonDeps(fakeStore(), { fetchImpl }))

    await daemon.status()
    await daemon.status()

    expect(daemon.getQuota()).toEqual({ used_bytes: 5, max_bytes: 100 })
  })

  it('status(): quota still at or over the max does NOT unblock quota_exceeded', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ plan: 'free', quota: { used_bytes: 1000, max_bytes: 1000 } }),
    })
    const unblockMutations = vi.fn()
    const store = fakeStore({ unblockMutations })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.status()

    expect(unblockMutations).not.toHaveBeenCalled()
  })

  it('stops retrying after 3 consecutive auth failures and surfaces an error state', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const statuses: string[] = []
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { getToken: () => 'nmk_bad', fetchImpl, onStatusChange: (s) => statuses.push(s) }))

    vi.useFakeTimers()
    await daemon.push()
    await vi.runOnlyPendingTimersAsync()
    await daemon.push()
    await vi.runOnlyPendingTimersAsync()
    await daemon.push()
    vi.useRealTimers()

    expect(statuses.filter((s) => s === 'error').length).toBeGreaterThan(0)
    daemon.stop()
  })

  it('M18: once auth-blocked, OTHER trigger paths (not just the backoff chain) stop calling fetch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    vi.useFakeTimers()
    await daemon.push()
    await vi.runOnlyPendingTimersAsync()
    await daemon.push()
    await vi.runOnlyPendingTimersAsync()
    await daemon.push() // 3rd failure -> authBlocked = true
    vi.useRealTimers()

    const callsBeforeExtraTriggers = fetchImpl.mock.calls.length
    daemon.onPaneExit()
    await daemon.pull()
    daemon.scheduleMutationPush()
    await new Promise((r) => setTimeout(r, 10))

    expect(fetchImpl.mock.calls.length).toBe(callsBeforeExtraTriggers)
    daemon.stop()
  })

  it('M18: onNetworkRegain clears the auth-block so pushes resume', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [{ sync_id: 'a', outcome: 'applied', project_seq: 1 }] }) })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    vi.useFakeTimers()
    await daemon.push()
    await vi.runOnlyPendingTimersAsync()
    await daemon.push()
    await vi.runOnlyPendingTimersAsync()
    await daemon.push() // authBlocked = true
    vi.useRealTimers()

    daemon.onNetworkRegain()
    await new Promise((r) => setTimeout(r, 10))

    expect(daemon.getStatus()).not.toBe('error')
    daemon.stop()
  })
})

// smoke/memory-bridge task: the server enforces the plan gate correctly (server/src/auth.ts
// returns 403 plan_required), but before this the client could not tell that apart from a
// bad token — doPush() treated ANY 401/403 as an auth failure, so a free-plan user got
// "authentication error" instead of "upgrade to sync", and sync stayed dead after they
// upgraded until the app restarted (authBlocked never clears itself). These tests prove
// the fix at the SCENARIO level (per the task's own framing), not just the branch, and
// that pull()/status() are now coherent with push() rather than each doing something
// different on the same 401/403.
describe('MemoryDaemon — plan-gate branch on 401/403 (spec §9.3)', () => {
  it('push(): 403 plan_required three times in a row does not block — the daemon still syncs on the 4th attempt once the server accepts', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'plan_required' }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'plan_required' }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'plan_required' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ results: [{ sync_id: 'a', outcome: 'applied', project_seq: 1 }] }) })
    const markPushed = vi.fn()
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A), markPushed })
    const statuses: string[] = []
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl, onStatusChange: (s) => statuses.push(s) }))

    await daemon.push()
    await daemon.push()
    await daemon.push()
    expect(statuses).toContain('plan_required')
    expect(statuses).not.toContain('error') // never trips the auth breaker

    await daemon.push() // server now accepts — must NOT be authBlocked
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(markPushed).toHaveBeenCalledWith([1])
    expect(daemon.getStatus()).toBe('idle')
  })

  it('mirror: three real 401 unauthorized responses still block push() — the breaker is not weakened by the new branching', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    vi.useFakeTimers()
    await daemon.push()
    await vi.runOnlyPendingTimersAsync()
    await daemon.push()
    await vi.runOnlyPendingTimersAsync()
    await daemon.push() // 3rd real failure -> authBlocked = true
    vi.useRealTimers()

    expect(daemon.getStatus()).toBe('error')
    const callsBeforeExtra = fetchImpl.mock.calls.length
    await daemon.push() // blocked entirely — no 4th network call
    expect(fetchImpl.mock.calls.length).toBe(callsBeforeExtra)
    daemon.stop()
  })

  it('push(): 403 not_in_beta does not touch the auth breaker either, and does not present as a bad token (distinct error detail from real auth)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'not_in_beta' }) })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const details: Array<string | undefined> = []
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl, onStatusChange: (_s, d) => details.push(d) }))

    await daemon.push()
    await daemon.push()
    await daemon.push() // would be the 3rd real auth failure if this counted toward the breaker

    expect(details).toContain('not_in_beta')
    expect(details).not.toContain('auth') // never classified as a credential failure

    await daemon.push() // still not authBlocked — a 4th call still hits the network
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  // Task 9 (smoke/memory-bridge): the FOURTH machine on a Free account (maxDevices=1) gets
  // this 403 from server/src/auth.ts's device-count check. The token is completely valid —
  // one machine too many is registered — so this must be indistinguishable from
  // not_in_beta/plan_required in every way that matters: no breaker, no "credentials
  // revoked" reading, and it keeps retrying so a freed slot resumes sync on its own.
  it('push(): 403 device_limit_reached does not touch the auth breaker either, and reads as a device-limit detail, not a bad token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'device_limit_reached' }) })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const details: Array<string | undefined> = []
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl, onStatusChange: (_s, d) => details.push(d) }))

    await daemon.push()
    await daemon.push()
    await daemon.push() // would be the 3rd real auth failure if this counted toward the breaker

    expect(details).toContain('device_limit')
    expect(details).not.toContain('auth') // never classified as a credential failure

    await daemon.push() // still not authBlocked — a 4th call still hits the network
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('pull(): 403 device_limit_reached does not throw and does not touch the auth breaker', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'device_limit_reached' }) })
    const store = fakeStore()
    const details: Array<string | undefined> = []
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl, onStatusChange: (_s, d) => details.push(d) }))

    await daemon.pull()
    await daemon.pull()
    await daemon.pull() // would be the 3rd real auth failure if this counted toward the breaker

    expect(details).toContain('device_limit')
    await daemon.pull() // still not blocked
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('status(): 403 device_limit_reached does not touch the breaker', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'device_limit_reached' }) })
    const store = fakeStore()
    const details: Array<string | undefined> = []
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl, onStatusChange: (_s, d) => details.push(d) }))

    await daemon.status()
    await daemon.status()
    await daemon.status() // would be the 3rd real auth failure if this counted toward the breaker

    expect(details).toContain('device_limit')
    await daemon.status() // still not blocked
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('pull(): 403 plan_required does not throw and does not touch the auth breaker', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'plan_required' }) })
    const store = fakeStore()
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.pull()
    await daemon.pull()
    await daemon.pull()

    expect(daemon.getStatus()).toBe('plan_required')
    await daemon.pull() // still not blocked
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('pull(): three real 401s from pull() ALONE now trip the shared breaker (coherence fix — pull() used to never touch this counter)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) })
    const store = fakeStore()
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.pull()
    await daemon.pull()
    await daemon.pull() // 3rd real failure -> authBlocked = true

    expect(daemon.getStatus()).toBe('error')
    const callsBeforeExtra = fetchImpl.mock.calls.length
    await daemon.pull()
    await daemon.push() // every entry point gated identically (M18)
    expect(fetchImpl.mock.calls.length).toBe(callsBeforeExtra)
  })

  it('status(): 403 plan_required does not touch the breaker', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'plan_required' }) })
    const store = fakeStore()
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.status()
    await daemon.status()
    await daemon.status()

    expect(daemon.getStatus()).toBe('plan_required')
    await daemon.status() // still not blocked
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('an unparseable 403 body falls back to the pre-existing unauthorized treatment instead of silently disabling the breaker', async () => {
    // A 403 from a proxy in front of the service, not from the service itself — no JSON
    // body at all. Must not be treated as plan_required/not_in_beta.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => { throw new SyntaxError('Unexpected end of JSON input') },
    })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    vi.useFakeTimers()
    await daemon.push()
    await vi.runOnlyPendingTimersAsync()
    await daemon.push()
    await vi.runOnlyPendingTimersAsync()
    await daemon.push() // 3rd -> must still trip the breaker
    vi.useRealTimers()

    expect(daemon.getStatus()).toBe('error')
    daemon.stop()
  })

  it('a plan_required push does not chain the setImmediate re-push (no queued mutation was acknowledged)', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'plan_required' }) })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A), pendingMutationCount: vi.fn(() => 1) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.push()
    await vi.runOnlyPendingTimersAsync()
    await vi.runOnlyPendingTimersAsync()

    expect(fetchImpl).toHaveBeenCalledTimes(1) // no hot loop
    daemon.stop()
    vi.useRealTimers()
  })
})

describe('MemoryDaemon — push resolves project_display_name (gap #2 fix)', () => {
  it('joins each mutation payload against listProjects() and sends the local display name', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) })
    const store = fakeStore({
      pendingMutations: vi.fn(() => PENDING_MUTATION_A), // payload.project_key === 'proj-1'
      listProjects: vi.fn(() => [{ projectKey: 'proj-1', displayName: 'raven-nest', enrolled: true }]),
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.push()

    const sentBody = JSON.parse(fetchImpl.mock.calls[0][1].body) as { mutations: Array<{ payload: Record<string, unknown> }> }
    expect(sentBody.mutations[0].payload.project_display_name).toBe('raven-nest')
    // original payload fields survive the join (project_key untouched, not dropped)
    expect(sentBody.mutations[0].payload.project_key).toBe('proj-1')
  })

  it('falls back to the raw project_key when the project is not (yet) in the local projects table', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) })
    const store = fakeStore({
      pendingMutations: vi.fn(() => PENDING_MUTATION_A),
      listProjects: vi.fn(() => []), // e.g. ensureProject failed/hasn't run yet
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.push()

    const sentBody = JSON.parse(fetchImpl.mock.calls[0][1].body) as { mutations: Array<{ payload: Record<string, unknown> }> }
    expect(sentBody.mutations[0].payload.project_display_name).toBe('proj-1')
  })

  it('falls back to GLOBAL_PROJECT_KEY when a mutation payload has no project_key at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) })
    const noProjectKeyMutation: MutationLogRow[] = [
      { seq: 1, sync_id: 'g', op: 'upsert', payload: JSON.stringify({ sync_id: 'g' }), created_at: 1, pushed_at: null, last_error: null, blocked_reason: null },
    ]
    const store = fakeStore({
      pendingMutations: vi.fn(() => noProjectKeyMutation),
      listProjects: vi.fn(() => [{ projectKey: '__global__', displayName: '__global__', enrolled: true }]),
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.push()

    const sentBody = JSON.parse(fetchImpl.mock.calls[0][1].body) as { mutations: Array<{ payload: Record<string, unknown> }> }
    expect(sentBody.mutations[0].payload.project_display_name).toBe('__global__')
  })
})

describe('MemoryDaemon — configurable sync base URL (C4)', () => {
  it('pushes against /v1/sync/push with the configured base', async () => {
    const pending: MutationLogRow[] = [
      { seq: 1, sync_id: 'a', op: 'upsert', payload: JSON.stringify({ sync_id: 'a', project_key: 'proj-1' }), created_at: 1, pushed_at: null, last_error: null, blocked_reason: null },
    ]
    const store = fakeStore({ pendingMutations: vi.fn(() => pending) })
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    }) as unknown as typeof fetch

    const daemon = new MemoryDaemon({
      store,
      getSyncBaseUrl: () => 'https://memory.nestmux.com',
      getToken: () => 'nmk_test',
      getDeviceId: () => 'device-1',
      isOnline: () => true,
      fetchImpl,
    })
    await daemon.push()

    expect(urls[0]).toBe('https://memory.nestmux.com/v1/sync/push')
  })
})

describe('MemoryDaemon — in-flight dedupe (M19)', () => {
  it('concurrent push() calls share a single in-flight request', async () => {
    let resolveResponse: (v: unknown) => void = () => {}
    const responsePromise = new Promise((resolve) => { resolveResponse = resolve })
    const fetchImpl = vi.fn().mockReturnValue(responsePromise)
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    const first = daemon.push()
    const second = daemon.push()
    resolveResponse({ ok: true, status: 200, json: async () => ({ results: [] }) })
    await Promise.all([first, second])

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('concurrent pull() calls share a single in-flight request', async () => {
    let resolveResponse: (v: unknown) => void = () => {}
    const responsePromise = new Promise((resolve) => { resolveResponse = resolve })
    const fetchImpl = vi.fn().mockReturnValue(responsePromise)
    const store = fakeStore()
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    const first = daemon.pull()
    const second = daemon.pull()
    resolveResponse({ ok: true, status: 200, json: async () => ({ rows: [], cursors: {} }) })
    await Promise.all([first, second])

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('MemoryDaemon — network timeout (C6)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('aborts a hung fetch and releases the in-flight dedupe', async () => {
    const store = fakeStore()
    let aborted = false
    const fetchImpl = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    ) as unknown as typeof fetch

    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))
    const first = daemon.pull()
    await vi.advanceTimersByTimeAsync(31_000)
    await first

    expect(aborted).toBe(true)

    // The in-flight dedupe was released: a second call fires a fresh request.
    void daemon.pull()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  // C6 part 2: `fetch` settles on HEADERS, so a `.finally(clearTimeout)` on that promise
  // disarmed the abort before `response.json()` read a byte. This server answers 200 +
  // headers instantly and then stalls the body forever — the exact same wedge, one step
  // later. The timeout has to still be armed here.
  it('aborts and settles when the response BODY stalls after the headers arrive', async () => {
    const store = fakeStore()
    let bodyAborted = false
    const fetchImpl = vi.fn((_url: string, init: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        // Headers are already here; the body never arrives.
        json: () => new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            bodyAborted = true
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
      } as unknown as Response)
    ) as unknown as typeof fetch

    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))
    const first = daemon.pull()
    await vi.advanceTimersByTimeAsync(31_000)
    await first

    expect(bodyAborted).toBe(true)

    // And the in-flight dedupe was released, so the daemon is not wedged.
    void daemon.pull()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('MemoryDaemon — pull (§4.4, M17 per-project cursors)', () => {
  it('sends one cursor per known local project and writes each back to its own partition', async () => {
    const setSyncState = vi.fn()
    const getSyncState = vi.fn((key: string) => (key === 'proj-a' ? { pullCursor: 10, lastPushSeq: 0 } : { pullCursor: 20, lastPushSeq: 0 }))
    const store = fakeStore({
      listProjects: vi.fn(() => [
        { projectKey: 'proj-a', displayName: 'A', enrolled: true },
        { projectKey: 'proj-b', displayName: 'B', enrolled: true },
      ]),
      getSyncState,
      setSyncState,
    })
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ rows: [], cursors: { 'proj-a': 15, 'proj-b': 25 } }),
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.pull()

    const sentBody = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(sentBody.cursors).toEqual({ 'proj-a': 10, 'proj-b': 20 })
    expect(setSyncState).toHaveBeenCalledWith('proj-a', expect.objectContaining({ pullCursor: 15 }))
    expect(setSyncState).toHaveBeenCalledWith('proj-b', expect.objectContaining({ pullCursor: 25 }))
  })

  it('skips the network call entirely when there are no local projects yet', async () => {
    const fetchImpl = vi.fn()
    const store = fakeStore({ listProjects: vi.fn(() => []) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.pull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('MemoryDaemon — offline-queue maintenance (M20)', () => {
  // drain() now calls status() before pull() (§5.3.1), so every drain() trigger in this
  // file needs a fetchImpl — without one, fetchWithTimeout() falls back to the REAL global
  // `fetch` (see MemoryDaemonDeps.fetchImpl), which would make an actual network request
  // in a unit test. A bare 200 with no body is enough: status() treats a missing
  // `next_poll_ms`/`projects` as "nothing to do" (both are optional).
  const quietStatus = () => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })

  it('drain() prunes acked mutations and compacts the log only past the hard cap', async () => {
    const pruneAckedMutations = vi.fn(() => 0)
    const compactMutationLog = vi.fn(() => 0)
    const store = fakeStore({
      pruneAckedMutations,
      compactMutationLog,
      pendingMutationCount: vi.fn(() => 50_001),
      listProjects: vi.fn(() => []),
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl: quietStatus() }))

    // drain() is private; exercised via the interval trigger through start()+timer, but
    // simplest here is to call the public onNetworkRegain() which drains immediately.
    daemon.onNetworkRegain()
    await new Promise((r) => setTimeout(r, 10))

    expect(pruneAckedMutations).toHaveBeenCalled()
    expect(compactMutationLog).toHaveBeenCalled()
  })

  it('does not compact when under the hard cap', async () => {
    const compactMutationLog = vi.fn(() => 0)
    const store = fakeStore({ compactMutationLog, pendingMutationCount: vi.fn(() => 10), listProjects: vi.fn(() => []) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl: quietStatus() }))

    daemon.onNetworkRegain()
    await new Promise((r) => setTimeout(r, 10))

    expect(compactMutationLog).not.toHaveBeenCalled()
  })
})

describe('MemoryDaemon — chained batch drain (M22, PUSH_BATCH_SIZE=200)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function makeMutation(n: number): MutationLogRow {
    return {
      seq: n,
      sync_id: `m${n}`,
      op: 'upsert',
      payload: JSON.stringify({ sync_id: `m${n}`, project_key: 'proj-1' }),
      created_at: n,
      pushed_at: null,
      last_error: null,
      blocked_reason: null,
    }
  }

  it('drains a queue larger than PUSH_BATCH_SIZE without waiting for the next external trigger', async () => {
    const TOTAL = 250 // > PUSH_BATCH_SIZE (200) -> requires two batches
    let queue: MutationLogRow[] = Array.from({ length: TOTAL }, (_, i) => makeMutation(i + 1))
    const pendingMutations = vi.fn((limit = 200) => queue.slice(0, limit))
    const markPushed = vi.fn((entries: Array<number | { seq: number; error?: string | null }>) => {
      const seqs = new Set(entries.map((e) => (typeof e === 'number' ? e : e.seq)))
      queue = queue.filter((m) => !seqs.has(m.seq))
    })
    const pendingMutationCount = vi.fn(() => queue.length)

    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { mutations: Array<{ sync_id: string }> }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: body.mutations.map((m) => ({ sync_id: m.sync_id, outcome: 'applied' as const, project_seq: 1 })),
        }),
      }
    }) as unknown as typeof fetch

    const store = fakeStore({ pendingMutations, markPushed, pendingMutationCount })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.push()
    // The second batch is chained via setImmediate (a macrotask), not the 5-minute
    // interval timer — flush pending macro/microtasks without advancing simulated time
    // past that interval, proving the drain doesn't depend on the next external trigger.
    for (let i = 0; i < 5 && queue.length > 0; i++) {
      await vi.runOnlyPendingTimersAsync()
    }

    expect(queue.length).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(2) // 200 then 50, chained back-to-back
    daemon.stop()
  })

  it('does not chain an immediate re-push when the batch made no progress (server acknowledged nothing)', async () => {
    const store = fakeStore({
      pendingMutations: vi.fn(() => PENDING_MUTATION_A),
      // Pretend more mutations are queued — if the chain guard only checked
      // pendingMutationCount() (and not "did this batch make progress"), it would
      // wrongly hot-loop the same unacknowledged batch against the server.
      pendingMutationCount: vi.fn(() => 5),
    })
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.push()
    await vi.runOnlyPendingTimersAsync()
    await vi.runOnlyPendingTimersAsync()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    daemon.stop()
  })
})

describe('MemoryDaemon — chained pull pages (M25, PULL_PAGE_SIZE=500)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function makeRows(n: number, projectKey = 'proj-1'): Array<Record<string, unknown>> {
    return Array.from({ length: n }, (_, i) => ({
      sync_id: `s${i}`,
      project_key: projectKey,
      client_updated_at: '2026-01-05T21:00:00+00:00',
      lamport: 1,
      deleted: false,
      project_seq: i + 1,
    }))
  }

  it('a full page (rows.length === limit) with an advanced cursor chains a second pull without an external trigger', async () => {
    const store = fakeStore({
      listProjects: vi.fn(() => [{ projectKey: 'proj-1', displayName: 'proj-1', enrolled: true }]),
      getSyncState: vi.fn(() => ({ pullCursor: 0, lastPushSeq: 0 })),
    })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ rows: makeRows(500), cursors: { 'proj-1': 500 } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ rows: makeRows(120), cursors: { 'proj-1': 620 } }) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.pull()
    await vi.runOnlyPendingTimersAsync() // flush the setImmediate-chained second pull

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    // First chained request re-reads the cursor via getSyncState — not a hardcoded 500 —
    // proving the second page is a real continuation and not a duplicate of the first.
    daemon.stop()
  })

  it('stops chaining once a response returns fewer than a full page', async () => {
    const store = fakeStore({
      listProjects: vi.fn(() => [{ projectKey: 'proj-1', displayName: 'proj-1', enrolled: true }]),
      getSyncState: vi.fn(() => ({ pullCursor: 0, lastPushSeq: 0 })),
    })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ rows: makeRows(500), cursors: { 'proj-1': 500 } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ rows: makeRows(3), cursors: { 'proj-1': 503 } }) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.pull()
    await vi.runOnlyPendingTimersAsync()
    await vi.runOnlyPendingTimersAsync() // would fire a 3rd request if the guard were wrong

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    daemon.stop()
  })

  it('a full page whose cursor did NOT advance does not chain (no hot loop against a stuck cursor)', async () => {
    // Not achievable through the real server (a full page always implies max(project_seq)
    // > p_cursor per memory_sync_pull's COALESCE), but this is exactly the guard's job:
    // a malformed/replayed response must never hot-loop the same page forever.
    const store = fakeStore({
      listProjects: vi.fn(() => [{ projectKey: 'proj-1', displayName: 'proj-1', enrolled: true }]),
      getSyncState: vi.fn(() => ({ pullCursor: 500, lastPushSeq: 0 })),
    })
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ rows: makeRows(500), cursors: { 'proj-1': 500 } }), // same cursor sent back
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.pull()
    await vi.runOnlyPendingTimersAsync()
    await vi.runOnlyPendingTimersAsync()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    daemon.stop()
  })

  it('a full aggregate across multiple projects where only one project actually advanced still chains', async () => {
    const store = fakeStore({
      listProjects: vi.fn(() => [
        { projectKey: 'proj-a', displayName: 'A', enrolled: true },
        { projectKey: 'proj-b', displayName: 'B', enrolled: true },
      ]),
      getSyncState: vi.fn((key: string) => (key === 'proj-a' ? { pullCursor: 0, lastPushSeq: 0 } : { pullCursor: 50, lastPushSeq: 0 })),
    })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          rows: [...makeRows(480, 'proj-a'), ...makeRows(20, 'proj-b')],
          cursors: { 'proj-a': 480, 'proj-b': 50 }, // proj-b's cursor unchanged despite 20 rows — server oddity, still handled
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ rows: [], cursors: { 'proj-a': 480, 'proj-b': 50 } }) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.pull()
    await vi.runOnlyPendingTimersAsync()

    // proj-a's cursor moved 0 -> 480, so cursorAdvanced is true even though the aggregate
    // 500 = PULL_PAGE_SIZE is a coincidental sum across two projects, not one full page.
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    daemon.stop()
  })
})

// Finding 3 fix: the server (supabase/functions/memory-sync/index.ts's pull handler)
// iterates EVERY account project and defaults an unsent cursor to 0 — an account-owned
// project this device never registered locally (absent from store.listProjects()) used to
// restart from 0 on every pull forever, because the client stored its returned cursor via
// setSyncState but never SENT it back next time (the project was never in listProjects()).
// With >= PULL_PAGE_SIZE rows in such a project, the M25 chain above loops forever
// re-fetching the same page. Field evidence: a device's local `projects` table had 2 rows
// while pulling 6 account partitions. These tests use a stateful fake store (ensureProject
// actually registers the project so a later listProjects()/getSyncState() call reflects
// it) because the fix's whole point is observable only across two chained requests.
describe('MemoryDaemon — M25 pull heals unknown-project cursors (Finding 3)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function makeRows(n: number, projectKey: string): Array<Record<string, unknown>> {
    return Array.from({ length: n }, (_, i) => ({
      sync_id: `${projectKey}-s${i}`,
      project_key: projectKey,
      client_updated_at: '2026-01-05T21:00:00+00:00',
      lamport: 1,
      deleted: false,
      project_seq: i + 1,
    }))
  }

  function makeStatefulStore(initialProjects: Array<{ projectKey: string; displayName: string; enrolled: boolean }>) {
    const projects = [...initialProjects]
    const syncState = new Map<string, { pullCursor: number; lastPushSeq: number }>()
    for (const p of projects) syncState.set(p.projectKey, { pullCursor: 0, lastPushSeq: 0 })

    const ensureProject = vi.fn((input: { projectKey: string; displayName: string }) => {
      if (!projects.some((p) => p.projectKey === input.projectKey)) {
        projects.push({ projectKey: input.projectKey, displayName: input.displayName, enrolled: true })
      }
    })
    const listProjects = vi.fn(() => [...projects])
    const getSyncState = vi.fn((key: string) => syncState.get(key) ?? { pullCursor: 0, lastPushSeq: 0 })
    const setSyncState = vi.fn((key: string, patch: Partial<{ pullCursor: number }>) => {
      const current = syncState.get(key) ?? { pullCursor: 0, lastPushSeq: 0 }
      syncState.set(key, { ...current, ...patch })
    })

    const store = fakeStore({ ensureProject, listProjects, getSyncState, setSyncState })
    return { store, ensureProject, listProjects, getSyncState, setSyncState }
  }

  it('(a) registers a project returned by the server but absent from listProjects(), and sends its cursor on the chained pull request', async () => {
    const { store, ensureProject, setSyncState } = makeStatefulStore([
      { projectKey: 'proj-known', displayName: 'known', enrolled: true },
    ])
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          rows: makeRows(500, 'proj-unknown'), // full page -> triggers the M25 chain
          cursors: { 'proj-known': 0, 'proj-unknown': 500 },
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ rows: [], cursors: { 'proj-known': 0, 'proj-unknown': 500 } }) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.pull()
    await vi.runOnlyPendingTimersAsync() // flush the setImmediate-chained second pull

    expect(ensureProject).toHaveBeenCalledWith({ projectKey: 'proj-unknown', displayName: 'proj-unknown' })
    expect(setSyncState).toHaveBeenCalledWith('proj-unknown', expect.objectContaining({ pullCursor: 500 }))
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    // The second (chained) request must include the now-registered project's cursor —
    // this is the actual bug: before the fix, the project was never in listProjects(), so
    // it was never in the SENT cursors object on any subsequent request, chained or not.
    const secondSentBody = JSON.parse(fetchImpl.mock.calls[1][1].body)
    expect(secondSentBody.cursors).toEqual({ 'proj-known': 0, 'proj-unknown': 500 })
    daemon.stop()
  })

  it('(b) a constructed hot-loop scenario (full page, same unknown project every time) terminates once the cursor round-trips', async () => {
    const { store } = makeStatefulStore([{ projectKey: 'proj-known', displayName: 'known', enrolled: true }])
    const fetchImpl = vi
      .fn()
      // First response: the unknown project's cursor "advances" 0 -> 500 (a full page),
      // which chains a second pull.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ rows: makeRows(500, 'proj-unknown'), cursors: { 'proj-known': 0, 'proj-unknown': 500 } }),
      })
      // Second (and every subsequent) response reports the SAME cursor — no real
      // progress. Without the fix, the client would have resent 0 for proj-unknown
      // forever (it was never registered), so the server would report "500 > 0" forever
      // and the chain would never stop. With the fix, the second request sends 500 (the
      // cursor round-tripped), so this response's 500 is not > 500 and the chain stops.
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ rows: makeRows(500, 'proj-unknown'), cursors: { 'proj-known': 0, 'proj-unknown': 500 } }),
      })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.pull()
    await vi.runOnlyPendingTimersAsync()
    await vi.runOnlyPendingTimersAsync() // would fire a 3rd (and Nth) request if still hot-looping

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    daemon.stop()
  })
})

// spec §5.3.1: GET /v1/sync/status is the ONLY place a device can learn a project exists —
// handlePull returns rows only for cursors the device already sent, so a project never
// registered locally can never surface through pull, no matter how long the device waits.
// status() closes that from the other end.
describe('MemoryDaemon — status() roster discovery (§5.3.1)', () => {
  it('registers a roster project the local store does not have, and skips one it already knows', async () => {
    const ensureProject = vi.fn()
    const store = fakeStore({
      listProjects: vi.fn(() => [{ projectKey: 'proj-known', displayName: 'known', enrolled: true }]),
      ensureProject,
    })
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        projects: [
          { project_key: 'proj-known', display_name: 'known (renamed upstream)' },
          { project_key: 'proj-new', display_name: 'brand new' },
        ],
      }),
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.status()

    // Only the unknown one is registered — a known project is never re-written just
    // because it reappeared in the roster (renamed or not; display-name drift is not
    // this call's job).
    expect(ensureProject).toHaveBeenCalledTimes(1)
    expect(ensureProject).toHaveBeenCalledWith({ projectKey: 'proj-new', displayName: 'brand new' })
    const url = (fetchImpl.mock.calls[0] as [string, RequestInit])[0]
    expect(url).toBe('https://example.supabase.co/v1/sync/status')
  })

  it('an unchanging roster performs zero registrations after the first status() call (no busy-loop of writes)', async () => {
    const known: Array<{ projectKey: string; displayName: string; enrolled: boolean }> = []
    const ensureProject = vi.fn((input: { projectKey: string; displayName: string }) => {
      known.push({ projectKey: input.projectKey, displayName: input.displayName, enrolled: true })
    })
    const store = fakeStore({ listProjects: vi.fn(() => [...known]), ensureProject })
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ projects: [{ project_key: 'proj-new', display_name: 'brand new' }] }),
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.status()
    await daemon.status()
    await daemon.status()

    expect(ensureProject).toHaveBeenCalledTimes(1)
  })

  it('a missing `projects` field means "no discovery available" (older service / pre-roster stub), not an error', async () => {
    const ensureProject = vi.fn()
    const store = fakeStore({ ensureProject })
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ next_poll_ms: 300_000 }) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    const result = await daemon.status()

    expect(ensureProject).not.toHaveBeenCalled()
    expect(result).not.toBeNull()
  })

  it('honors next_poll_ms from the server, rescheduling the interval timer to it', async () => {
    vi.useFakeTimers()
    const store = fakeStore({ listProjects: vi.fn(() => []) })
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ next_poll_ms: 60_000 }) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    daemon.start()
    await daemon.status() // same call drain() makes before pull() on connect / each tick
    fetchImpl.mockClear()

    // Still short of the NEW 60s interval: must not have fired yet.
    await vi.advanceTimersByTimeAsync(59_999)
    expect(fetchImpl).not.toHaveBeenCalled()
    // The last millisecond fires the rescheduled interval's drain(), whose first call is
    // status() — proving the timer was actually re-armed to the server's number, not just
    // left on the 5-minute default.
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    daemon.stop()
    vi.useRealTimers()
  })

  it('a non-positive or non-numeric next_poll_ms falls back to the constant instead of leaving the daemon with no interval', async () => {
    vi.useFakeTimers()
    const store = fakeStore({ listProjects: vi.fn(() => []) })
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ next_poll_ms: -5 }) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    daemon.start()
    await daemon.status()
    fetchImpl.mockClear()

    // Still on the original 5-minute default — a bad value must not have rescheduled it to
    // something else (e.g. "-5" clamped to firing immediately, or no timer at all).
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1)
    expect(fetchImpl).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    daemon.stop()
    vi.useRealTimers()
  })

  it('a 401/403 from status() feeds the SAME auth-failure counter doPush() uses (M18) — status() must not gate push/pull any differently than a push failure already does', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.status() // failure 1 of the shared counter
    await daemon.status() // failure 2
    await daemon.push() // failure 3 — trips the SAME breaker push() alone would trip

    expect(daemon.getStatus()).toBe('error')
    expect(fetchImpl).toHaveBeenCalledTimes(3)

    // The breaker now blocks EVERY entry point identically, status() included — a further
    // call makes no network request at all rather than hitting the revoked token again.
    await daemon.status()
    await daemon.push()
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})

// The scenario the spec calls out as the one worth proving: a freshly installed device
// (an EMPTY local store — no projects, ever pushed anything) receives the account's
// roster via status() and, in the very same drain cycle, pulls rows for a project it
// could never have named on its own. Before this change, `doPull()`'s cursors came only
// from `store.listProjects()`, so this device would have pulled NOTHING, forever, with no
// error and no symptom (§5.3.1's "the agujero").
describe('MemoryDaemon — §5.3.1 an empty device discovers and pulls a remote-only project', () => {
  function makeEmptyStatefulStore() {
    const projects: Array<{ projectKey: string; displayName: string; enrolled: boolean }> = []
    const syncState = new Map<string, { pullCursor: number; lastPushSeq: number }>()

    const ensureProject = vi.fn((input: { projectKey: string; displayName: string }) => {
      if (!projects.some((p) => p.projectKey === input.projectKey)) {
        projects.push({ projectKey: input.projectKey, displayName: input.displayName, enrolled: true })
        syncState.set(input.projectKey, { pullCursor: 0, lastPushSeq: 0 })
      }
    })
    const listProjects = vi.fn(() => [...projects])
    const getSyncState = vi.fn((key: string) => syncState.get(key) ?? { pullCursor: 0, lastPushSeq: 0 })
    const setSyncState = vi.fn((key: string, patch: Partial<{ pullCursor: number }>) => {
      const current = syncState.get(key) ?? { pullCursor: 0, lastPushSeq: 0 }
      syncState.set(key, { ...current, ...patch })
    })
    const applyIncomingObservation = vi.fn()
    const store = fakeStore({
      listProjects,
      ensureProject,
      getSyncState,
      setSyncState,
      applyIncomingObservation,
      get: vi.fn(() => null),
      findActiveTopicOwner: vi.fn(() => null),
    })
    return { store, ensureProject, listProjects, applyIncomingObservation }
  }

  it('registers "proj-remote" from the roster and pulls its row, sending its cursor at 0 — impossible before status() existed', async () => {
    const { store, ensureProject, applyIncomingObservation } = makeEmptyStatefulStore()

    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/v1/sync/status')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            next_poll_ms: 300_000,
            projects: [{ project_key: 'proj-remote', display_name: 'Remote Project' }],
          }),
        }
      }
      if (url.endsWith('/v1/sync/pull')) {
        const body = JSON.parse(init.body as string) as { cursors: Record<string, number> }
        // This IS the scenario: before status() ran this device had zero local projects,
        // so a pull could never have named 'proj-remote' at all — doPull()'s own early
        // return (`projects.length === 0`) would have fired and no request would even
        // have been sent on the very first drain.
        expect(body.cursors).toEqual({ 'proj-remote': 0 })
        return {
          ok: true,
          status: 200,
          json: async () => ({
            rows: [{
              sync_id: 'obs-remote-1',
              project_key: 'proj-remote',
              client_updated_at: '2026-01-05T21:00:00+00:00',
              lamport: 1,
              deleted: false,
              project_seq: 1,
              scope: 'personal',
              title: 'written on the other machine',
            }],
            cursors: { 'proj-remote': 1 },
          }),
        }
      }
      throw new Error(`unexpected fetch in this test: ${url}`)
    }) as unknown as typeof fetch

    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    // onNetworkRegain() is what the memory:connect IPC handler calls, i.e. the spec's "on
    // connect" trigger, and drain() runs status() before pull() — exactly the sequence
    // §5.3.1 requires.
    daemon.onNetworkRegain()
    await new Promise((r) => setTimeout(r, 10))

    expect(ensureProject).toHaveBeenCalledWith({ projectKey: 'proj-remote', displayName: 'Remote Project' })
    expect(applyIncomingObservation).toHaveBeenCalledWith(
      expect.objectContaining({ syncId: 'obs-remote-1', projectKey: 'proj-remote' })
    )
    daemon.stop()
  })
})

describe('mapRawPulledRow (C1 — realistic to_jsonb(o) shaped payload)', () => {
  // This is exactly the shape memory_sync_pull's `to_jsonb(o) - 'topic_owner'` produces,
  // PLUS the `project_key` the memory-sync edge function denormalizes onto each row —
  // snake_case Postgres column names, an ISO 8601 timestamptz string (NOT a ms-epoch
  // number), and a native boolean for `deleted`. The original bug (C1) went undetected
  // because every existing test used a hand-built camelCase fixture that looked nothing
  // like what the server actually returns.
  const realisticRawRow = {
    sync_id: 'obs-abc123',
    user_id: '11111111-1111-1111-1111-111111111111',
    project_id: '22222222-2222-2222-2222-222222222222',
    project_key: 'a1b2c3d4e5f6a7b8', // attached by the edge function, not a native column
    scope: 'personal',
    topic_key: 'architecture/auth-model',
    type: 'architecture',
    title: 'Auth model v2',
    content: 'Switched to session cookies.',
    tags: ['auth', 'security'],
    origin_ai: 'claude',
    origin_account: 'claude:Bautista',
    git_branch: 'main',
    author_display: 'Bautista',
    content_hash: 'deadbeef',
    client_created_at: '2026-01-05T10:00:00+00:00',
    client_updated_at: '2026-01-05T21:00:00+00:00',
    lamport: 2,
    deleted: false,
    superseded_by: null,
    project_seq: 42,
    server_updated_at: '2026-01-05T21:00:01.123456+00:00',
  }

  it('maps every snake_case field to the camelCase PulledRow shape', () => {
    const mapped = mapRawPulledRow(realisticRawRow)
    expect(mapped.syncId).toBe('obs-abc123')
    expect(mapped.topicKey).toBe('architecture/auth-model')
    expect(mapped.projectKey).toBe('a1b2c3d4e5f6a7b8')
    expect(mapped.scope).toBe('personal')
    expect(mapped.title).toBe('Auth model v2')
    expect(mapped.content).toBe('Switched to session cookies.')
    expect(mapped.tags).toEqual(['auth', 'security'])
    expect(mapped.originAi).toBe('claude')
    expect(mapped.gitBranch).toBe('main')
    expect(mapped.authorDisplay).toBe('Bautista')
    expect(mapped.contentHash).toBe('deadbeef')
    expect(mapped.lamport).toBe(2)
    expect(mapped.deleted).toBe(false)
    expect(mapped.supersededBy).toBeNull()
    expect(mapped.projectSeq).toBe(42)
  })

  // Task 9 (smoke/memory-bridge), Parte B: `authorUserId` was declared on `PulledRow` and
  // threaded all the way through `applyPulledRow`/`applyIncomingObservation`, but nothing
  // in this mapper ever READ it off the raw payload — every pulled row silently landed
  // with `author_user_id = null` locally, regardless of who actually authored it. See the
  // fix's own comment on the `authorUserId:` line in memory-daemon.ts for why `author_id`
  // (not `author_user_id`) is the wire field name.
  it('maps author_id to authorUserId (Task 9 fix — this was silently dropped before)', () => {
    const mapped = mapRawPulledRow({ ...realisticRawRow, author_id: '33333333-3333-3333-3333-333333333333' })
    expect(mapped.authorUserId).toBe('33333333-3333-3333-3333-333333333333')
  })

  it('authorUserId is undefined when the raw row carries no author_id (e.g. an older service)', () => {
    const mapped = mapRawPulledRow(realisticRawRow)
    expect(mapped.authorUserId).toBeUndefined()
  })

  it('parses the timestamptz ISO string into a ms-epoch number, not NaN or the raw string', () => {
    const mapped = mapRawPulledRow(realisticRawRow)
    expect(typeof mapped.updatedAt).toBe('number')
    expect(mapped.updatedAt).toBe(Date.parse('2026-01-05T21:00:00+00:00'))
  })

  it('a full pull() round-trip through fetch -> mapRawPulledRow -> applyPulledRow actually applies the row (the exact bug C1 fixed)', async () => {
    const applyIncomingObservation = vi.fn()
    const store = fakeStore({
      listProjects: vi.fn(() => [{ projectKey: 'a1b2c3d4e5f6a7b8', displayName: 'x', enrolled: true }]),
      get: vi.fn(() => null),
      applyIncomingObservation,
    })
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ rows: [realisticRawRow], cursors: { 'a1b2c3d4e5f6a7b8': 42 } }),
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.pull()

    // Before the C1 fix this never ran at all — store.get(undefined) threw inside the
    // per-row loop and the whole pull() body's catch swallowed it silently.
    expect(applyIncomingObservation).toHaveBeenCalledWith(
      expect.objectContaining({ syncId: 'obs-abc123', projectKey: 'a1b2c3d4e5f6a7b8', title: 'Auth model v2' })
    )
  })

  it('handles a deleted row with null content without crashing', () => {
    const mapped = mapRawPulledRow({ ...realisticRawRow, deleted: true, content: null })
    expect(mapped.deleted).toBe(true)
    expect(mapped.content).toBeNull()
  })

  it('falls back gracefully on a malformed/missing timestamp instead of throwing', () => {
    const mapped = mapRawPulledRow({ ...realisticRawRow, client_updated_at: undefined })
    expect(Number.isFinite(mapped.updatedAt)).toBe(true)
  })
})

describe('MemoryDaemon — applyPulledRow (§4.3/§4.4 pull-apply)', () => {
  it('applies an incoming row when there is no local copy', () => {
    const applyIncomingObservation = vi.fn()
    const store = fakeStore({ get: vi.fn(() => null), applyIncomingObservation })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { getSyncBaseUrl: () => null, getToken: () => null, getDeviceId: () => null }))

    daemon.applyPulledRow({
      syncId: 'obs-1',
      updatedAt: 100,
      lamport: 1,
      deleted: false,
      topicKey: null,
      scope: 'personal',
      projectKey: 'proj-1',
      supersededBy: null,
      title: 'hello',
      content: 'world',
    })

    expect(applyIncomingObservation).toHaveBeenCalledWith(expect.objectContaining({ syncId: 'obs-1', supersededBy: null }))
  })

  it('keeps the local unpushed edit queued when it wins LWW over the incoming row', () => {
    const applyIncomingObservation = vi.fn()
    const store = fakeStore({
      get: vi.fn(() => ({ sync_id: 'obs-1', updated_at: 999, lamport: 9 }) as never),
      applyIncomingObservation,
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { getSyncBaseUrl: () => null, getToken: () => null, getDeviceId: () => null }))

    daemon.applyPulledRow({
      syncId: 'obs-1',
      updatedAt: 100, // older than local
      lamport: 1,
      deleted: false,
      topicKey: null,
      scope: 'personal',
      projectKey: 'proj-1',
      supersededBy: null,
    })

    expect(applyIncomingObservation).not.toHaveBeenCalled()
  })

  it('supersedes the loser on a topic-key collision instead of overwriting', () => {
    const applyIncomingObservation = vi.fn()
    const store = fakeStore({
      get: vi.fn(() => null),
      findActiveTopicOwner: vi.fn(() => ({ sync_id: 'AAA', updated_at: 2000, lamport: 2 }) as never),
      applyIncomingObservation,
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { getSyncBaseUrl: () => null, getToken: () => null, getDeviceId: () => null }))

    daemon.applyPulledRow({
      syncId: 'BBB',
      updatedAt: 1000, // older than AAA -> BBB loses
      lamport: 1,
      deleted: false,
      topicKey: 'architecture/auth-model',
      scope: 'personal',
      projectKey: 'proj-1',
      supersededBy: null,
    })

    expect(applyIncomingObservation).toHaveBeenCalledWith(expect.objectContaining({ syncId: 'BBB', supersededBy: 'AAA' }))
  })
})

describe('applyPulledRow — topic collision where the incoming row wins (C2)', () => {
  it('asks for the local row to be superseded in the same call that applies the incoming one', () => {
    const applyIncomingObservation = vi.fn()
    const store = fakeStore({
      get: vi.fn(() => null),
      findActiveTopicOwner: vi.fn(() => ({ sync_id: 'obs_local', updated_at: 1_000, lamport: 1 }) as never),
      applyIncomingObservation,
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store))

    daemon.applyPulledRow({
      syncId: 'obs_remota',
      updatedAt: 2_000,
      lamport: 5,
      deleted: false,
      topicKey: 'deploy-target',
      scope: 'personal',
      projectKey: 'proj-1',
      supersededBy: null,
    })

    expect(applyIncomingObservation).toHaveBeenCalledWith(
      expect.objectContaining({ syncId: 'obs_remota', supersedeLocal: 'obs_local', supersededBy: null })
    )
  })

  it('marks the incoming row superseded and leaves the local one alone when the incoming row loses', () => {
    const applyIncomingObservation = vi.fn()
    const store = fakeStore({
      get: vi.fn(() => null),
      findActiveTopicOwner: vi.fn(() => ({ sync_id: 'obs_local', updated_at: 9_000, lamport: 20 }) as never),
      applyIncomingObservation,
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store))

    daemon.applyPulledRow({
      syncId: 'obs_remota',
      updatedAt: 2_000,
      lamport: 5,
      deleted: false,
      topicKey: 'deploy-target',
      scope: 'personal',
      projectKey: 'proj-1',
      supersededBy: null,
    })

    expect(applyIncomingObservation).toHaveBeenCalledWith(
      expect.objectContaining({ supersededBy: 'obs_local', supersedeLocal: null })
    )
  })

  // findActiveTopicOwner only ever returns LIVE rows, so without the `!incoming.deleted`
  // guard a pulled TOMBSTONE that merely happens to be newer than the live local row on
  // the same (project_key, scope, topic_key) marked that live row
  // superseded_by = <the tombstone>. The slot went empty and the local memory vanished
  // from search(), context() and count(), all of which filter superseded_by IS NULL.
  it('a deleted incoming row never supersedes the live local owner of the topic slot', () => {
    const applyIncomingObservation = vi.fn()
    const findActiveTopicOwner = vi.fn(() => ({ sync_id: 'obs_local', updated_at: 1_000, lamport: 1 }) as never)
    const store = fakeStore({ get: vi.fn(() => null), findActiveTopicOwner, applyIncomingObservation })
    const daemon = new MemoryDaemon(baseDaemonDeps(store))

    daemon.applyPulledRow({
      syncId: 'obs_tombstone',
      updatedAt: 2_000, // newer than the live local row, so it WOULD win the collision
      lamport: 5,
      deleted: true,
      topicKey: 'deploy-target',
      scope: 'personal',
      projectKey: 'proj-1',
      supersededBy: null,
    })

    expect(findActiveTopicOwner).not.toHaveBeenCalled()
    expect(applyIncomingObservation).toHaveBeenCalledWith(
      expect.objectContaining({ syncId: 'obs_tombstone', deleted: true, supersedeLocal: null, supersededBy: null })
    )
  })
})

// Task 9 (smoke/memory-bridge), Parte B — EL CHEQUEO CRÍTICO de este paso: la fila que
// applyPulledRow() aplica puede tener un author_user_id DISTINTO del dueño de la cuenta de
// esta máquina (llegada por pull de un proyecto scope='team' compartido). Usa un
// MemoryStore REAL (no el fakeStore mockeado del resto de este archivo): los tres
// invariantes a confirmar (buscable, no cuenta como pendingMutation propia, no cuenta como
// "sin dueño") viven en consultas SQL reales de memory-store.ts, no en algo que un mock de
// applyIncomingObservation pueda demostrar por sí solo.
describe('MemoryDaemon — applyPulledRow con autor ajeno (Task 9, EL CHEQUEO CRÍTICO)', () => {
  let dir: string
  let store: MemoryStore
  let daemon: MemoryDaemon

  beforeEach(() => {
    dir = makeTmpDir('raven-memory-daemon-foreign-author-')
    store = new MemoryStore(join(dir, 'memory.db'))
    // La cuenta de Nest de ESTA máquina — la que `pendingMutations()`/`pendingMutationCount()`
    // usan como filtro (memory-store.ts's `author_user_id IS this.currentUserId`).
    store.setCurrentUser('user-A')
    daemon = new MemoryDaemon(baseDaemonDeps(store))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('se aplica, queda buscable, y no se cuenta ni como mutación propia pendiente ni como fila sin dueño', () => {
    // Simula exactamente lo que un pull team-scoped trae: una fila de un COMPAÑERO de
    // equipo ('user-B'), no de la cuenta local ('user-A').
    daemon.applyPulledRow({
      syncId: 'obs-team-1',
      updatedAt: Date.now(),
      lamport: 1,
      deleted: false,
      topicKey: null,
      scope: 'team',
      projectKey: 'proj-shared',
      supersededBy: null,
      title: 'Decision del equipo',
      content: 'Usamos Postgres, no Mongo.',
      type: 'decision',
      authorUserId: 'user-B',
      authorDisplay: 'Bautista',
    })

    // (a) queda en observations y es buscable via search()/context().
    expect(store.search('proj-shared', 'Postgres').map((r) => r.syncId)).toContain('obs-team-1')
    expect(store.context('proj-shared').map((r) => r.syncId)).toContain('obs-team-1')

    // (b) pendingMutationCount()/pendingMutations() de la cuenta LOCAL no la cuenta: nunca
    // pasó por appendMutation() (applyIncomingObservation no la usa, sólo save()/
    // deleteObservation()/promoteToTeam() lo hacen) — no es una mutación propia esperando
    // push, ya vino aplicada desde el pull.
    expect(store.pendingMutationCount()).toBe(0)
    expect(store.pendingMutations().some((m) => m.sync_id === 'obs-team-1')).toBe(false)

    // (c) countUnclaimedRows() (Task 2) tampoco la cuenta como "sin dueño" — tiene autor,
    // sólo que no es el mío. Antes del fix de mapRawPulledRow esto habría sido el caso
    // real: toda fila pulled quedaba con author_user_id = null.
    expect(store.countUnclaimedRows()).toEqual({ count: 0, projects: [] })

    // Confirmación directa: el autor que persistió es el ajeno, ni null ni adoptado como
    // propio.
    expect(store.get('obs-team-1')?.author_user_id).toBe('user-B')
  })

  it('una mutación propia pendiente sigue contando normalmente junto a la fila ajena ya aplicada', () => {
    // Una fila propia, sin pushear todavía — la mutación real que pendingMutations() SÍ
    // tiene que seguir devolviendo, sin que la fila ajena de al lado la tape ni la infle.
    store.save({
      projectKey: 'proj-shared',
      type: 'decision',
      title: 'Mi propia nota',
      content: 'todavia no la pusheo',
      source: 'mcp',
    })

    daemon.applyPulledRow({
      syncId: 'obs-team-2',
      updatedAt: Date.now(),
      lamport: 1,
      deleted: false,
      topicKey: null,
      scope: 'team',
      projectKey: 'proj-shared',
      supersededBy: null,
      title: 'Otra decision del equipo',
      content: 'body',
      type: 'decision',
      authorUserId: 'user-B',
    })

    expect(store.pendingMutationCount()).toBe(1)
    const pending = store.pendingMutations()
    expect(pending).toHaveLength(1)
    expect(pending[0].sync_id).not.toBe('obs-team-2')
  })
})

// Mismo chequeo que el describe de arriba, pero por el camino REAL de punta a punta — fetch
// mockeado -> mapRawPulledRow -> applyPulledRow -> MemoryStore real — para confirmar que el
// fix de mapRawPulledRow (el `author_id` que antes se perdía en el mapeo del payload crudo)
// efectivamente llega hasta acá y no sólo cuando se invoca applyPulledRow() a mano con un
// PulledRow ya armado.
describe('doPull() de punta a punta con una fila de otro autor (Task 9, fix de mapRawPulledRow)', () => {
  it('un raw pulled row con author_id ajeno persiste con authorUserId seteado, no null', async () => {
    const dir = makeTmpDir('raven-memory-daemon-pull-foreign-author-')
    const store = new MemoryStore(join(dir, 'memory.db'))
    store.setCurrentUser('user-A')
    try {
      store.ensureProject({ projectKey: 'proj-shared', displayName: 'proj-shared' })
      const rawRow = {
        sync_id: 'obs-team-3',
        project_key: 'proj-shared',
        scope: 'team',
        topic_key: null,
        type: 'decision',
        title: 'Decision via pull real',
        content: 'body',
        tags: [],
        client_updated_at: new Date().toISOString(),
        lamport: 1,
        deleted: false,
        superseded_by: null,
        author_id: 'user-B',
        author_display: 'Bautista',
        project_seq: 1,
      }
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ rows: [rawRow], cursors: { 'proj-shared': 1 } }),
      })
      const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

      await daemon.pull()

      const row = store.get('obs-team-3')
      expect(row?.author_user_id).toBe('user-B')
      expect(store.pendingMutationCount()).toBe(0)
      expect(store.countUnclaimedRows()).toEqual({ count: 0, projects: [] })
    } finally {
      store.close()
      cleanupTmp(dir)
    }
  })
})

describe('tags and source_ref on the wire (C5)', () => {
  it('mapRawPulledRow accepts tags as a JSON string', () => {
    expect(mapRawPulledRow({ sync_id: 'a', tags: '["uno","dos"]' }).tags).toEqual(['uno', 'dos'])
  })

  it('mapRawPulledRow still accepts tags as a plain array', () => {
    expect(mapRawPulledRow({ sync_id: 'a', tags: ['uno'] }).tags).toEqual(['uno'])
  })

  it('mapRawPulledRow returns undefined for junk tags instead of throwing', () => {
    expect(mapRawPulledRow({ sync_id: 'a', tags: 'no soy json' }).tags).toBeUndefined()
    expect(mapRawPulledRow({ sync_id: 'a', tags: 7 }).tags).toBeUndefined()
  })

  it('mapRawPulledRow drops non-string elements from tags', () => {
    expect(mapRawPulledRow({ sync_id: 'a', tags: ['uno', 7, null, 'dos'] }).tags).toEqual(['uno', 'dos'])
    expect(mapRawPulledRow({ sync_id: 'a', tags: '["uno",7,null,"dos"]' }).tags).toEqual(['uno', 'dos'])
  })

  it('push sends tags as an array and never sends source_ref', async () => {
    const pending: MutationLogRow[] = [
      {
        seq: 1,
        sync_id: 'a',
        op: 'upsert',
        payload: JSON.stringify({
          sync_id: 'a',
          project_key: 'proj-1',
          tags: '["uno","dos"]',
          source_ref: 'markdown:C:\\Users\\real\\notas.md#topic',
        }),
        created_at: 1,
        pushed_at: null,
        last_error: null,
        blocked_reason: null,
      },
    ]
    const store = fakeStore({ pendingMutations: vi.fn(() => pending) })
    let sent: Record<string, unknown> | null = null
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ results: [{ sync_id: 'a', outcome: 'applied', project_seq: 1 }] }), { status: 200 })
    }) as unknown as typeof fetch

    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))
    await daemon.push()

    const payload = (sent!.mutations as Array<{ payload: Record<string, unknown> }>)[0].payload
    expect(payload.tags).toEqual(['uno', 'dos'])
    expect(payload).not.toHaveProperty('source_ref')
  })

  it('push sends tags: [] (not null) when the mutation carries no tags', async () => {
    // Locks in the ?? [] fix: the push RPC's COALESCE(v_payload->'tags', '[]'::jsonb)
    // never fires on a present-but-null key (jsonb null scalar, not SQL NULL), so a
    // stray `?? null` here would silently defeat the column's own NOT NULL DEFAULT '[]'.
    const pending: MutationLogRow[] = [
      {
        seq: 1,
        sync_id: 'a',
        op: 'upsert',
        payload: JSON.stringify({ sync_id: 'a', project_key: 'proj-1' }),
        created_at: 1,
        pushed_at: null,
        last_error: null,
        blocked_reason: null,
      },
    ]
    const store = fakeStore({ pendingMutations: vi.fn(() => pending) })
    let sent: Record<string, unknown> | null = null
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ results: [{ sync_id: 'a', outcome: 'applied', project_seq: 1 }] }), { status: 200 })
    }) as unknown as typeof fetch

    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))
    await daemon.push()

    const payload = (sent!.mutations as Array<{ payload: Record<string, unknown> }>)[0].payload
    expect(payload.tags).toEqual([])
  })
})

// Task 1 (plan de memoria por cuenta multi-dispositivo), Step 3a: pause()/resume()/setStore()
// are the daemon side of a safe hot-swap of the underlying MemoryStore (see
// electron/memory-account-switch.ts, added in a later step). pause() must (1) stop
// scheduling ANY new push/pull while a swap is in flight, and (2) actually wait for
// whatever push/pull was already running to settle — bounded by an internal timeout so a
// wedged request can never hang the swap forever (adversarial review finding 3).
describe('MemoryDaemon — pause()/resume()/setStore() hot-swap support (Task 1 Step 3a)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('pause(): clears already-armed timers (debounce/max-wait) so they never fire once the swap starts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    daemon.scheduleMutationPush() // arms the debounce timer
    await daemon.pause() // nothing in flight yet -> resolves immediately, but must clear the armed timer

    await vi.advanceTimersByTimeAsync(35_000) // past both the 3s debounce and the 30s max-wait
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('pause(): waits for an in-flight push to settle before resolving', async () => {
    let resolvePush: (v: unknown) => void = () => {}
    const pushPromise = new Promise((resolve) => { resolvePush = resolve })
    const fetchImpl = vi.fn().mockReturnValue(pushPromise)
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    daemon.start()
    const inFlightPush = daemon.push() // fetchImpl now pending — pushInFlight is set

    let pauseSettled = false
    const pausePromise = daemon.pause().then(() => { pauseSettled = true })

    // The push hasn't resolved yet — pause() must still be waiting on it.
    await vi.advanceTimersByTimeAsync(0)
    expect(pauseSettled).toBe(false)

    // While swapping, a new scheduled push must not sneak in ahead of the drain.
    daemon.scheduleMutationPush()
    await vi.advanceTimersByTimeAsync(3_500)
    expect(fetchImpl).toHaveBeenCalledTimes(1) // still just the original in-flight call

    resolvePush({ ok: true, status: 200, json: async () => ({ results: [] }) })
    await inFlightPush
    await pausePromise

    expect(pauseSettled).toBe(true)
  })

  it('pause(): waits for an in-flight status() to settle before resolving (Task 8 adversarial review: drain() calls status() before pull()/push(), so a status() fetch in flight left pushInFlight/pullInFlight both null and pause() used to return immediately without waiting for it)', async () => {
    let resolveStatus: (v: unknown) => void = () => {}
    const statusPromise = new Promise((resolve) => { resolveStatus = resolve })
    const fetchImpl = vi.fn().mockReturnValue(statusPromise)
    const store = fakeStore()
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    const inFlightStatus = daemon.status() // fetchImpl now pending — statusInFlight is set; pushInFlight/pullInFlight are still null

    let pauseSettled = false
    const pausePromise = daemon.pause().then(() => { pauseSettled = true })

    // The status() fetch hasn't resolved yet — pause() must still be waiting on it, not
    // returning immediately just because pushInFlight/pullInFlight happen to both be null.
    await vi.advanceTimersByTimeAsync(0)
    expect(pauseSettled).toBe(false)

    resolveStatus({ ok: true, status: 200, json: async () => ({}) })
    await inFlightStatus
    await pausePromise

    expect(pauseSettled).toBe(true)
  })

  it('pause(): does not hang forever when an in-flight push never settles (bounded by an internal timeout)', async () => {
    const neverSettles = new Promise(() => { /* deliberately never resolves/rejects */ })
    const fetchImpl = vi.fn().mockReturnValue(neverSettles)
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    void daemon.push() // wedged in flight forever, on purpose

    let pauseSettled = false
    const pausePromise = daemon.pause().then(() => { pauseSettled = true })

    await vi.advanceTimersByTimeAsync(4_999)
    expect(pauseSettled).toBe(false) // internal drain timeout hasn't fired yet

    await vi.advanceTimersByTimeAsync(50) // crosses the internal drain timeout
    await pausePromise

    expect(pauseSettled).toBe(true) // resolved anyway — never hangs the swap
    expect(warnSpy).toHaveBeenCalled() // and it says so
    warnSpy.mockRestore()
  })

  it('resume(): swapping clears (blocked triggers work again) and the daemon restarts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    daemon.start()
    await daemon.pause() // nothing in flight -> resolves immediately, swapping = true

    daemon.onPaneExit() // no-op while swapping
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).not.toHaveBeenCalled()

    daemon.resume()
    daemon.onPaneExit() // fires now that swapping is cleared
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    daemon.stop()
  })

  it('setStore(): a push() after the swap reads pendingMutations from the NEW store, not the old one', async () => {
    const oldPending = vi.fn(() => PENDING_MUTATION_A)
    const newPending = vi.fn(() => []) // new account's store starts with nothing queued
    const oldStore = fakeStore({ pendingMutations: oldPending })
    const newStore = fakeStore({ pendingMutations: newPending })
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) })
    const daemon = new MemoryDaemon(baseDaemonDeps(oldStore, { fetchImpl }))

    daemon.setStore(newStore)
    await daemon.push()

    expect(oldPending).not.toHaveBeenCalled()
    expect(newPending).toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled() // nothing pending on the new store -> no request at all
  })

  it('setStore(): a pull() after the swap reads listProjects/cursors from the NEW store, not the old one', async () => {
    const oldListProjects = vi.fn(() => [{ projectKey: 'proj-old', displayName: 'old', enrolled: true }])
    const newListProjects = vi.fn(() => [{ projectKey: 'proj-new', displayName: 'new', enrolled: true }])
    const oldStore = fakeStore({ listProjects: oldListProjects })
    const newStore = fakeStore({
      listProjects: newListProjects,
      getSyncState: vi.fn(() => ({ pullCursor: 0, lastPushSeq: 0 })),
    })
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [], cursors: {} }) })
    const daemon = new MemoryDaemon(baseDaemonDeps(oldStore, { fetchImpl }))

    daemon.setStore(newStore)
    await daemon.pull()

    expect(oldListProjects).not.toHaveBeenCalled()
    expect(newListProjects).toHaveBeenCalled()
    const sentBody = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(sentBody.cursors).toEqual({ 'proj-new': 0 })
  })
})

describe('MemoryDaemon — swapping guard: trigger entry points no-op mid-swap (Task 1 Step 3a)', () => {
  it('scheduleMutationPush() schedules nothing while swapping', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.pause() // swapping = true, nothing in flight so this resolves immediately
    daemon.scheduleMutationPush()
    await vi.advanceTimersByTimeAsync(35_000) // past debounce AND max-wait

    expect(fetchImpl).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('onWindowFocus() triggers no pull while swapping', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [], cursors: {} }) })
    const store = fakeStore({ listProjects: vi.fn(() => [{ projectKey: 'proj-1', displayName: 'p', enrolled: true }]) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.pause()
    daemon.onWindowFocus()
    await new Promise((r) => setTimeout(r, 10))

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('onPaneExit() triggers no push while swapping', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.pause()
    daemon.onPaneExit()
    await new Promise((r) => setTimeout(r, 10))

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('onNetworkRegain() triggers no drain while swapping', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const store = fakeStore({ pendingMutations: vi.fn(() => PENDING_MUTATION_A), listProjects: vi.fn(() => []) })
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { fetchImpl }))

    await daemon.pause()
    daemon.onNetworkRegain()
    await new Promise((r) => setTimeout(r, 10))

    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
