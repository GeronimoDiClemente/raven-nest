export type AIType = 'claude' | 'gemini' | 'codex' | 'copilot' | 'opencode' | 'terminal' | 'custom' | 'browser'

export interface Account {
  name: string
  aiType: AIType
  dir: string
}

export interface PaneNode {
  id: string
  aiType: AIType
  accountName: string
  accountDir: string
  borderColor: string
  cmd: string           // resolved command to run ('' = plain shell)
  customLabel?: string  // display label for custom CLIs
  customColor?: string  // accent color for custom CLIs
  note?: string         // user-written note visible in header
  repoPath?: string     // cwd override: git repo directory
  runningRepoPath?: string  // cwd the live PTY was actually spawned with — diverges from repoPath when the user picks a new worktree mid-session
  url?: string          // browser only: initial url
  sessionPartition?: string  // browser only: persist:browser-<workspaceId>
  shellId?: string      // terminal panes only: which shell to spawn (Windows shell picker)
}

export interface ShellInfo {
  id: string            // 'powershell' | 'cmd' | 'pwsh' | 'gitbash' | 'wsl'
  label: string         // 'Windows PowerShell', 'Command Prompt', etc.
}

export interface WorktreeMeta {
  repoPath: string                   // path absoluto canónico del worktree
  rootRepoPath: string               // path del repo principal (igual a repoPath si es root)
  branch: string                     // branch checked out
  presetId?: string                  // opaco en Plan 1; consumido en Plan 2
  setupState: 'idle' | 'running' | 'done' | 'failed' | 'cancelled' | 'orphaned'
  setupLog?: string                  // últimas ~200 líneas
  declaredPorts: number[]            // del preset (vacío en Plan 1)
  detectedPorts: number[]            // discovered runtime (vacío en Plan 1)
  devCmd?: string
  devPid?: number
  createdAt: number
  updatedAt: number
}

export type DiffLineType = 'add' | 'del' | 'context' | 'meta'
export interface DiffLine { type: DiffLineType; text: string; oldNum?: number; newNum?: number }
export interface DiffHunk { header: string; lines: DiffLine[] }
export interface DiffFile {
  path: string
  oldPath?: string
  additions: number
  deletions: number
  binary: boolean
  hunks: DiffHunk[]
  oversized?: boolean
}
export interface DiffResult { base: string; files: DiffFile[] }

export interface DetectedIDE { id: string; name: string; binPath: string }

// === Resource usage metrics (kept in sync with electron/metrics-collector.ts) ===
export interface NestProcessMetric {
  type: 'Main' | 'Renderer' | 'Other'
  cpuPercent: number
  memBytes: number
}
export interface PaneMetric {
  paneId: string
  label: string
  pid: number
  cpuPercent: number
  memBytes: number
}
export interface DiskBucket {
  name: string
  size: number
}
export interface WorktreeMetricInfo {
  worktreePath: string
  branchLabel: string
  cpuPercent: number
  memBytes: number
  diskBytes: number | null
  diskBuckets?: DiskBucket[]
  panes: PaneMetric[]
}
export interface RepoMetric {
  commonDir: string
  repoName: string
  cpuPercent: number
  memBytes: number
  diskBytes: number | null
  diskBuckets?: DiskBucket[]
  worktrees: WorktreeMetricInfo[]
}
export interface MetricsSnapshot {
  totalSystemMemBytes: number
  totals: { cpuPercent: number; memBytes: number; ramSharePercent: number }
  nest: { processes: NestProcessMetric[]; cpuPercent: number; memBytes: number }
  repos: RepoMetric[]
}
export interface MetricsPaneInput {
  paneId: string
  repoPath: string | undefined
  label: string
  note?: string
  // Tab name. Used to group panes that don't have a linked repo so they
  // still appear in the panel under their workspace's name.
  workspaceName?: string
  // CSS color (preferring borderColor that the user can recolor from the
  // pane header). Drives the bullet/logo color in the resource panel.
  aiColor?: string
  // Which AI logo to render — Claude / Gemini / Codex / Copilot / Opencode.
  // Coexists with aiColor so the popover can tint the logo on the fly.
  aiType?: AIType
}

export interface RavenPreset {
  id: string                  // slug, ej "nextjs-dev"
  name: string
  description?: string
  setup?: string[]            // shell commands, sequential
  dev?: string                // long-running dev command
  ports?: number[]
  env?: Record<string, string>
  postCreate?: string[]       // run once after worktree creation, before setup
  spotlightIgnore?: string[]
}

