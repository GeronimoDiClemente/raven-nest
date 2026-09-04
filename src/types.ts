import type { EditorPreferences, EditorTheme } from './lib/ide-config-mappings'

export type AIType = 'claude' | 'gemini' | 'codex' | 'copilot' | 'opencode' | 'deepseek' | 'grok' | 'qwen' | 'cursor' | 'terminal' | 'custom' | 'browser' | 'editor'

export type LayoutId =
  | '1'
  | '2V' | '2H'
  | '3C' | '3M' | '3T'
  | '4Q' | '4M' | '4T'
  | '5T' | '5M' | '5B'
  | '6G' | '6M' | '6C'
  | '7T' | '7M' | '7B'
  | '8G' | '8M' | '8B'
  | '9G' | '9M' | '9T'
  | '10G' | '10M' | '10B'
  | '11G' | '11M' | '11B'
  | '12G' | '12M' | '12C'

export const MAX_PANES = 12

export interface Account {
  name: string
  aiType: AIType
  dir: string
}

export interface EditorTab {
  relPath: string  // path relativo al repoPath del pane, POSIX-style
  dirty: boolean
}

export interface PaneNode {
  id: string
  /** Tamano de fuente propio del pane. Sin valor, hereda el global. */
  fontSize?: number
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
  initialInput?: string // one-shot: input written to the PTY once when it first produces output (e.g. "arreglá el rojo")
  editorTabs?: EditorTab[]        // editor panes only: open files
  activeEditorTabPath?: string    // editor panes only: which tab is focused
  pinned?: boolean      // Hub: user-pinned pane, shows under the "Pinned" filter
}

export interface ShellInfo {
  id: string            // 'powershell' | 'cmd' | 'pwsh' | 'gitbash' | 'wsl'
  label: string         // 'Windows PowerShell', 'Command Prompt', etc.
}

export interface WorktreeMeta {
  repoPath: string                   // canonical absolute path of the worktree
  rootRepoPath: string               // path of the main repo (equal to repoPath if it is the root)
  branch: string                     // branch checked out
  presetId?: string                  // opaque in Plan 1; consumed in Plan 2
  setupState: 'idle' | 'running' | 'done' | 'failed' | 'cancelled' | 'orphaned'
  setupLog?: string                  // last ~200 lines
  declaredPorts: number[]            // from the preset (empty in Plan 1)
  detectedPorts: number[]            // discovered runtime (empty in Plan 1)
  devCmd?: string
  devPid?: number
  createdAt: number
  updatedAt: number
}

// === Ticket loop (kept in sync with electron/integrations/ticket-types.ts —
// src/ never imports from electron/, same pattern as WorktreeMeta above) ===
export type TicketState = 'todo' | 'in_progress' | 'in_review' | 'done'

export interface Ticket {
  /** visible id like "PROJ-142" (Jira), "ENG-42" (Linear), "owner/repo#7" (GitHub) */
  key: string
  /** internal id the provider needs for its API (issueId, node id, number) */
  providerId: string
  title: string
  url: string
  state: TicketState
  /** markdown: description + comments, for TASK.md */
  context: string
}

export interface TicketsBridge {
  list: (pluginId: string) => Promise<Ticket[]>
  branchName: (user: string, key: string, title: string) => Promise<string>
  startWork: (args: {
    pluginId: string
    ticket: Ticket
    branch: string
    worktreePath: string
  }) => Promise<{ ok: true } | { ok: false; error: string }>
  tracked: () => Promise<Array<{ branch: string; ticketKey: string }>>
}

// === Worktree signals (H4 Motor 3) — espejo de WorktreeSignal de
// electron/integrations/worktree-signals.ts (src/ nunca importa de electron/) ===
export interface WorktreeSignalDTO {
  repoPath: string
  ci: 'success' | 'failure' | 'running' | 'unknown'
  runId?: number
  runUrl?: string
  changesRequested: boolean
  prNumber?: number
  /** "owner/repo" resolved during the poll; undefined until the first poll cycle. */
  repo?: string
}

