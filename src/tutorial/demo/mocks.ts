// src/tutorial/demo/mocks.ts
import type { DemoState } from './fixtures'
import type { DemoWorktree, DiffFile as DemoDiffFile } from './worktree-fixtures'
import type { DiffLine, DiffResult, WorktreeMeta } from '../../types'

/** Subset of window.pty the demo drives; matches electron/preload.ts signatures. */
type PtyDataCb = (paneId: string, data: string) => void

/** Builds a fake `window.pty` that replays `state.ptyScript` into the pane. */
export function makePtyMock(state: DemoState) {
  let dataCb: PtyDataCb | null = null
  const timers: ReturnType<typeof setTimeout>[] = []

  return {
    api: {
      create: async (paneId: string) => {
        // Replay the script in small chunks so it animates like a real PTY.
        const chunks = state.ptyScript.match(/.{1,8}/gs) ?? []
        chunks.forEach((chunk, i) => {
          timers.push(setTimeout(() => dataCb?.(paneId, chunk), 120 * (i + 1)))
        })
      },
      write: () => {},
      resize: () => {},
      kill: async () => ({ ok: true }),
      exists: async () => true,
      getBuffer: async () => state.ptyScript,
      getPid: async () => 1234,
      onData: (cb: PtyDataCb) => {
        dataCb = cb
      },
      onExit: () => {},
      removeAllListeners: () => {
        dataCb = null
      },
    },
    /** Cancel pending replay timers on teardown. */
    dispose: () => {
      timers.forEach(clearTimeout)
    },
  }
}

/** Builds fake git/worktree/accounts/etc. APIs over the demo state. */
export function makeWindowMocks(state: DemoState) {
  return {
    git: {
      info: async () => ({ ok: true, branch: 'main', clean: true }),
      status: async () => ({ ok: true, files: [] }),
      clone: async () => ({ ok: true }),
      pushBranch: async () => ({ ok: true, compareUrl: 'https://github.com/demo-user/nest-web/compare/feat/x' }),
      listBranches: async () => ({ branches: ['main', 'feat/dark-mode'], defaultBranch: 'main' }),
      pickRepoFolder: async () => 'C:/demo/picked-folder',
      getRemoteUrl: async () => 'https://github.com/demo-user/nest-web.git',
      shortstat: async () => ({ ok: true, insertions: 12, deletions: 3, files: 2 }),
      findPRForBranch: async () => ({ ok: true, pr: null }),
      listUntrackedEnvFiles: async () => [] as string[],
    },
    accounts: {
      list: async () => ['demo'],
      save: async (_t: string, name: string) => name,
      delete: async () => {},
      getDir: async () => 'C:/demo/account',
      detachConfig: async () => ({ ok: true }),
    },
    localPaths: {
      get: async (id: string) => state.repos.find((r) => r.id === id)?.localPath ?? '',
      set: async (id: string, p: string) => {
        const r = state.repos.find((x) => x.id === id)
        if (r) r.localPath = p
      },
      delete: async () => {},
      getAll: async () =>
        Object.fromEntries(state.repos.filter((r) => r.localPath).map((r) => [r.id, r.localPath as string])),
      getMigrationFlag: async () => '',
      setMigrationFlag: async () => {},
    },
    dialog: {
      openFolder: async () => 'C:/demo/picked-folder',
    },
    metrics: {
      snapshot: async () => ({ panes: [] }),
      refreshDisk: async () => ({ ok: true }),
      killPid: async () => ({ ok: true }),
      portsByPids: async () => ({}),
    },
    session: {
      load: async () => null,
      save: async () => {},
    },
    port: {
      scan: async () => [] as number[],
      listAll: async () => [] as number[],
      listForWorkspace: async () => ({}),
      byPane: async () => ({}),
    },
    electronShell: {
      openExternal: () => {},
      onDeepLink: () => {},
      consumePendingDeepLink: async () => null,
    },
    // NewPaneDialog reads window.platform?.isWin (boolean, not a function)
    platform: {
      isWin: false,
      isMac: false,
      isLinux: true,
    },
    // NewPaneDialog calls window.shells?.detect() → Promise<ShellInfo[]>
    shells: {
      detect: async () => [] as { id: string; label: string }[],
    },
    // NewPaneDialog calls window.customCLIs.list(), .save(cli), .delete(id)
    customCLIs: {
      list: async () => [] as { id: string; label: string; cmd: string; color: string }[],
      save: async () => {},
      delete: async () => {},
    },
    // NewPaneDialog calls window.cli.check(cmd) → Promise<{ found: boolean; path: string }>
    cli: {
      check: async (_cmd: string) => ({ found: true, path: '' }),
    },
  }
}

/** Minimal supabase-shaped mock: auth + from() + realtime channel no-ops. */
export function makeSupabaseMock(state: DemoState) {
  const noChain = {
    select: () => noChain,
    eq: () => noChain,
    upsert: async () => ({ data: null, error: null }),
    insert: async () => ({ data: null, error: null }),
    update: () => noChain,
    single: async () => ({ data: null, error: null }),
    order: () => noChain,
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null }),
  }
  const channel = {
    on: () => channel,
    subscribe: () => channel,
    track: async () => {},
    unsubscribe: async () => {},
    send: async () => {},
  }
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'demo', email: 'demo@nest.app' } }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => noChain,
    channel: () => channel,
    removeChannel: async () => {},
    // touch state so the param isn't unused and future actions can read it
    _state: state,
  }
}