export interface ConversationMeta {
  id: string
  aiType: string
  accountName: string
  timestamp: number
  preview: string
  displayName?: string
  iconEmoji?: string
}

export interface ResponseBlock {
  id: string        // crypto.randomUUID()
  timestamp: number // Date.now()
  content: string   // ANSI-stripped response text
  aiType: string
  label: string     // pane.customLabel ?? AI_CONFIG[pane.aiType].label
}

export interface Snippet {
  id: string
  name: string
  content: string
}

export interface CustomCLI {
  id: string
  label: string
  cmd: string
  color: string
}

export interface GridLayout {
  rows: number
  cols: number
}

export const COLOR_PALETTE = [
  '#0055FF', // blue
  '#FF4500', // red-orange
  '#00CC44', // green
  '#FFB800', // yellow
  '#CC44FF', // purple
  '#FF2D78', // pink
  '#00CCCC', // cyan
  '#FF6600', // orange
  '#FF1A1A', // red
  '#4455FF', // indigo
  '#88FF00', // lime
  '#666666', // gray
]

export const AI_CONFIG: Record<AIType, { label: string; color: string; bg: string; cmd: string; noAccount?: boolean }> = {
  claude:   { label: 'Claude',   color: '#E07B54', bg: '#2a1a14', cmd: 'claude'     },
  gemini:   { label: 'Gemini',   color: '#4F9EFF', bg: '#0d1f35', cmd: 'gemini'     },
  codex:    { label: 'Codex',    color: '#aaaaaa', bg: '#1c1c1c', cmd: 'codex'      },
  copilot:  { label: 'Copilot',  color: '#7C5CFC', bg: '#150d2e', cmd: 'gh copilot' },
  opencode: { label: 'OpenCode', color: '#FFFFFF', bg: '#111111', cmd: 'opencode', noAccount: true },
  terminal: { label: 'Terminal', color: '#888888', bg: '#1a1a1a', cmd: '',           noAccount: true },
  custom:   { label: 'Custom',   color: '#888888', bg: '#1a1a1a', cmd: '',           noAccount: true },
  browser:  { label: 'Browser',  color: '#0066FF', bg: '#0a1428', cmd: '',           noAccount: true },
}

export interface SessionPane {
  aiType: AIType
  accountName: string
  accountDir: string
  borderColor: string
  cmd: string
  customLabel?: string
  customColor?: string
  note?: string
  repoPath?: string
  shellId?: string
}

export interface SessionData {
  // v2: multi-tab
  tabs?: Array<{
    id: string
    name: string
    layout: GridLayout
    cells: (SessionPane | null)[]
  }>
  activeTabId?: string
  // v1 legacy fields — kept for backward compat migration on load
  layout?: GridLayout
  cells?: (SessionPane | null)[]
}

export interface Workspace {
  id: string
  name: string
  layout: GridLayout
  colSizes: number[][]  // per-row column percentages: colSizes[row][col]
  rowSizes: number[]
  cells: (SessionPane | null)[]
  resumeLastSession: boolean
  createdAt: number
  updatedAt: number
  repoPath?: string     // git repo directory linked to this workspace
}

export interface WorkspaceTab {
  id: string
  name: string
  accentColor?: string
  repoPath?: string     // git repo directory; new panes start here as cwd
  layout: GridLayout
  colSizes: number[][]  // per-row column percentages: colSizes[row][col]
  rowSizes: number[]    // row heights, length = rows, sum = 100
  cells: (PaneNode | null)[]
}

export function equalSizes(count: number): number[] {
  if (count <= 0) return []
  const base = Math.floor(100 / count)
  const sizes = Array(count).fill(base)
  sizes[sizes.length - 1] += 100 - base * count  // absorb rounding remainder
  return sizes
}