export interface SignalsBridge {
  list: () => Promise<WorktreeSignalDTO[]>
  fixCiPrompt: (repoPath: string) => Promise<string | null>
  onUpdate: (cb: () => void) => () => void
}

// === Activity feed (event bus) — espejo de DomainEvent de
// electron/integrations/bus-types.ts (src/ nunca importa de electron/, mismo
// patrón que WorktreeSignalDTO arriba). Sólo los tipos, sin los guards
// runtime (`isDomainEvent` vive en el borde de main, no acá). ===
export interface TaskCreatedEvent {
  type: 'task.created'
  taskId: string
  pluginId: string
  providerId: string
  repoFullName: string | null
  branch: string
  title?: string
}
export interface SessionOpenedEvent {
  type: 'session.opened'
  branch: string
  repoPath: string
  pluginId?: string
  providerId?: string
}
export interface SessionClosedEvent {
  type: 'session.closed'
  branch: string
}
export interface PrOpenedEvent {
  type: 'pr.opened'
  branch: string
  repoFullName: string
}
export interface PrMergedEvent {
  type: 'pr.merged'
  branch: string
  repoFullName: string
}
export interface CiFailedEvent {
  type: 'ci.failed'
  branch: string
  repoFullName: string
  runUrl?: string
  summary?: string
}
export interface ErrorDetectedEvent {
  type: 'error.detected'
  source: string
  ref: string
  summary: string
}
export interface BlockStartedEvent {
  type: 'block.started'
  taskId?: string
  label: string
}
export interface MeetingTranscribedEvent {
  type: 'meeting.transcribed'
  title: string
  items: string[]
}
export interface ChangesRequestedEvent {
  type: 'changes.requested'
  branch: string
  repoFullName: string
  prNumber: number
}
export interface ReviewRequestedEvent {
  type: 'review.requested'
  repoFullName: string
  prNumber: number
  prTitle: string
}

export type DomainEvent =
  | TaskCreatedEvent
  | SessionOpenedEvent
  | SessionClosedEvent
  | PrOpenedEvent
  | PrMergedEvent
  | CiFailedEvent
  | ErrorDetectedEvent
  | BlockStartedEvent
  | MeetingTranscribedEvent
  | ChangesRequestedEvent
  | ReviewRequestedEvent

export interface ActivityEntry {
  ev: DomainEvent
  ts: number
}

export interface ActivityBridge {
  /** Snapshot of the ring buffer (newest first) for the initial paint. */
  list: () => Promise<ActivityEntry[]>
  /** Live push, one call per event emitted on the bus. Returns the unsubscribe. */
  onAppend: (cb: (entry: ActivityEntry) => void) => () => void
}

// === Recipes tab (H8/Plan 5 Task 1) — espejo de RecipeDescriptor de
// electron/integrations/recipes.ts (src/ nunca importa de electron/). Read-only:
// "when event → commands" display for the built-in/stored bus recipes. ===
export interface RecipeDescriptor {
  id: string
  when: string
  commands: string[]
}

export interface RecipesBridge {
  list: () => Promise<RecipeDescriptor[]>
}

// === Automations tab (epic C/H11) — mirror of Automation in
// electron/integrations/scheduler.ts (src/ nunca importa de electron/, same
// convention as RecipeDescriptor above). `nextRunAt`/`scheduleLabel` are NOT
// part of the persisted model — the main process computes them fresh on every
// `list()`/`create()`/`update()` call and attaches them to the DTO. ===
export interface Automation {
  id: string
  name: string
  trigger: string
  time?: string
  timezone?: string
  prompt: string
  repo?: string
  provider?: string
  /** References a saved worker-spec (electron/integrations/worker-spec-store.ts)
   *  to resolve model/effort/instructions from. `model`/`effort` below, when
   *  set, take precedence (inline override of the referenced worker's first step). */
  workerId?: string
  model?: string
  effort?: 'low' | 'medium' | 'high'
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  lastResult?: 'ok' | 'error'
  lastSummary?: string
  /** Epoch ms of the next scheduled fire, or null if the trigger doesn't
   *  parse. Computed server-side by `nextRun`. */
  nextRunAt: number | null
  /** Human label for the list row, e.g. "Daily at 18:00". Computed
   *  server-side by `describeSchedule`. */
  scheduleLabel: string
}

