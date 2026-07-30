import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryDaemon, Backoff, mapRawPulledRow } from '../memory-daemon'
import type { MemoryStore, MutationLogRow } from '../memory-store'

const PENDING_MUTATION_A: MutationLogRow[] = [
  { seq: 1, sync_id: 'a', op: 'upsert', payload: JSON.stringify({ sync_id: 'a', project_key: 'proj-1' }), created_at: 1, pushed_at: null, last_error: null },
]

function fakeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  const pending: MutationLogRow[] = []
  return {
    pendingMutations: vi.fn(() => pending),
    markPushed: vi.fn(),
    setSyncState: vi.fn(),
    getSyncState: vi.fn(() => ({ pullCursor: 0, lastPushSeq: 0 })),
    listProjects: vi.fn(() => [{ projectKey: 'proj-1', displayName: 'proj-1', enrolled: true }]),
    pruneAckedMutations: vi.fn(() => 0),
    pendingMutationCount: vi.fn(() => 0),
    compactMutationLog: vi.fn(() => 0),
    get: vi.fn(() => null),
    findActiveTopicOwner: vi.fn(() => null),
    applyIncomingObservation: vi.fn(),
    ...overrides,
  } as unknown as MemoryStore
}

function baseDaemonDeps(store: MemoryStore, extra: Partial<ConstructorParameters<typeof MemoryDaemon>[0]> = {}) {
  return {
    store,
    getSupabaseUrl: () => 'https://example.supabase.co',
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
  it('drain() prunes acked mutations and compacts the log only past the hard cap', async () => {
    const pruneAckedMutations = vi.fn(() => 0)
    const compactMutationLog = vi.fn(() => 0)
    const store = fakeStore({
      pruneAckedMutations,
      compactMutationLog,
      pendingMutationCount: vi.fn(() => 50_001),
      listProjects: vi.fn(() => []),
    })
    const daemon = new MemoryDaemon(baseDaemonDeps(store))

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
    const daemon = new MemoryDaemon(baseDaemonDeps(store))

    daemon.onNetworkRegain()
    await new Promise((r) => setTimeout(r, 10))

    expect(compactMutationLog).not.toHaveBeenCalled()
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
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { getSupabaseUrl: () => null, getToken: () => null, getDeviceId: () => null }))

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
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { getSupabaseUrl: () => null, getToken: () => null, getDeviceId: () => null }))

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
    const daemon = new MemoryDaemon(baseDaemonDeps(store, { getSupabaseUrl: () => null, getToken: () => null, getDeviceId: () => null }))

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