// Augment Window with our IPC API
declare global {
  interface Window {
    customCLIs: {
      list: () => Promise<CustomCLI[]>
      save: (cli: CustomCLI) => Promise<void>
      delete: (id: string) => Promise<void>
    }
    pty: {
      create: (paneId: string, cmd: string, accountDir: string, repoPath?: string, shellId?: string) => Promise<{ ok: true } | { ok: false; error: string }>
      write: (paneId: string, data: string) => void
      resize: (paneId: string, cols: number, rows: number) => void
      kill: (paneId: string) => Promise<void>
      exists: (paneId: string) => Promise<boolean>
      getBuffer: (paneId: string) => Promise<string>
      getPid: (paneId: string) => Promise<number | undefined>
      onData: (cb: (paneId: string, data: string) => void) => void
      onExit: (cb: (paneId: string) => void) => void
      removeAllListeners: () => void
    }
    session: {
      load: () => Promise<SessionData | null>
      save: (data: SessionData) => Promise<void>
    }
    accounts: {
      list: (aiType: string) => Promise<string[]>
      save: (aiType: string, name: string) => Promise<string>
      delete: (aiType: string, name: string) => Promise<void>
      getDir: (aiType: string, name: string) => Promise<string>
    }
    conversations: {
      list: () => Promise<ConversationMeta[]>
      save: (aiType: string, accountName: string, content: string) => Promise<string>
      get: (id: string) => Promise<string>
      delete: (id: string) => Promise<void>
      export: (id: string) => Promise<boolean>
      rename: (id: string, displayName: string) => Promise<void>
      updateIcon: (id: string, iconEmoji: string | null) => Promise<void>
    }
    snippets: {
      list: () => Promise<Snippet[]>
      save: (snippet: Snippet) => Promise<void>
      delete: (id: string) => Promise<void>
    }
    workspaces: {
      list: () => Promise<Workspace[]>
      save: (ws: Workspace) => Promise<void>
      delete: (id: string) => Promise<void>
      exportToFile: (ws: Workspace) => Promise<void>
      importFromFile: () => Promise<Workspace | null>
    }
    dialog: {
      openFolder: () => Promise<string | null>
    }
    platform: {
      isWin: boolean
      isMac: boolean
      isLinux: boolean
    }
    appFlags?: {
      e2eBypass: boolean
    }
    windowControls: {
      send: (action: 'minimize' | 'maximize' | 'close') => void
    }
    updater: {
      onStatus: (cb: (status: 'downloading' | 'ready' | 'error', msg?: string) => void) => void
      install: () => void
      checkForUpdates: () => Promise<'up-to-date' | 'update-found' | 'error'>
    }
    nestUtils: {
      getPathForFile: (file: File) => string
    }
    tempImages: {
      save: (base64: string) => Promise<string>
      copyToTemp: (srcPath: string, index: number) => Promise<string>
      writeImageToClipboard: (filePath: string) => Promise<void>
      cleanup: (paths: string[]) => Promise<void>
    }
    electronShell: {
      openExternal: (url: string) => void
      onDeepLink: (cb: (url: string) => void) => void
    }
    mcp: {
      read: (filePath: string) => Promise<Record<string, unknown>>
      write: (filePath: string, servers: Record<string, unknown>) => Promise<void>
      globalPath: () => Promise<string>
    }
    git: {
      info: (repoPath: string) => Promise<{
        branch: string | null
        remoteUrl: string | null
        githubUrl: string | null
        isDirty: boolean
      }>
      status: (repoPath: string) => Promise<{
        files: Array<{ status: string; path: string }>
        ahead: number
        behind: number
      }>
      clone: (
        cloneUrl: string,
        repoName: string,
        parentDir?: string,
        auth?: { provider: 'github' | 'gitlab'; token: string | null },
      ) => Promise<{
        ok: boolean
        path?: string
        alreadyExisted?: boolean
        error?: string
      }>
      pushBranch: (worktreePath: string) => Promise<
        | { ok: true; branch: string; compareUrl?: string }
        | { ok: false; error: string }
      >
      listBranches: (repoPath: string) => Promise<{
        branches: string[]
        defaultBranch: string | null
      }>
      pickRepoFolder: () => Promise<string | null>
      shortstat: (
        worktreePath: string,
        base?: string,
      ) => Promise<{ additions: number; deletions: number; filesChanged: number }>
      findPRForBranch: (
        repoPath: string,
        branch: string,
        tokens?: { github?: string | null; gitlab?: string | null },
      ) => Promise<{ number: number; url: string } | null>
      listUntrackedEnvFiles: (repoPath: string) => Promise<string[]>
    }
    speech: {
      check: () => Promise<boolean>
      transcribe: (audio: Uint8Array, language?: string) => Promise<string>
      onStatus: (cb: (status: 'loading' | 'ready') => void) => void
      removeStatusListener: () => void
    }
    github: {
      openOAuth: () => Promise<void>
      onOAuthCode: (cb: (code: string) => void) => void
      removeOAuthListener: () => void
    }
    gitlab: {
      openOAuth: () => Promise<void>
      onOAuthCode: (cb: (code: string) => void) => void
      removeOAuthListener: () => void
    }
    keybinds: {
      onTabCycle: (cb: (shift: boolean) => void) => void
      removeTabCycleListener: () => void
    }
    pathUtils: {
      exists: (p: string) => Promise<boolean>
    }
    cli: {
      check: (cmd: string) => Promise<{ found: boolean; path: string }>
    }
    shells: {
      detect: () => Promise<ShellInfo[]>
    }
    worktree: {
      list: (repoPath: string) => Promise<WorktreeMeta[]>
      create: (opts: { repoPath: string; branch: string; fromBranch?: string; path?: string; presetId?: string }) => Promise<WorktreeMeta>
      remove: (worktreePath: string) => Promise<void>
      get: (worktreePath: string) => Promise<WorktreeMeta | null>
      setPreset: (worktreePath: string, presetId: string | null) => Promise<void>
      copyFiles: (
        srcRepoPath: string,
        dstWorktreePath: string,
        files: string[],
      ) => Promise<{ copied: number; skipped: number; errors: string[] }>
    }
    preset: {
      list: (repoPath: string) => Promise<RavenPreset[]>
      save: (repoPath: string, preset: RavenPreset) => Promise<void>
      delete: (repoPath: string, presetId: string) => Promise<void>
      apply: (worktreePath: string, presetId: string) => Promise<void>
      cancel: (worktreePath: string) => Promise<void>
      onSetupProgress: (cb: (worktreePath: string, line: string) => void) => void
      onSetupState: (cb: (worktreePath: string, state: WorktreeMeta['setupState']) => void) => void
      removeListeners: () => void
    }
    port: {
      scan: (pid: number) => Promise<number[]>
      listAll: () => Promise<number[]>
      listForWorkspace: (opts: { repoPath?: string; paneIds?: string[] }) => Promise<number[]>
    }
    diff: {
      get: (worktreePath: string, base?: string) => Promise<DiffResult>
    }
    ide: {
      detect: (force?: boolean) => Promise<DetectedIDE[]>
      open: (binPath: string, worktreePath: string) => Promise<void>
      clearCache: () => Promise<void>
    }
    spotlight: {
      start: (worktreePath: string) => Promise<void>
      stop: () => Promise<void>
      status: () => Promise<{ active: boolean; worktreePath?: string; events?: number; errors?: number }>
      onStatus: (cb: (status: { active: boolean; worktreePath?: string; events?: number }) => void) => void
      onWarning: (cb: (msg: string) => void) => void
      removeListeners: () => void
    }
    benchmark: {
      start: (cellId: string, pid: number, mode: 'setup' | 'spotlight' | 'idle') => Promise<void>
      stop: (cellId: string) => Promise<void>
      get: (cellId: string) => Promise<unknown>
      list: () => Promise<unknown[]>
      setMode: (cellId: string, mode: 'setup' | 'spotlight' | 'idle') => Promise<void>
    }
    browser: {
      create: (paneId: string, url: string, partition: string) => Promise<void>
      reposition: (paneId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
      navigate: (paneId: string, url: string) => Promise<void>
      back: (paneId: string) => Promise<void>
      forward: (paneId: string) => Promise<void>
      reload: (paneId: string) => Promise<void>
      destroy: (paneId: string) => Promise<void>
      onNavigated: (cb: (paneId: string, url: string) => void) => void
      removeListeners: () => void
    }
    settings: {
      get: () => Promise<{
        keybindings: {
          voiceInput: string
          newPane: string
          globalSearch: string
          commandPalette: string
          nextPane: string
          prevPane: string
          fontSizeUp: string
          fontSizeDown: string
          fontSizeReset: string
        }
      }>
      set: (data: unknown) => Promise<void>
    }
    metrics: {
      snapshot: (panes: MetricsPaneInput[]) => Promise<MetricsSnapshot>
      refreshDisk: (worktreePaths: string[]) => Promise<Record<string, { total: number; buckets: DiskBucket[] }>>
      killPid: (pid: number) => Promise<{ ok: true } | { ok: false; error: string }>
      portsByPids: (pids: number[]) => Promise<Record<number, number[]>>
    }
  }
}