export interface AutomationInput {
  name: string
  trigger: string
  time?: string
  timezone?: string
  prompt: string
  repo?: string
  provider?: string
  workerId?: string
  model?: string
  effort?: 'low' | 'medium' | 'high'
}

export interface AutomationsBridge {
  list: () => Promise<Automation[]>
  create: (input: AutomationInput) => Promise<Automation>
  update: (id: string, patch: Partial<AutomationInput & { enabled: boolean }>) => Promise<Automation | null>
  delete: (id: string) => Promise<boolean>
}

// === @Nest desde Slack (H7 Motor 5) — espejo de SlackMention/SlackAction de
// electron/integrations/slack-envelopes.ts (src/ nunca importa de electron/) ===
export interface SlackMentionDTO {
  channel: string
  threadTs: string
  user: string
  text: string
}

export interface SlackActionDTO {
  actionId: string
  value?: string
  channel: string
  threadTs?: string
  user: string
}

export interface SlackMentionsBridge {
  /** Menciones `@Nest` empujadas desde el socket (main). Devuelve el unsubscribe. */
  onMention: (cb: (m: SlackMentionDTO) => void) => () => void
  /** Clicks de botones Block Kit empujados desde el socket. Devuelve el unsubscribe. */
  onAction: (cb: (a: SlackActionDTO) => void) => () => void
  /** Postea al MISMO thread (bot token main-side). Sin token → { ok: false }. */
  postThread: (args: { channel: string; threadTs: string; text: string }) => Promise<{ ok: boolean }>
}

// === Notion spec→worktree (H5 Motor 2) ===
export interface NotionBridge {
  /** Baja la página como markdown, la escribe en <worktree>/.nest/spec.md y
   *  devuelve el markdown para inyectarlo como prompt inicial del agente. */
  specToWorktree: (pageId: string, worktreePath: string) =>
    Promise<{ ok: true; prompt: string } | { ok: false; error: string }>
}

