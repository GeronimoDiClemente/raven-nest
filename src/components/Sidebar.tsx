import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import SnippetPanel from './SnippetPanel'
import CommandHistoryPanel from './CommandHistoryPanel'
import WorkspacePanel from './WorkspacePanel'
import MCPPanel from './MCPPanel'
import SettingsPanel from './SettingsPanel'
import UserMenu from './UserMenu'
import RepoActionsBar from './RepoActionsBar'
import { WorktreesSection } from './WorktreesSection'
import HubSidebarPanel, { type HubWorkspace } from './HubSidebarPanel'
import type { Plan } from '../lib/stripe'
import { useGitHub } from '../hooks/useGitHub'
import { useGitlab } from '../hooks/useGitlab'
import { LayoutId, Workspace, MAX_PANES } from '../types'
import { PRESETS } from '../layout/presets'
import { alternativesFor } from '../layout/select'
import { supabase } from '../lib/supabase'
import { terminalJoinService } from '../lib/terminalJoinService'
import { basename } from '../lib/path'
import { useGitInfo } from '../hooks/useGitInfo'
import { useFixedPopover } from '../hooks/useFixedPopover'
import { ExplorerPanel } from './ExplorerPanel'
import HubExplorerPanel, { type ExplorerRoot } from './HubExplorerPanel'
import SidebarTabBar, { type SidebarTabId, REPO_TABS, HUB_TABS } from './SidebarTabBar'
import MemoriesItem from './MemoriesItem'
import PaneFilterControl from './PaneFilterControl'
import type { PaneFilter } from '../lib/pane-filter'
import type { AIType, PaneNode } from '../types'
import { AILogoStack } from './AILogoStack'
import type { UserPreferencesApi } from '../hooks/useUserPreferences'
import { ENABLE_INTEGRATIONS_ORCHESTRATION } from '../lib/releaseFlags'
import {
  Radio, Share2, LoaderCircle, Mic, MessageSquare, Monitor, Cable, TextAlignStart,
  RotateCcwClock, Waypoints, User, SquarePlus, Workflow, ChevronLeft, Menu, ChevronRight,
  Plus, Settings,
} from 'lucide-react'
import { ICON_SIZE } from '../lib/icons'

interface Props {
  expanded: boolean
  onToggle: () => void
  broadcastMode: boolean
  onBroadcastToggle: () => void
  isListening: boolean
  isTranscribing: boolean
  isModelLoading: boolean
  onMicToggle: () => void
  onNewPane: () => void
  onHistoryOpen: () => void
  onSnippetSend: (content: string) => void
  onSnippetBroadcast: (content: string) => void
  onCommandRun?: (cmd: string) => void
  onWorkspaceSave: (name: string) => void
  onWorkspaceLoad: (ws: Workspace) => void
  isWin: boolean
  isTrialActive?: boolean
  trialDaysLeft?: number
  profileLoading?: boolean
  onUpgrade?: () => void
  onPersonalOpen?: () => void
  /** Spec 2026-09-09 §4.1: Memories es hermana de Personal, no una seccion adentro ni una 4a pestana. */
  onMemoriesOpen?: () => void
  pendingInvitesCount?: number
  onIntegrationsOpen?: () => void
  onGraphBoardOpen?: () => void
  plan?: Plan
  repoPath?: string
  onRepoLink: () => void
  onRepoUnlink: () => void
  onJoinTerminal: () => void
  activeCellRepoPath?: string
  onWorktreeSelect: (worktreePath: string) => void
  onNewWorktree: () => void
  onFixCi: (repoPath: string) => void
  worktreeRefreshKey?: number
  // Layout selector (replaces the old LayoutPicker). Sidebar renders the
  // trigger; the engine in App.tsx owns the state.
  layoutId: LayoutId
  paneCount: number
  onLayoutChange: (id: LayoutId) => void
  onOpenTutorial?: (tourId: import('../tutorial/types').TourId) => void
  onFileOpen: (relPath: string) => void
  // Filtro de panes por tipo (embudo en la columna del sidebar)
  paneFilterPanes?: readonly PaneNode[]
  paneFilter?: PaneFilter
  onPaneFilterChange?: (f: PaneFilter) => void
  /** workspace-shell-design §3: aiType de TODOS los panes abiertos (todos los
   *  tabs, no solo el activo), agrupados por repoPath — App.tsx lo calcula una
   *  sola vez con groupAITypesByRepoPath y lo pasa hacia el repo row y las
   *  filas de WorktreesSection. */
  paneAITypesByPath?: Map<string, AIType[]>
  // Lifted to App.tsx (the single shared instance) — threaded through to
  // SettingsPanel. See UserPreferencesApi's doc comment for why.
  userPrefs: UserPreferencesApi
  // Hub-tab sidebar (#2/#3): swap the repo context group for a workspace builder.
  isHub?: boolean
  hubWorkspaces?: HubWorkspace[]
  onSelectWorkspace?: (tabId: string) => void
  onJumpToPane?: (tabId: string, paneId: string) => void
  onToggleTerminal?: (paneId: string) => void
  onToggleWorkspace?: (tabId: string) => void
  onNewWorkspace?: () => void
  onAddTerminalToWorkspace?: (tabId: string) => void
  // Hub Explorer multi-raíz: una raíz por workspace abierto con repo.
  hubExplorerRoots?: ExplorerRoot[]
  onOpenFileFromHub?: (tabId: string, repoPath: string, relPath: string) => void
}

