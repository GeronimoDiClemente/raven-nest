import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// metrics-collector imports `electron` at module top (for app.getAppMetrics).
vi.mock('electron', () => ({ app: { getAppMetrics: () => [] } }))

const execSyncMock = vi.hoisted(() => vi.fn())
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, execSync: execSyncMock }
})

import { MetricsCollector } from '../metrics-collector'

type WithWorktreeInfo = { getWorktreeInfo(path: string): unknown }

describe('MetricsCollector.getWorktreeInfo failure cache', () => {
  beforeEach(() => {
    execSyncMock.mockReset()
    execSyncMock.mockImplementation(() => { throw new Error('fatal: not a git repository') })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not re-run git for a non-repo folder on every collect', () => {
    const c = new MetricsCollector() as unknown as WithWorktreeInfo
    expect(c.getWorktreeInfo('/not/a/repo')).toBeNull()
    const callsAfterFirst = execSyncMock.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0)

    for (let i = 0; i < 5; i++) expect(c.getWorktreeInfo('/not/a/repo')).toBeNull()
    expect(execSyncMock.mock.calls.length).toBe(callsAfterFirst)
  })

  it('does not remember a timeout, which is transient', () => {
    execSyncMock.mockImplementation(() => { throw Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' }) })
    const c = new MetricsCollector() as unknown as WithWorktreeInfo
    c.getWorktreeInfo('/big/repo')
    const callsAfterFirst = execSyncMock.mock.calls.length
    c.getWorktreeInfo('/big/repo')
    expect(execSyncMock.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it('retries after the failure expires, so a later `git init` is picked up', () => {
    const c = new MetricsCollector() as unknown as WithWorktreeInfo
    c.getWorktreeInfo('/not/a/repo')
    const callsAfterFirst = execSyncMock.mock.calls.length

    vi.advanceTimersByTime(61_000)
    execSyncMock.mockReset()
    execSyncMock.mockReturnValueOnce('.git\n').mockReturnValueOnce('main\n')

    expect(c.getWorktreeInfo('/not/a/repo')).toMatchObject({ branchLabel: 'main' })
    expect(execSyncMock.mock.calls.length).toBe(2)
    expect(callsAfterFirst).toBeGreaterThan(0)
  })
})