/**
 * Worktree-domain mocks driven by the mutable `state.worktree` store. These back
 * the REAL Worktrees components mounted in the demo sandbox (WorktreesSection,
 * NewWorktreeModal, DiffViewerPanel, PortsBanner) via the bridge overrides, so
 * simulated create/remove actions persist and the components render without
 * runtime errors. Return shapes mirror the preload types in src/types.ts and the
 * exact subsets the components destructure.
 */
export function makeWorktreeMocks(state: DemoState) {
  const ws = state.worktree

  // Build a full WorktreeMeta so callers can read rootRepoPath (WorktreesSection)
  // and declaredPorts (PortsBanner) without hitting undefined.
  // DemoWorktree uses 'error'; WorktreeMeta uses 'failed' — map across.
  const toSetupState = (s: DemoWorktree['setupState']): WorktreeMeta['setupState'] =>
    s === 'error' ? 'failed' : s
  const meta = (w: DemoWorktree): WorktreeMeta => ({
    repoPath: w.repoPath,
    rootRepoPath: ws.rootRepoPath,
    branch: w.branch,
    setupState: toSetupState(w.setupState),
    declaredPorts: ws.ports[w.repoPath] ?? [],
    detectedPorts: [],
    createdAt: 0,
    updatedAt: 0,
  })

  // The fixture stores diff lines as raw strings (+/-/context). DiffViewerPanel
  // reads structured DiffLine objects (l.type / l.text), so convert here.
  const toDiffLine = (raw: string): DiffLine => {
    if (raw.startsWith('+')) return { type: 'add', text: raw.slice(1) }
    if (raw.startsWith('-')) return { type: 'del', text: raw.slice(1) }
    return { type: 'context', text: raw.replace(/^ /, '') }
  }
  const toDiffFiles = (files: DemoDiffFile[]): DiffResult['files'] =>
    files.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      binary: f.binary,
      hunks: f.hunks.map((h) => ({ header: h.header, lines: h.lines.map(toDiffLine) })),
    }))

  let setupCb: ((worktreePath: string, state: WorktreeMeta['setupState']) => void) | null = null

  return {
    worktree: {
      list: async (_repoPath: string) =>
        ({ ok: true as const, worktrees: ws.worktrees.map(meta) }),
      get: async (p: string) => {
        const w = ws.worktrees.find((x) => x.repoPath === p)
        return w ? meta(w) : null
      },
      create: async (opts: { repoPath: string; branch: string; fromBranch?: string; path?: string; presetId?: string }) => {
        const path =
          opts.path ?? `C:/demo/.worktrees/nest-web/${opts.branch.replace(/\//g, '-')}`
        const w: DemoWorktree = {
          repoPath: path,
          branch: opts.branch,
          setupState: 'running',
          isRoot: false,
        }
        ws.worktrees.push(w)
        // Simulate async setup: running -> done.
        setTimeout(() => {
          const live = ws.worktrees.find((x) => x.repoPath === path)
          if (live) live.setupState = 'done'
          setupCb?.(path, 'done')
        }, 1200)
        return meta(w)
      },
      remove: async (p: string) => {
        const i = ws.worktrees.findIndex((x) => x.repoPath === p)
        if (i >= 0) ws.worktrees.splice(i, 1)
      },
      setPreset: async () => {},
      copyFiles: async () => ({ copied: 0, skipped: 0, errors: [] as string[] }),
    },
    git: {
      shortstat: async (p: string) => {
        const files = ws.diffs[p] ?? []
        return {
          additions: files.reduce((a, f) => a + f.additions, 0),
          deletions: files.reduce((a, f) => a + f.deletions, 0),
          filesChanged: files.length,
        }
      },
      listBranches: async () => ({ branches: ws.branches, defaultBranch: ws.defaultBranch }),
      findPRForBranch: async (_repoPath: string, branch: string) => ws.prs[branch] ?? null,
      listUntrackedEnvFiles: async () => ['.env', '.env.local'],
      pushBranch: async (p: string) => {
        const w = ws.worktrees.find((x) => x.repoPath === p)
        return {
          ok: true as const,
          branch: w?.branch ?? 'demo',
          compareUrl: 'https://github.com/demo-user/nest-web/compare/feat/dark-mode',
        }
      },
    },
    preset: {
      list: async () => [],
      onSetupState: (cb: (worktreePath: string, state: WorktreeMeta['setupState']) => void) => {
        setupCb = cb
      },
      cancel: async () => {},
      removeListeners: () => {
        setupCb = null
      },
    },
    spotlight: {
      start: async () => {},
      stop: async () => {},
      status: async () => ({ active: false }),
      onStatus: () => {},
      removeListeners: () => {},
    },
    diff: {
      get: async (p: string): Promise<DiffResult> => {
        const files = ws.diffs[p] ?? []
        return { base: ws.defaultBranch, files: toDiffFiles(files) }
      },
    },
    port: {
      scan: async () => [] as number[],
    },
    pty: {
      getPid: async () => 4321,
    },
    electronShell: {
      openExternal: () => {},
      onDeepLink: () => {},
      consumePendingDeepLink: async () => null,
    },
  }
}