// === Google Calendar (H6 Motor 4) — espejo de GcalEvent de
// electron/integrations/gcal.ts (src/ nunca importa de electron/) ===
export interface GcalEventDTO {
  id: string
  summary?: string
  description?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

export interface GcalBridge {
  /** OAuth desktop (loopback + PKCE). Guarda las creds en pluginCreds('gcal'). */
  openOAuth: () => Promise<{ ok: true } | { ok: false; error: string }>
  /** Bloques del rango (block→session). Errores degradan a []. */
  listEvents: (timeMin: string, timeMax: string) => Promise<GcalEventDTO[]>
  /** Escribe <worktree>/.nest/spec.md con el título/contexto y devuelve el prompt. */
  startSession: (args: { title: string; context: string; worktreePath: string }) =>
    Promise<{ ok: true; prompt: string } | { ok: false; error: string }>
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

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface DetectedIDE { id: string; name: string; binPath: string }

// === Sistema de temas del editor (kept in sync with electron/theme-bridge.ts) ===
export interface InstalledThemeInfo {
  name: string        // slug estable; es lo que se guarda en ui_settings.editorTheme
  displayName: string
  isDark: boolean
  theme: import('./lib/theme-registry').VSCodeThemeJson
}
export interface ScannedThemeInfo { label: string; path: string }
export interface OpenVSXThemeResult { namespace: string; name: string; displayName: string; description: string }
export type ThemeOpResult = { ok: true; name: string } | { ok: false; error: string }

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
  // CSS color for the AI bullet / which AI logo to render — passed through
  // unchanged from MetricsPaneInput (see electron/metrics-collector.ts's
  // own PaneMetric, which already carries these).
  aiColor?: string
  aiType?: AIType
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
  id: string                  // slug, e.g. "nextjs-dev"
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

// === Worker-spec / model-per-task — mirror of WorkerStep/WorkerSpec in
// electron/integrations/worker-spec-store.ts (src/ nunca importa de
// electron/, same convention as Automation above). ===
export interface WorkerStep {
  agent: AIType
  customCliId?: string
  model?: string
  effort?: 'low' | 'medium' | 'high'
  instructions?: string
  role?: string
  /** Saved CLI account to launch this step with (bypasses the account picker
   *  at run time). Unset = ask at launch, same as before this field existed. */
  account?: string
}
export interface WorkerSpec {
  id: string
  name: string
  description?: string
  steps: WorkerStep[]
  createdAt: number
  updatedAt: number
}
export interface WorkerSpecInput {
  name: string
  description?: string
  steps: WorkerStep[]
}
export interface WorkerSpecsBridge {
  list: () => Promise<WorkerSpec[]>
  save: (input: WorkerSpecInput & { id?: string }) => Promise<WorkerSpec>
  delete: (id: string) => Promise<boolean>
}

export interface HandoffBridge {
  read: (worktreePath: string) => Promise<string | null>
  write: (worktreePath: string, content: string) => Promise<void>
}

// === Graph orchestration (renderer mirror of electron/integrations/graph-*) ===
export type GraphRole = 'architect' | 'coder' | 'reviewer' | 'tester' | (string & {})
export type GraphNodeKind = 'agent' | 'gate'
export interface GraphNode {
  id: string
  role: GraphRole
  kind: GraphNodeKind
  agent?: AIType
  model?: string
  effort?: 'low' | 'medium' | 'high'
  focus?: string
  instructions?: string
  dependsOn: string[]
}
export interface GraphTemplate {
  id: string
  name: string
  description?: string
  builtIn?: boolean
  nodes: GraphNode[]
  createdAt: number
  updatedAt: number
}
export interface GraphTemplateInput {
  name: string
  description?: string
  nodes: GraphNode[]
}

export type NodeRunState =
  | 'queued' | 'running' | 'needs_input' | 'blocked' | 'done' | 'failed' | 'skipped'
export type GraphMode = 'auto' | 'gate' | 'step'
export type PendingDecision =
  | { kind: 'approve'; gateId: string }
  | { kind: 'requestChanges'; feedback: string }
/** Lo que un reviewer dejó escrito en su artefacto, ya parseado. */
export interface GraphVerdict {
  concerns: string[]
  blocking: boolean
}
export interface NodeRuntime {
  state: NodeRunState
  paneId?: string
  startedAt?: number
  endedAt?: number
  summary?: string
  artifact?: string
  verdict?: GraphVerdict
  exitCode?: number
}
export interface GraphRun {
  runId: string
  ticketId: string
  templateId: string
  worktreePath: string
  repoPath?: string
  branch: string
  nodes: Record<string, NodeRuntime>
  startedAt: number
  mode: GraphMode
  round: number
  revisionNotes?: Record<string, string>
  pendingDecision?: PendingDecision
}
export interface PersistedGraphRun {
  run: GraphRun
  seen: string[]
}

export interface GraphTemplatesBridge {
  list: () => Promise<GraphTemplate[]>
  save: (input: GraphTemplateInput & { id?: string }) => Promise<GraphTemplate>
  delete: (id: string) => Promise<boolean>
}
export interface GraphRunStartInput {
  repoPath: string
  templateId: string
  ticketId: string
  branch: string
}
export interface GraphRunsBridge {
  list: () => Promise<PersistedGraphRun[]>
  start: (input: GraphRunStartInput) => Promise<
    { ok: true; runId: string; worktreePath: string } | { ok: false; error: string }
  >
  attach: (runId: string, nodeId: string) => Promise<{ paneId: string; exists: boolean; buffer: string }>
  // Decisiones humanas: encolan un pendingDecision que aplica el tick, no aplican nada acá.
  setMode: (runId: string, mode: GraphMode) => Promise<{ ok: boolean }>
  approve: (runId: string, gateId: string) => Promise<{ ok: boolean }>
  requestChanges: (runId: string, feedback: string) => Promise<{ ok: boolean }>
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

export const AI_CONFIG: Record<AIType, {
  label: string
  color: string
  bg: string
  cmd: string
  noAccount?: boolean
  modelFlag?: string   // CLI flag that selects a model, e.g. '--model'. Absent = no model selection.
  models?: string[]    // known selectable model ids/aliases for a picker
  effortFlag?: string  // CLI flag for reasoning effort, e.g. '--effort'. Absent = no effort control. (capability-only for now)
}> = {
  // ORDEN = como se ven en el picker (4 columnas, 3 filas + Add CLI). Puesto
  // para que no queden dos tiles de la misma familia de color pegados, ni al
  // lado ni arriba/abajo: hay cinco acromaticos (codex, opencode, cursor,
  // grok, terminal), tres azules (gemini, deepseek, browser) y dos violetas
  // (copilot, qwen). Los mas usados quedan en la primera fila.
  claude:   { label: 'Claude',   color: '#E07B54', bg: '#2a1a14', cmd: 'claude',     modelFlag: '--model', models: ['opus', 'sonnet', 'haiku'], effortFlag: '--effort' },
  gemini:   { label: 'Gemini',   color: '#4F9EFF', bg: '#0d1f35', cmd: 'gemini',     modelFlag: '--model', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  codex:    { label: 'Codex',    color: '#aaaaaa', bg: '#1c1c1c', cmd: 'codex',      modelFlag: '--model' },
  copilot:  { label: 'Copilot',  color: '#7C5CFC', bg: '#150d2e', cmd: 'gh copilot' },
  deepseek: { label: 'DeepSeek', color: '#4D6BFE', bg: '#0c1330', cmd: 'dsh',          noAccount: true },
  opencode: { label: 'OpenCode', color: '#FFFFFF', bg: '#111111', cmd: 'opencode', noAccount: true, modelFlag: '--model' },
  qwen:     { label: 'Qwen',     color: '#6950EF', bg: '#14103a', cmd: 'qwen',         noAccount: true },
  cursor:   { label: 'Cursor',   color: '#D4D4D4', bg: '#181818', cmd: 'cursor-agent', noAccount: true },
  grok:     { label: 'Grok',     color: '#E8E8E8', bg: '#141414', cmd: 'grok',         noAccount: true },
  browser:  { label: 'Browser',  color: '#0066FF', bg: '#0a1428', cmd: '',           noAccount: true },
  terminal: { label: 'Terminal', color: '#888888', bg: '#1a1a1a', cmd: '',           noAccount: true },
  custom:   { label: 'Custom',   color: '#888888', bg: '#1a1a1a', cmd: '',           noAccount: true },
  editor:   { label: 'Editor',   color: '#4EC9B0', bg: '#0d1f1c', cmd: '',           noAccount: true },
}

// Tipos elegibles en el picker de "New Terminal". 'custom' tiene su propia
// card (Add CLI) y 'editor' NO es creable desde acá: un pane de editor sin
// editorTabs iniciales es un cascarón sin tabs, sin Monaco y sin cierre —
// los editores nacen desde el Explorer.
export const PICKER_AI_TYPES: AIType[] = (Object.keys(AI_CONFIG) as AIType[]).filter(
  (t) => t !== 'custom' && t !== 'editor',
)

export interface SessionPane {
  // Persistido para que hubPanes (que referencia ids) sobreviva el restart:
  // regenerar ids en el restore dejaba el Hub restaurado vacío. Los
  // workspaces GUARDADOS (plantillas re-cargables) siguen regenerando id al
  // cargar — ver loadWorkspace.
  id?: string
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
  url?: string  // browser only: last navigated URL, restored on session load
  pinned?: boolean  // Hub pin — survives session restore
  // editor only: sin estos dos, un pane de editor restauraba como cascarón
  // sin tabs — negro y sin affordance de cierre (el × vive por-tab).
  editorTabs?: EditorTab[]
  activeEditorTabPath?: string
}

export interface SessionData {
  tabs?: Array<{
    id: string
    name: string
    accentColor?: string
    repoPath?: string
    // v3 new
    layoutId?: LayoutId
    panes?: SessionPane[]
    splitRatios?: Record<string, number[]>
    isHub?: boolean
    hubPanes?: string[]
    // v2 legacy (kept optional for migration)
    layout?: GridLayout
    cells?: (SessionPane | null)[]
    colSizes?: number[][]
    rowSizes?: number[]
  }>
  activeTabId?: string
  // v1 legacy
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
  repoPath?: string
  layoutId: LayoutId
  panes: PaneNode[]
  splitRatios?: Record<string, number[]>
  isHub?: boolean  // true = tab that shows the Hub, with no panes of its own
  hubPanes?: string[]  // Hub: ORDERED pane ids the user curated into the Hub (membership + order)
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
      resize: (paneId: string, cols: number, rows: number, source?: string) => void
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
    memory: {
      ensureDeviceId: () => Promise<string>
      connect: (token: string, deviceId: string) => Promise<{ ok: boolean; error?: string; itemCount?: number }>
      /**
       * Declara qué cuenta de Nest está usando el store. Sella el autor de cada escritura y
       * acota el push a esa cuenta. Opcional: un preload viejo no lo expone.
       */
      setUser?: (userId: string | null) => Promise<unknown>
      /**
       * §9.2 — pide un token al servicio de sync con el JWT del login. Opcional: un preload
       * viejo no lo expone, y el hook cae al token pegado a mano.
       */
      registerDevice?: (jwt: string) => Promise<
        { ok: true; deviceId: string; token: string } | { ok: false; error: string }
      >
      disconnect: (opts?: { deleteCloud?: boolean }) => Promise<{
        ok: boolean
        cloudDeleteFailed?: string
        /** El token quedó vivo en el servidor: el revoke contra `/v1/devices/revoke` falló. */
        tokenRevokeFailed?: string
      }>
      status: () => Promise<{
        connected: boolean
        deviceId: string | null
        itemCount: number
        pendingCount: number
        daemonStatus: 'idle' | 'syncing' | 'paused' | 'error' | 'plan_required'
        /**
         * Lo que el servidor reporta en `GET /v1/sync/status`. Ausente hasta que el
         * daemon recibe su primera respuesta. El cliente NO calcula estos numeros: los
         * limites de nube los hace cumplir el servicio y el cliente los muestra.
         */
        quota?: { used_bytes: number; max_bytes: number }
        /**
         * True when main's memory subsystem never initialized. The preload exposes
         * `window.memory` unconditionally, so its mere presence proves nothing — this
         * flag is the only signal the renderer gets that memory is dead on this machine.
         */
        unavailable?: boolean
      }>
      onStatus: (cb: (status: 'idle' | 'syncing' | 'paused' | 'error' | 'plan_required') => void) => void
      removeStatusListener: () => void
      /**
       * Para la pantalla de reconocimiento del hub (Task 7): local-first, funciona sin
       * login. `projectCount` excluye `__global__` (no es un proyecto reconocible).
       */
      hubStats: () => Promise<{ itemCount: number; projectCount: number }>
    }
    platform: {
      isWin: boolean
      isMac: boolean
      isLinux: boolean
    }
    // Diff vs HEAD del worktree (electron/git-diff.ts): badges del Explorer
    // y líneas agregadas del editor. Opcional: preloads viejos no lo exponen.
    gitDiff?: {
      stats: (worktreePath: string) => Promise<
        | { ok: true; files: Array<{ relPath: string; added: number; deleted: number }>; untracked: string[] }
        | { ok: false; error: string }
      >
      addedLines: (worktreePath: string, relPath: string) => Promise<
        | { ok: true; ranges: Array<{ start: number; end: number }> }
        | { ok: false; error: string }
      >
    }
    appFlags?: {
      e2eBypass: boolean
      // Plan simulado para demos/E2E (RAVEN_E2E_PLAN); null fuera de RAVEN_E2E.
      e2ePlan?: string | null
    }
    // Test-only hook, installed by App.tsx only when appFlags.e2eBypass is
    // true. Lets Playwright link a repo to the active tab without driving
    // the native OS folder-picker dialog (window.dialog.openFolder), which
    // is not automatable.
    __e2e_linkRepo?: (path: string) => void
    windowControls: {
      send: (action: 'minimize' | 'maximize' | 'close') => void
      onShown: (callback: () => void) => void
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
      // Cold-launch pull: consumes any deep-link URL buffered before the
      // renderer was ready (see electron/preload.ts's deeplink:consume call).
      consumePendingDeepLink: () => Promise<string | null>
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
      // expectedRemote (optional): validates the picked folder's `origin`
      // remote matches before accepting it — prevents linking the wrong
      // repo's folder (see electron/main.ts's dialog:pickRepoFolder handler).
      pickRepoFolder: (expectedRemote?: string) => Promise<string | null>
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
    localPaths: {
      get: (repoId: string) => Promise<string | null>
      set: (repoId: string, path: string) => Promise<void>
      delete: (repoId: string) => Promise<void>
      getAll: () => Promise<Record<string, string>>
      getMigrationFlag: (key: string) => Promise<string | null>
      setMigrationFlag: (key: string, value: string) => Promise<void>
    }
    cli: {
      check: (cmd: string) => Promise<{ found: boolean; path: string }>
      install: (aiType: string) => Promise<{ state: 'done' | 'failed' | 'cancelled'; log: string }>
      cancelInstall: (aiType: string) => Promise<boolean>
      onInstallProgress: (cb: (data: { aiType: string; line: string }) => void) => () => void
    }
    shells: {
      detect: () => Promise<ShellInfo[]>
    }
    worktree: {
      list: (repoPath: string) => Promise<
        | { ok: true; worktrees: WorktreeMeta[] }
        | { ok: false; error: string }
      >
      create: (opts: { repoPath: string; branch: string; fromBranch?: string; path?: string; presetId?: string }) => Promise<WorktreeMeta>
      remove: (worktreePath: string) => Promise<void>
      get: (worktreePath: string) => Promise<WorktreeMeta | null>
      setPreset: (worktreePath: string, presetId: string | null) => Promise<void>
      copyFiles: (
        srcRepoPath: string,
        dstWorktreePath: string,
        files: string[],
      ) => Promise<{ copied: number; skipped: number; errors: string[] }>
      listAll: () => Promise<
        | { ok: true; worktrees: WorktreeMeta[] }
        | { ok: false; error: string }
      >
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
      listForWorkspace: (opts: { repoPath?: string; repoPaths?: string[]; paneIds?: string[] }) => Promise<number[]>
      byPane: (opts: { panes: { paneId: string; repoPath?: string | null }[] }) => Promise<Record<string, number[]>>
    }
    diff: {
      get: (worktreePath: string, base?: string) => Promise<DiffResult>
    }
    fs: {
      readFile: (worktreePath: string, relPath: string) => Promise<{ ok: true; content: string } | { ok: false; error: string }>
      writeFile: (worktreePath: string, relPath: string, content: string) => Promise<{ ok: true } | { ok: false; error: string }>
      listDir: (worktreePath: string, relPath: string) => Promise<{ ok: true; entries: DirEntry[] } | { ok: false; error: string }>
      watch: (worktreePath: string, relPath: string, opts?: { depth?: number }) => Promise<{ ok: true } | { ok: false; error: string }>
      unwatch: (worktreePath: string, relPath: string) => Promise<{ ok: true } | { ok: false; error: string }>
      onChanged: (cb: (worktreePath: string, relPath: string) => void) => () => void
    }
    ideConfig: {
      import: (source: 'vscode' | 'intellij') => Promise<
        | { ok: true; options: EditorPreferences; theme?: EditorTheme; unmappedTheme?: string }
        | { ok: false; error: string }
      >
    }
    themes: {
      listInstalled: () => Promise<InstalledThemeInfo[]>
      saveInstalled: (displayName: string, theme: import('./lib/theme-registry').VSCodeThemeJson) => Promise<ThemeOpResult>
      deleteInstalled: (name: string) => Promise<{ ok: true } | { ok: false; error: string }>
      scanVSCode: () => Promise<{ ok: true; themes: ScannedThemeInfo[] } | { ok: false; error: string }>
      importVSCode: (themePath: string) => Promise<ThemeOpResult>
      searchOpenVSX: (query: string) => Promise<{ ok: true; results: OpenVSXThemeResult[] } | { ok: false; error: string }>
      installOpenVSX: (namespace: string, name: string) => Promise<{ ok: true; installed: string[] } | { ok: false; error: string }>
      loadFromFile: () => Promise<ThemeOpResult | null>
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
      // Snapshot (dataURL PNG) del contenido de un pane para el fantasma del
      // drag. kind 'browser' captura el WebContentsView nativo; 'dom' captura
      // la región `rect` de la ventana (terminal/editor). Devuelve null si falla.
      capturePane: (opts: { paneId: string; kind: 'browser' | 'dom'; dpr?: number; rect?: { x: number; y: number; width: number; height: number } }) => Promise<string | null>
    }
    settings: {
      get: () => Promise<{
        voiceLanguage?: string
        hasSeenMemoryHub?: boolean
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
    tickets: TicketsBridge
    signals: SignalsBridge
    activity: ActivityBridge
    slackMentions: SlackMentionsBridge
    notion: NotionBridge
    gcal: GcalBridge
    recipes: RecipesBridge
    automations: AutomationsBridge
    workerSpecs: WorkerSpecsBridge
    handoff: HandoffBridge
    graphTemplates: GraphTemplatesBridge
    graphRuns: GraphRunsBridge
  }
}

// === Marketplace de integraciones ===
export type PluginType = 'action' | 'panel' | 'integration'
export type PluginCategory =
  | 'comms' | 'docs' | 'pm' | 'ci' | 'design' | 'observability' | 'other'

export interface ConfigField {
  key: string
  label: string
  type: 'text' | 'password' | 'select'
  required?: boolean
  options?: { value: string; label: string }[]
  placeholder?: string
}

export interface AuthSpec {
  kind: 'oauth' | 'apiKey' | 'none'
  fields?: ConfigField[]
}

export interface MenuContribution {
  id: string          // 'slack.notify'
  label: string       // 'Notificar a Slack'
  actionId: string    // se pasa a window.pluginActions.run(pluginId, actionId, ...)
  surface: 'sidebar' | 'repoActions'
}

export interface EventHook {
  on: 'onAgentDone' | 'onWorktreeReady' | 'onPrPushed'
  actionId: string
}

export interface PluginContributions {
  menuItems?: MenuContribution[]
  events?: EventHook[]
  // paneType: diferido a slices futuros
}

export interface PluginManifest {
  id: string
  name: string
  description: string
  category: PluginCategory
  icon: string
  color: string
  type: PluginType
  // `(string & {})` keeps the 'raven' literal as an autocomplete hint while
  // still accepting any third-party publisher id (a plain `'raven' | string`
  // collapses to `string`). 'raven' = curated/built-in.
  publisher: 'raven' | (string & {})
  tier: 'free' | 'pro' | 'team-enterprise'
  comingSoon?: boolean
  auth?: AuthSpec
  configSchema?: ConfigField[]
  contributes?: PluginContributions
}

export interface InstalledPlugin {
  pluginId: string
  scope: 'personal' | 'team'
  enabled: boolean
  config: Record<string, unknown>
}