export default function Sidebar({
  expanded, onToggle, broadcastMode, onBroadcastToggle,
  isListening, isTranscribing, isModelLoading, onMicToggle,
  onNewPane, onHistoryOpen,
  onSnippetSend, onSnippetBroadcast, onCommandRun, onWorkspaceSave, onWorkspaceLoad, isWin,
  isTrialActive, trialDaysLeft, profileLoading, onUpgrade, onPersonalOpen, onMemoriesOpen, onIntegrationsOpen, onGraphBoardOpen, pendingInvitesCount = 0, plan, repoPath, onRepoLink, onRepoUnlink, onJoinTerminal,
  activeCellRepoPath, onWorktreeSelect, onNewWorktree, onFixCi, worktreeRefreshKey,
  layoutId, paneCount, onLayoutChange, onOpenTutorial, onFileOpen, userPrefs,
  paneFilterPanes, paneFilter, onPaneFilterChange, paneAITypesByPath,
  isHub = false, hubWorkspaces, onSelectWorkspace, onJumpToPane, onToggleTerminal, onToggleWorkspace, onNewWorkspace, onAddTerminalToWorkspace,
  hubExplorerRoots, onOpenFileFromHub,
}: Props) {
  const { branch, githubUrl, isDirty } = useGitInfo(repoPath)
  const { githubToken } = useGitHub()
  const { gitlabToken } = useGitlab()
  const repoCi = (() => {
    if (!githubUrl) return null
    const m = githubUrl.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/)
    if (!m) return null
    const host = m[1].toLowerCase()
    const fullName = m[2]
    if (host.includes('github')) return { provider: 'github' as const, repoFullName: fullName, token: githubToken }
    if (host.includes('gitlab')) return { provider: 'gitlab' as const, repoFullName: fullName, token: gitlabToken }
    return null
  })()
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'up-to-date' | 'update-found' | 'error'>('idle')
  const [userEmail, setUserEmail] = useState('')
  const [joinOpen, setJoinOpen] = useState(false)
  const [joinInput, setJoinInput] = useState('')
  const [joinConnected, setJoinConnected] = useState(terminalJoinService.isConnected)
  const [, forceUpdate] = useState(0)
  const [moreOpen, setMoreOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<SidebarTabId>('worktrees')
  // Hub swaps Worktrees for Hub, so the remembered tab can be one this mode
  // doesn't offer — fall back to the mode's first tab.
  const tabs = isHub ? HUB_TABS : REPO_TABS
  const currentTab: SidebarTabId = (tabs as readonly SidebarTabId[]).includes(activeTab) ? activeTab : tabs[0]
  const [layoutOpen, setLayoutOpen] = useState(false)
  // Index into layoutOptions while the user is cycling with Ctrl+L. null when
  // the popover was opened by click (no active cycling — selection commits on
  // option click instead of on Ctrl release).
  const [layoutCycleIdx, setLayoutCycleIdx] = useState<number | null>(null)
  const layoutAnchorRef = useRef<HTMLDivElement>(null)
  const layoutPopoverRef = useRef<HTMLDivElement>(null)
  const layoutPopPos = useFixedPopover(layoutAnchorRef, layoutOpen, layoutPopoverRef)
  const layoutOptions = alternativesFor(paneCount)
  const layoutPreset = PRESETS[layoutId]
  // Refs for the cycle handler so the keyup listener (which references the
  // current options/cycleIdx) can read fresh values without re-attaching.
  const layoutOptionsRef = useRef(layoutOptions)
  layoutOptionsRef.current = layoutOptions
  const layoutCycleIdxRef = useRef(layoutCycleIdx)
  layoutCycleIdxRef.current = layoutCycleIdx
  const layoutIdRef = useRef(layoutId)
  layoutIdRef.current = layoutId
  const onLayoutChangeRef = useRef(onLayoutChange)
  onLayoutChangeRef.current = onLayoutChange
  const joinInputRef = useRef<HTMLInputElement>(null)
  const joinAnchorRef = useRef<HTMLDivElement>(null)
  const joinPopoverRef = useRef<HTMLDivElement>(null)
  // Track the one-shot subscribe() created when the user submits a join code so a
  // cancelled / aborted attempt doesn't leave a zombie listener inside the
  // singleton's Set forever (and so retries don't stack them up).
  const joinAttemptUnsubRef = useRef<(() => void) | null>(null)
  const joinPopPos = useFixedPopover(joinAnchorRef, joinOpen && !joinConnected, joinPopoverRef)
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? '')
    })
  }, [])

  useEffect(() => {
    return terminalJoinService.subscribe(() => {
      setJoinConnected(terminalJoinService.isConnected)
      forceUpdate(n => n + 1) // re-render to pick up isConnecting / error
    })
  }, [])

  // Drop any pending join-attempt subscription when the component unmounts —
  // otherwise the closure (referencing setJoinOpen/setJoinInput/onJoinTerminal)
  // stays pinned in the singleton's listener Set after Sidebar is gone.
  useEffect(() => {
    return () => {
      joinAttemptUnsubRef.current?.()
      joinAttemptUnsubRef.current = null
    }
  }, [])

  // Auto-close "More tools" when sidebar collapses — labels disappear so an
  // open desplegable would just show stray icons with no context.
  useEffect(() => {
    if (!expanded) setMoreOpen(false)
  }, [expanded])

  // Cmd/Ctrl+L behaviour (Cmd+Tab style):
  //   • First press: opens the popover and highlights the NEXT option.
  //   • Subsequent presses while Ctrl/Cmd is held: cycle forward.
  //   • Releasing Ctrl/Cmd: commit the highlighted option and close.
  //   • Escape: close without committing.
  // Capture phase so xterm.js (which consumes Ctrl+L for clear-screen on a
  // focused TerminalPane) doesn't swallow the keystroke.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        e.stopPropagation()
        const options = layoutOptionsRef.current
        if (options.length === 0) return
        setLayoutCycleIdx(prev => {
          if (prev == null) {
            // First press: start at the slot after the current preset (so the
            // first cycle actually moves you somewhere new, not to where you
            // already are).
            const startIdx = options.indexOf(layoutIdRef.current)
            return (startIdx + 1) % options.length
          }
          return (prev + 1) % options.length
        })
        setLayoutOpen(true)
      } else if (e.key === 'Escape' && layoutOpen) {
        setLayoutCycleIdx(null)
        setLayoutOpen(false)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      // Commit on releasing the Control/Meta key — that's the gesture's end.
      // We don't commit on L-up because the user might tap L again while
      // still holding Ctrl.
      if (e.key !== 'Control' && e.key !== 'Meta' && e.key !== 'OS') return
      const idx = layoutCycleIdxRef.current
      if (idx == null) return
      const options = layoutOptionsRef.current
      const target = options[idx]
      if (target && target !== layoutIdRef.current) onLayoutChangeRef.current(target)
      setLayoutCycleIdx(null)
      setLayoutOpen(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [layoutOpen])

  // Click-outside to close the layout popover. Mounted only while open.
  useEffect(() => {
    if (!layoutOpen) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (layoutPopoverRef.current?.contains(t)) return
      if (layoutAnchorRef.current?.contains(t)) return
      setLayoutOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [layoutOpen])

  const startJoinAttempt = (code: string) => {
    // Drop any previous pending attempt before starting a new one.
    joinAttemptUnsubRef.current?.()
    terminalJoinService.join(code)
    const unsub = terminalJoinService.subscribe(() => {
      if (terminalJoinService.isConnected) {
        unsub()
        joinAttemptUnsubRef.current = null
        setJoinOpen(false); setJoinInput(''); onJoinTerminal()
      }
    })
    joinAttemptUnsubRef.current = unsub
  }

  async function handleCheckUpdates() {
    if (updateState === 'checking') return
    setUpdateState('checking')
    const result = await window.updater.checkForUpdates()
    if (result === 'up-to-date') {
      setUpdateState('up-to-date')
      setTimeout(() => setUpdateState('idle'), 3000)
    } else if (result === 'update-found') {
      // Download starts automatically — App.tsx shows the install banner
      setUpdateState('update-found')
      setTimeout(() => setUpdateState('idle'), 4000)
    } else {
      setUpdateState('error')
      setTimeout(() => setUpdateState('idle'), 3000)
    }
  }

  // ─── Reusable inline pieces ──────────────────────────────────────────────
  const BroadcastItem = (
    <Button
      variant={broadcastMode ? 'secondary' : 'ghost'}
      size="sm"
      className={cn(
        'h-8 w-full justify-start gap-2.5 px-2.5 font-normal',
        // Button ghost no declara color de reposo (solo hover) — este proyecto
        // no tiene el preflight que shadcn da por hecho (button {color:inherit}),
        // asi que sin esto el boton mostraba el negro nativo del navegador
        // (Task 7, mismo patron que el bg-transparent de la Task 5b, pero de
        // texto). secondary ya trae su propio text-secondary-foreground.
        !broadcastMode && 'text-muted-foreground hover:text-foreground',
      )}
      onClick={onBroadcastToggle}
      title={broadcastMode ? 'Broadcast ON — click to turn off' : 'Broadcast OFF — click to turn on'}
    >
      <span className="sidebar-icon">
        <Radio size={ICON_SIZE.lg} aria-hidden />
      </span>
      <span className="sidebar-label">{broadcastMode ? 'Broadcasting' : 'Broadcast'}</span>
    </Button>
  )

  const JoinTerminalItem = (
    <div className="sidebar-item-panel" style={{ position: 'relative' }} ref={joinAnchorRef}>
      <Button
        variant={joinConnected ? 'secondary' : 'ghost'}
        size="sm"
        className={cn(
          'h-8 w-full justify-start gap-2.5 px-2.5 font-normal',
          !joinConnected && 'text-muted-foreground hover:text-foreground',
        )}
        onClick={() => {
          if (joinConnected) { onJoinTerminal() }
          else { setJoinOpen(v => !v); setTimeout(() => joinInputRef.current?.focus(), 50) }
        }}
        title={joinConnected ? 'View shared terminal' : 'Join remote terminal'}
      >
        <span className="sidebar-icon">
          <Share2 size={ICON_SIZE.lg} aria-hidden />
        </span>
        <span className="sidebar-label">{joinConnected ? `● ${terminalJoinService.code}` : 'Join Terminal'}</span>
      </Button>

      {joinOpen && !joinConnected && joinPopPos && (
        <div ref={joinPopoverRef} className="ts-panel" style={{ position: 'fixed', top: joinPopPos.top, left: joinPopPos.left, right: 'auto', zIndex: 200, width: 260 }}>
          <div className="ts-panel-header">
            <span className="text-fs font-semibold text-foreground">Join Terminal</span>
            <button className="ts-close" onClick={() => { setJoinOpen(false); setJoinInput('') }}>×</button>
          </div>
          <div className="ts-body">
            <p className="ts-desc">Enter the code shared by the host to connect to their terminal.</p>
            <input
              ref={joinInputRef}
              value={joinInput}
              onChange={e => setJoinInput(e.target.value.toUpperCase())}
              onKeyDown={e => {
                if (e.key === 'Enter' && joinInput.length >= 8) {
                  startJoinAttempt(joinInput.trim())
                }
                if (e.key === 'Escape') { setJoinOpen(false); setJoinInput('') }
              }}
              maxLength={8}
              placeholder="Enter code…"
              autoFocus
              // fontSize: la escala no tiene un escalon en 20px — --fs-xl es 17,
              // --fs-2xl es 21. Se redondea al mas cercano (21, 1px de diferencia)
              // en vez de dejar un literal fuera de escala (Task 7).
              className="block w-full box-border bg-popover border border-border rounded-md text-foreground text-fs-2xl font-bold px-3 py-2 tracking-[4px] text-center uppercase mb-2.5 outline-none"
            />
            {terminalJoinService.error && (
              <p className="text-destructive text-fs-xs mb-2">{terminalJoinService.error}</p>
            )}
            <button
              disabled={joinInput.length < 8 || terminalJoinService.isConnecting}
              onClick={() => {
                startJoinAttempt(joinInput.trim())
              }}
              className={cn(
                'w-full border-none rounded-md py-2 text-fs font-semibold',
                joinInput.length >= 8
                  ? 'bg-primary text-primary-foreground cursor-pointer'
                  : 'bg-popover text-muted-foreground cursor-default',
              )}
            >
              {terminalJoinService.isConnecting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </div>
      )}
    </div>
  )

  const VoiceItem = (
    <Button
      variant={isListening ? 'secondary' : 'ghost'}
      size="sm"
      className={cn(
        'h-8 w-full justify-start gap-2.5 px-2.5 font-normal',
        !isListening && 'text-muted-foreground hover:text-foreground',
        (isTranscribing || isModelLoading) && 'cursor-default opacity-70',
      )}
      onClick={(isTranscribing || isModelLoading) ? undefined : onMicToggle}
      title={isListening ? 'Click or press F5 to stop' : isTranscribing ? 'Processing…' : isModelLoading ? 'Loading voice model…' : 'Click or press F5 to speak'}
    >
      <span className="sidebar-icon">
        {(isTranscribing || isModelLoading) ? (
          <LoaderCircle size={ICON_SIZE.lg} style={{ animation: 'spin 1s linear infinite' }} aria-hidden />
        ) : (
          <Mic size={ICON_SIZE.lg} aria-hidden />
        )}
      </span>
      <span className="sidebar-label">
        {isListening ? 'Listening…' : isTranscribing ? 'Processing…' : isModelLoading ? 'Loading…' : 'Voice'}
      </span>
    </Button>
  )

  const ConversationHistoryItem = (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 w-full justify-start gap-2.5 px-2.5 font-normal text-muted-foreground hover:text-foreground"
      onClick={onHistoryOpen}
      title="Conversation history"
    >
      <span className="sidebar-icon">
        <MessageSquare size={ICON_SIZE.lg} aria-hidden />
      </span>
      <span className="sidebar-label">History</span>
    </Button>
  )

  const WorkspacesItem = (
    <div className="sidebar-item sidebar-item-panel">
      <span className="sidebar-icon">
        <Monitor size={ICON_SIZE.lg} aria-hidden />
      </span>
      <span className="sidebar-label">Saved layouts</span>
      <WorkspacePanel onSave={onWorkspaceSave} onLoad={onWorkspaceLoad} onRequireUpgrade={onUpgrade} />
    </div>
  )

  const MCPItem = (
    <div className="sidebar-item sidebar-item-panel">
      <span className="sidebar-icon">
        <Cable size={ICON_SIZE.lg} aria-hidden />
      </span>
      <span className="sidebar-label">MCP</span>
      <MCPPanel repoPath={repoPath} />
    </div>
  )

  const SnippetsItem = (
    <div className="sidebar-item sidebar-item-panel">
      <span className="sidebar-icon">
        <TextAlignStart size={ICON_SIZE.lg} aria-hidden />
      </span>
      <span className="sidebar-label">Snippets</span>
      <SnippetPanel onSend={onSnippetSend} onBroadcast={onSnippetBroadcast} onRequireUpgrade={onUpgrade} />
    </div>
  )

  const CommandHistoryItem = (
    <div className="sidebar-item sidebar-item-panel">
      <span className="sidebar-icon">
        <RotateCcwClock size={ICON_SIZE.lg} aria-hidden />
      </span>
      <span className="sidebar-label">Cmd Hist.</span>
      <CommandHistoryPanel onRun={onCommandRun} />
    </div>
  )

  // Layout selector — lives inside "More tools". Icon is outlined (transparent)
  // to match the other tools and avoid the solid white square the '1' preset
  // used to render as. Clicking toggles the popover; Ctrl/⌘+L cycles.
  const LayoutItem = (
    <div
      className="sidebar-item sidebar-item-panel"
      ref={layoutAnchorRef}
      style={{ cursor: 'pointer' }}
      onClick={() => setLayoutOpen(v => !v)}
      title={`Layout: ${layoutPreset.label} (${isWin ? 'Ctrl+L' : '⌘L'})`}
    >
      <span className="sidebar-icon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d={layoutPreset.icon} stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </span>
      <span className="sidebar-label">Layout</span>
    </div>
  )

  // The repo row. Expanded it is the menu's title (first row of the same box
  // as the tabs, with a chevron for "this is where you swap repo"); the branch
  // and the CI bar moved into the Worktrees tab, the only place they mean
  // something. On the collapsed rail it stays the plain icon row it always was,
  // branch included.
  const repoRow = (showBranch: boolean) => (
    <div
      className="sidebar-item sidebar-repo"
      title={repoPath ?? 'Link repo to this tab'}
      onClick={onRepoLink}
      style={{ cursor: 'pointer' }}
    >
      <span className="sidebar-icon">
        <Waypoints size={ICON_SIZE.lg} aria-hidden />
      </span>
      {repoPath ? (
        <div className="sidebar-repo-info">
          <div className="sidebar-repo-row">
            <span className="sidebar-label sidebar-repo-name text-ok">{basename(repoPath)}</span>
            {expanded && (
              <AILogoStack aiTypes={paneAITypesByPath?.get(repoPath) ?? []} size={12} />
            )}
            {expanded && <span className="sidebar-repo-chevron" aria-hidden="true">▾</span>}
            {expanded && githubUrl && (
              <button
                className="sidebar-github-btn"
                title="Open on GitHub"
                onClick={e => { e.stopPropagation(); window.electronShell.openExternal(githubUrl!) }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
              </button>
            )}
            {expanded && (
              <button className="sidebar-repo-unlink" onClick={e => { e.stopPropagation(); onRepoUnlink() }} title="Unlink repo">×</button>
            )}
          </div>
          {showBranch && branch && (
            <span className={cn('sidebar-branch-badge font-mono text-fs-xs', isDirty && 'dirty')}>
              {branch}{isDirty ? ' ●' : ''}
            </span>
          )}
        </div>
      ) : (
        <button className="sidebar-label sidebar-repo-link">Link repo</button>
      )}
    </div>
  )

  // Branch + last CI run: the head of the Worktrees tab, right above the list
  // of worktrees they describe.
  const WorktreesHeader = (
    <>
      {branch && (
        <div className={cn('sidebar-tab-branch font-mono text-fs-xs', isDirty && 'dirty')} title={branch}>
          {branch}{isDirty ? ' ●' : ''}
        </div>
      )}
      {repoPath && repoCi && (
        <div style={{ padding: '0 8px 4px' }}>
          <RepoActionsBar
            repoFullName={repoCi.repoFullName}
            provider={repoCi.provider}
            token={repoCi.token}
            branch={branch ?? undefined}
          />
        </div>
      )}
    </>
  )

  // One door for everything that is yours: your repos, each team's repos, and
  // your pending invites. Local features are free on every plan (corte comercial
  // 2026-09-02) so this opens the same way regardless of plan.
  const PersonalItem = (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 w-full justify-start gap-2.5 px-2.5 font-normal text-muted-foreground hover:text-foreground"
      onClick={onPersonalOpen}
      title={pendingInvitesCount > 0
        ? `Personal — ${pendingInvitesCount} pending invite${pendingInvitesCount === 1 ? '' : 's'}`
        : 'Personal'}
    >
      <span className="sidebar-icon" style={{ position: 'relative' }}>
        <User size={ICON_SIZE.lg} aria-hidden />
        {pendingInvitesCount > 0 && (
          // background/color -> bg-destructive/text-destructive-foreground (blanco puro,
          // match exacto); el radio (7 sobre una caja de 14px) -> rounded-full (mismo
          // resultado visual, mas robusto); el tamano de fuente (9px) -> text-fs-2xs
          // (10px, el escalon mas chico definido — 1px de diferencia, no hay uno exacto).
          // El boxShadow usaba una var inexistente (bg-primary, que no esta definida en
          // ningun lado) con un fallback que coincidia con --background; se corrige a la
          // referencia real.
          <span
            aria-label={`${pendingInvitesCount} pending invites`}
            className="absolute flex items-center justify-center bg-destructive text-destructive-foreground rounded-full text-fs-2xs font-bold"
            style={{
              top: -4, right: -6, minWidth: 14, height: 14,
              padding: '0 3px', lineHeight: 1,
              boxShadow: '0 0 0 1.5px var(--background)',
            }}
          >
            {pendingInvitesCount > 9 ? '9+' : pendingInvitesCount}
          </span>
        )}
      </span>
      <span className="sidebar-label">Personal</span>
    </Button>
  )

  // Shared between the collapsed "More tools" flyout and the expanded
  // "Tools" tab (see SidebarTabBar) — same items, two different containers.
  const ToolsListContent = (
    <>
      {LayoutItem}
      {/* Filtro de panes — junto al layout selector: ambos son
          controles de vista del workspace (pedido de Bautista). */}
      {onPaneFilterChange && (
        <PaneFilterControl
          panes={paneFilterPanes ?? []}
          filter={paneFilter ?? 'all'}
          onChange={onPaneFilterChange}
          expanded={expanded}
        />
      )}
      {SnippetsItem}
      {WorkspacesItem}
      {MCPItem}
      {VoiceItem}
      {BroadcastItem}
      {JoinTerminalItem}
      {/* Integrations y Orchestration eran filas fijas de la sidebar vieja. Con las
          pestanas viven en Tools, que es la lista que comparten el flyout colapsado y
          la pestana: asi siguen alcanzables en los dos modos.
          No salen en esta release (decision del usuario, 2026-09-10): el hito 1 de
          integrations esta terminado y commiteado pero el resto del backlog
          (docs/INTEGRATIONS_ORCA_BACKLOG.md) no. ENABLE_INTEGRATIONS_ORCHESTRATION
          (src/lib/releaseFlags.ts) solo apaga el punto de entrada — nada de esto se
          borro. Para mostrarlas de nuevo, poner esa constante en `true`. */}
      {ENABLE_INTEGRATIONS_ORCHESTRATION && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start gap-2.5 px-2.5 font-normal text-muted-foreground hover:text-foreground"
            onClick={onIntegrationsOpen}
            title="Integrations"
          >
            <span className="sidebar-icon">
              <SquarePlus size={ICON_SIZE.lg} aria-hidden />
            </span>
            <span className="sidebar-label">Integrations</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start gap-2.5 px-2.5 font-normal text-muted-foreground hover:text-foreground"
            onClick={onGraphBoardOpen}
            title="Orchestration"
          >
            <span className="sidebar-icon">
              <Workflow size={ICON_SIZE.lg} aria-hidden />
            </span>
            <span className="sidebar-label">Orchestration</span>
          </Button>
        </>
      )}
      {ConversationHistoryItem}
      {CommandHistoryItem}
    </>
  )

  return (
    <div className={cn(`sidebar${expanded ? ' expanded' : ''}`, 'bg-card border-r border-border')}>

      {/* Toggle */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-full justify-start gap-2.5 px-2.5 font-normal mb-1 text-muted-foreground hover:text-foreground"
        onClick={onToggle}
        title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-expanded={expanded}
      >
        <span className="sidebar-icon">
          {expanded ? (
            <ChevronLeft size={ICON_SIZE.lg} aria-hidden />
          ) : (
            <Menu size={ICON_SIZE.lg} aria-hidden />
          )}
        </span>
      </Button>

      <div className="sidebar-scroll">
        {/* ── 1. COLLAPSED RAIL: repo (normal) or workspaces (Hub), same as
             before — the rail has no room for tabs. ── */}
        {!expanded && !isHub && repoRow(true)}

        {!expanded && isHub && onSelectWorkspace && onJumpToPane && onToggleTerminal && onToggleWorkspace && onNewWorkspace && onAddTerminalToWorkspace && (
          <HubSidebarPanel
            workspaces={hubWorkspaces ?? []}
            expanded={false}
            onSelectWorkspace={onSelectWorkspace}
            onJumpToPane={onJumpToPane}
            onToggleTerminal={onToggleTerminal}
            onToggleWorkspace={onToggleWorkspace}
            onNewWorkspace={onNewWorkspace}
            onAddTerminal={onAddTerminalToWorkspace}
          />
        )}

        {/* ── 2. EXPANDED: one menu box — repo row as its title, then the
             tabs. Hub gets the same menu with Hub in place of Worktrees. ── */}
        {expanded && (
          <>
            <SidebarTabBar
              tabs={tabs}
              active={currentTab}
              onChange={setActiveTab}
              footer={isHub ? undefined : repoRow(false)}
            />
            <div className="sidebar-tab-panel">
              {currentTab === 'worktrees' && (
                <div className="sidebar-worktrees-wrap">
                  {WorktreesHeader}
                  <WorktreesSection
                    repoPath={repoPath ?? null}
                    activeRepoPath={activeCellRepoPath}
                    onSelect={onWorktreeSelect}
                    onNewClick={onNewWorktree}
                    onFixCi={onFixCi}
                    refreshKey={worktreeRefreshKey}
                    onStartTutorial={onOpenTutorial ? () => onOpenTutorial('worktrees') : undefined}
                    paneAITypesByPath={paneAITypesByPath}
                  />
                </div>
              )}
              {currentTab === 'hub' && onSelectWorkspace && onJumpToPane && onToggleTerminal && onToggleWorkspace && onNewWorkspace && onAddTerminalToWorkspace && (
                <div className="sidebar-hub-wrap">
                  <HubSidebarPanel
                    workspaces={hubWorkspaces ?? []}
                    expanded
                    onSelectWorkspace={onSelectWorkspace}
                    onJumpToPane={onJumpToPane}
                    onToggleTerminal={onToggleTerminal}
                    onToggleWorkspace={onToggleWorkspace}
                    onNewWorkspace={onNewWorkspace}
                    onAddTerminal={onAddTerminalToWorkspace}
                  />
                </div>
              )}
              {currentTab === 'explorer' && (
                <div className="sidebar-explorer-wrap">
                  {isHub ? (
                    <HubExplorerPanel roots={hubExplorerRoots ?? []} onOpenFile={onOpenFileFromHub ?? (() => {})} />
                  ) : (
                    <ExplorerPanel worktreePath={activeCellRepoPath ?? null} onFileOpen={onFileOpen} />
                  )}
                </div>
              )}
              {currentTab === 'tools' && (
                <div className="sidebar-tab-tools-list">
                  {ToolsListContent}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── 3. COLLAPSED ICON RAIL — unchanged: More tools stays an icon
             row, not a tab. ── */}
        {!expanded && (
          <>
            <Separator className="my-1.5 mx-2" />

            <div className={`sidebar-more${moreOpen ? ' open' : ''}`}>
              <Button
                variant={moreOpen ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'h-8 w-full justify-start gap-2.5 px-2.5 font-normal',
                  !moreOpen && 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setMoreOpen(v => !v)}
                title={moreOpen ? 'Hide more tools' : 'Show more tools'}
              >
                <span className="sidebar-icon">
                  <ChevronRight size={ICON_SIZE.lg} style={{ transform: moreOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 150ms ease' }} aria-hidden />
                </span>
                <span className="sidebar-label">More tools</span>
              </Button>

              {moreOpen && (
                <div className="sidebar-more-list">
                  {ToolsListContent}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── 4.5. LAYOUT SELECTOR — trigger now lives inside "More tools"
             (see LayoutItem). Only the popover renders here (position:fixed,
             anchored to the LayoutItem). ── */}
        {layoutOpen && layoutPopPos && (
          <div
            ref={layoutPopoverRef}
            className="layout-selector-popover"
            style={{ position: 'fixed', top: layoutPopPos.top, left: layoutPopPos.left, zIndex: 200 }}
          >
            <div className="layout-selector-title">
              Layout — {paneCount} pane{paneCount === 1 ? '' : 's'}
            </div>
            <div className="layout-selector-grid">
              {layoutOptions.map((id, i) => {
                const preset = PRESETS[id]
                const active = id === layoutId
                const cycling = layoutCycleIdx === i
                return (
                  <button
                    key={id}
                    className={`layout-selector-option${active ? ' active' : ''}${cycling ? ' cycling' : ''}`}
                    onClick={() => { onLayoutChange(id); setLayoutCycleIdx(null); setLayoutOpen(false) }}
                    title={preset.label}
                  >
                    <svg viewBox="0 0 16 16" fill="none">
                      <path d={preset.icon} stroke="currentColor" strokeWidth="1.3" />
                    </svg>
                    <span>{preset.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── 5. NEW TERMINAL (acción primaria; oculto al tope) ── */}
        {!isHub && paneCount < MAX_PANES && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start gap-2.5 px-2.5 font-normal text-foreground hover:text-primary"
            onClick={onNewPane}
            title={`New terminal (${isWin ? 'Ctrl+T' : '⌘T'})`}
          >
            <span className="sidebar-icon">
              <Plus size={ICON_SIZE.lg} aria-hidden />
            </span>
            <span className="sidebar-label">New Terminal</span>
          </Button>
        )}
      </div>{/* /.sidebar-scroll */}

      {/* Personal — the one door for repos, teams and pending invites. Lives
          outside the scroll area and the tabs so it renders the same way in
          every mode (expanded/collapsed, repo/Hub sidebar) directly above
          the user row. */}
      {PersonalItem}

      {/* Memories — hermana de Personal (spec §4.1). Fuera del scroll y de las pestanas por
          la misma razon que Personal: las 3 pestanas son del repo abierto, y esto es de la
          cuenta. */}
      {onMemoriesOpen && <MemoriesItem expanded={expanded} onOpen={onMemoriesOpen} />}

      {/* User menu — hidden while loading to avoid flash */}
      {!profileLoading && (
        <UserMenu
          plan={plan ?? null}
          isTrialActive={!!isTrialActive}
          trialDaysLeft={trialDaysLeft ?? 0}
          onUpgrade={onUpgrade ?? (() => {})}
          expanded={expanded}
        />
      )}

      {/* Settings — always at the bottom */}
      <div className="sidebar-item sidebar-item-settings">
        <span className="sidebar-icon">
          <Settings size={ICON_SIZE.lg} aria-hidden />
        </span>
        <span className="sidebar-label">Settings</span>
        <SettingsPanel
          updateState={updateState}
          onCheckUpdates={handleCheckUpdates}
          userEmail={userEmail}
          activeRepoPath={activeCellRepoPath}
          onOpenTutorial={onOpenTutorial}
          userPrefs={userPrefs}
          onFileOpen={onFileOpen}
          onOpenMemories={onMemoriesOpen}
        />
      </div>

    </div>
  )
}
