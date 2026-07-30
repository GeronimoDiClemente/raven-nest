import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryDaemon, Backoff } from '../memory-daemon'
import type { MemoryStore, MutationLogRow } from '../memory-store'

const ONE_PENDING_MUTATION: MutationLogRow[] = [{ seq: 1, sync_id: 'a', op: 'upsert', payload: '{}', created_at: 1, pushed_at: null }]

function fakeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  const pending: MutationLogRow[] = []
  return {
    pendingMutations: vi.fn(() => pending),
    markPushed: vi.fn(),
    setSyncState: vi.fn(),
    getSyncState: vi.fn(() => ({ pullCursor: 0, lastPushSeq: 0 })),
    get: vi.fn(() => null),
    findActiveTopicOwner: vi.fn(() => null),
    applyIncomingObservation: vi.fn(),
    ...overrides,
  } as unknown as MemoryStore
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
    const store = fakeStore({ pendingMutations: vi.fn(() => ONE_PENDING_MUTATION) })
    const daemon = new MemoryDaemon({
      store,
      getSupabaseUrl: () => 'https://example.supabase.co',
      getToken: () => 'nmk_test',
      getDeviceId: () => 'device-1',
      isOnline: () => true,
      fetchImpl,
    })

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
    const store = fakeStore({ pendingMutations: vi.fn(() => ONE_PENDING_MUTATION) })
    const daemon = new MemoryDaemon({
      store,
      getSupabaseUrl: () => 'https://example.supabase.co',
      getToken: () => 'nmk_test',
      getDeviceId: () => 'device-1',
      isOnline: () => true,
      fetchImpl,
    })

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
    const store = fakeStore({ pendingMutations: vi.fn(() => ONE_PENDING_MUTATION) })
    const statuses: string[] = []
    const daemon = new MemoryDaemon({
      store,
      getSupabaseUrl: () => 'https://example.supabase.co',
      getToken: () => 'nmk_test',
      getDeviceId: () => 'device-1',
      isOnline: () => false,
      fetchImpl,
      onStatusChange: (s) => statuses.push(s),
    })

    await daemon.push()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(statuses).toContain('paused')
  })

  it('marks mutations pushed and returns to idle on a successful push', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) })
    const markPushed = vi.fn()
    const store = fakeStore({
      pendingMutations: vi.fn(() => ONE_PENDING_MUTATION),
      markPushed,
    })
    const daemon = new MemoryDaemon({
      store,
      getSupabaseUrl: () => 'https://example.supabase.co',
      getToken: () => 'nmk_test',
      getDeviceId: () => 'device-1',
      isOnline: () => true,
      fetchImpl,
    })

    await daemon.push()
    expect(markPushed).toHaveBeenCalledWith([1])
    expect(daemon.getStatus()).toBe('idle')
  })

  it('stops retrying after 3 consecutive auth failures and surfaces an error state', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const store = fakeStore({ pendingMutations: vi.fn(() => ONE_PENDING_MUTATION) })
    const statuses: string[] = []
    const daemon = new MemoryDaemon({
      store,
      getSupabaseUrl: () => 'https://example.supabase.co',
      getToken: () => 'nmk_bad',
      getDeviceId: () => 'device-1',
      isOnline: () => true,
      fetchImpl,
      onStatusChange: (s) => statuses.push(s),
    })

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
})

describe('MemoryDaemon — applyPulledRow (§4.3/§4.4 pull-apply)', () => {
  it('applies an incoming row when there is no local copy', () => {
    const applyIncomingObservation = vi.fn()
    const store = fakeStore({ get: vi.fn(() => null), applyIncomingObservation })
    const daemon = new MemoryDaemon({
      store,
      getSupabaseUrl: () => null,
      getToken: () => null,
      getDeviceId: () => null,
      isOnline: () => true,
    })

    daemon.applyPulledRow({
      syncId: 'obs-1',
      updatedAt: 100,
      lamport: 1,
      deleted: false,
      topicKey: null,
      scope: 'personal',
      projectId: 'proj-1',
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
    const daemon = new MemoryDaemon({ store, getSupabaseUrl: () => null, getToken: () => null, getDeviceId: () => null, isOnline: () => true })

    daemon.applyPulledRow({
      syncId: 'obs-1',
      updatedAt: 100, // older than local
      lamport: 1,
      deleted: false,
      topicKey: null,
      scope: 'personal',
      projectId: 'proj-1',
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
    const daemon = new MemoryDaemon({ store, getSupabaseUrl: () => null, getToken: () => null, getDeviceId: () => null, isOnline: () => true })

    daemon.applyPulledRow({
      syncId: 'BBB',
      updatedAt: 1000, // older than AAA -> BBB loses
      lamport: 1,
      deleted: false,
      topicKey: 'architecture/auth-model',
      scope: 'personal',
      projectId: 'proj-1',
      supersededBy: null,
    })

    expect(applyIncomingObservation).toHaveBeenCalledWith(expect.objectContaining({ syncId: 'BBB', supersededBy: 'AAA' }))
  })
})
