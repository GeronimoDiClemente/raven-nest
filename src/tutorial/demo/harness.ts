// src/tutorial/demo/harness.ts
import { __setSupabaseClient, __resetSupabaseClient } from '../../lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DemoState } from './fixtures'
import { makeWindowMocks, makePtyMock, makeSupabaseMock } from './mocks'

/** Keys on `window` the harness overrides during the tutorial. */
const WINDOW_KEYS = [
  'git',
  'worktree',
  'pty',
  'metrics',
  'accounts',
  'session',
  'dialog',
  'localPaths',
  'port',
  'electronShell',
] as const

export interface DemoHarness {
  /** The mutable demo world the UI reads/writes. */
  readonly state: DemoState
  /** Swap real APIs for mocks. Idempotent. */
  activate(): void
  /** Restore everything swapped by activate(). Idempotent. */
  deactivate(): void
}

export function createDemoHarness(state: DemoState): DemoHarness {
  let active = false
  const saved = new Map<string, unknown>()
  let pty: ReturnType<typeof makePtyMock> | null = null

  function activate(): void {
    if (active) return
    active = true

    const win = window as unknown as Record<string, unknown>
    for (const key of WINDOW_KEYS) saved.set(key, win[key])

    const mocks = makeWindowMocks(state)
    win.git = mocks.git
    win.worktree = makeWorktreeMock(state)
    win.metrics = mocks.metrics
    win.accounts = mocks.accounts
    win.session = mocks.session
    win.dialog = mocks.dialog
    win.localPaths = mocks.localPaths
    win.port = mocks.port
    win.electronShell = mocks.electronShell

    pty = makePtyMock(state)
    win.pty = pty.api

    __setSupabaseClient(makeSupabaseMock(state) as unknown as SupabaseClient)
  }

  function deactivate(): void {
    if (!active) return
    active = false

    pty?.dispose()
    pty = null

    const win = window as unknown as Record<string, unknown>
    for (const [key, value] of saved) win[key] = value
    saved.clear()

    __resetSupabaseClient()
  }

  return { state, activate, deactivate }
}

/** worktree mock that appends created worktrees to an in-memory list. */
function makeWorktreeMock(_state: DemoState) {
  const worktrees: unknown[] = []
  return {
    list: async () => ({ ok: true, worktrees }),
    create: async (opts: { repoPath: string; branch: string }) => {
      const meta = { path: `C:/demo/wt/${opts.branch}`, branch: opts.branch, setupState: 'done' as const }
      worktrees.push(meta)
      return meta
    },
    remove: async () => ({ ok: true }),
    get: async (p: string) => ({ path: p, branch: 'demo', setupState: 'done' as const }),
    setPreset: async () => ({ ok: true }),
    copyFiles: async () => ({ ok: true }),
  }
}
