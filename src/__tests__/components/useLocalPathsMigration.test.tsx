import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLocalPathsMigration } from '../../hooks/useLocalPathsMigration'

const supabaseMock = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  from: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

const localPathsMock = {
  set: vi.fn(),
  getMigrationFlag: vi.fn(),
  setMigrationFlag: vi.fn(),
}
const pathUtilsMock = { exists: vi.fn() }

function buildFromChain(rows: unknown[], error: unknown = null) {
  const promise = Promise.resolve({ data: rows, error })
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    then: (onFulfilled: unknown) => promise.then(onFulfilled as never),
  }
  return chain
}

describe('useLocalPathsMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as unknown as { window: Window }).window.localPaths = localPathsMock as never
    ;(globalThis as unknown as { window: Window }).window.pathUtils = pathUtilsMock as never
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-A' } } })
  })

  it('skips when flag is already done', async () => {
    localPathsMock.getMigrationFlag.mockResolvedValue('done')
    renderHook(() => useLocalPathsMigration())
    await waitFor(() => expect(localPathsMock.getMigrationFlag).toHaveBeenCalled())
    expect(supabaseMock.from).not.toHaveBeenCalled()
    expect(localPathsMock.set).not.toHaveBeenCalled()
  })

  it('imports rows whose path exists on disk', async () => {
    localPathsMock.getMigrationFlag.mockResolvedValue(null)
    supabaseMock.from
      .mockReturnValueOnce(buildFromChain([{ id: 'repo-1', local_path: '/exists' }]))
      .mockReturnValueOnce(buildFromChain([]))
    pathUtilsMock.exists.mockResolvedValue(true)
    renderHook(() => useLocalPathsMigration())
    await waitFor(() => expect(localPathsMock.setMigrationFlag).toHaveBeenCalled())
    expect(localPathsMock.set).toHaveBeenCalledWith('repo-1', '/exists')
  })

  it('skips rows whose path does not exist', async () => {
    localPathsMock.getMigrationFlag.mockResolvedValue(null)
    supabaseMock.from
      .mockReturnValueOnce(buildFromChain([{ id: 'repo-2', local_path: '/missing' }]))
      .mockReturnValueOnce(buildFromChain([]))
    pathUtilsMock.exists.mockResolvedValue(false)
    renderHook(() => useLocalPathsMigration())
    await waitFor(() => expect(localPathsMock.setMigrationFlag).toHaveBeenCalled())
    expect(localPathsMock.set).not.toHaveBeenCalled()
  })

  it('imports team_repo_local_paths filtered by current user', async () => {
    localPathsMock.getMigrationFlag.mockResolvedValue(null)
    supabaseMock.from
      .mockReturnValueOnce(buildFromChain([]))
      .mockReturnValueOnce(buildFromChain([{ team_repo_id: 'tr-1', local_path: '/team' }]))
    pathUtilsMock.exists.mockResolvedValue(true)
    renderHook(() => useLocalPathsMigration())
    await waitFor(() => expect(localPathsMock.set).toHaveBeenCalledWith('tr-1', '/team'))
  })

  it('does NOT set the flag if a Supabase query throws', async () => {
    localPathsMock.getMigrationFlag.mockResolvedValue(null)
    supabaseMock.from
      .mockReturnValueOnce(buildFromChain([], { message: 'rls denied' }))
      .mockReturnValueOnce(buildFromChain([]))
    renderHook(() => useLocalPathsMigration())
    // Wait until both supabase queries have actually run, so the flag-write
    // branch has had its chance. Anchoring on a call-count is stable; the
    // raw setTimeout(20ms) previously here could falsely pass on slow CI.
    await waitFor(() => expect(supabaseMock.from).toHaveBeenCalledTimes(2))
    expect(localPathsMock.setMigrationFlag).not.toHaveBeenCalled()
  })

  it('sets the flag keyed by user id on success', async () => {
    localPathsMock.getMigrationFlag.mockResolvedValue(null)
    supabaseMock.from
      .mockReturnValueOnce(buildFromChain([]))
      .mockReturnValueOnce(buildFromChain([]))
    renderHook(() => useLocalPathsMigration())
    await waitFor(() =>
      expect(localPathsMock.setMigrationFlag).toHaveBeenCalledWith('paths-v1:user-A', 'done')
    )
  })
})
