import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import {
  PaneNode, AIType, AI_CONFIG, SessionData, SessionPane, Workspace,
  WorkspaceTab, LayoutId, MAX_PANES, EditorTab,
} from './types'
import { PaneLayoutEngine } from './components/PaneLayoutEngine'
import { defaultLayoutFor, hubLayoutFor, mapLegacyToPreset } from './layout/select'
import { swap } from './layout/swap'
import { getPreset } from './layout/presets'
import TerminalPane from './components/TerminalPane'
import BrowserCell from './components/BrowserCell'
import { EditorPane } from './components/EditorPane'
import { PaneErrorBoundary } from './components/PaneErrorBoundary'
import NewPaneDialog from './components/NewPaneDialog'
import TabBar from './components/TabBar'
import { PortsBanner } from './components/PortsBanner'
import ConfirmDialog from './components/ConfirmDialog'
import { shouldConfirmTabClose } from './lib/tab-close'
import ConversationSidebar from './components/ConversationSidebar'
import Sidebar from './components/Sidebar'
import { NewWorktreeModal } from './components/NewWorktreeModal'
import { QuickWorktreePalette } from './components/QuickWorktreePalette'
import { DiffViewerPanel } from './components/DiffViewerPanel'
import GlobalSearch from './components/GlobalSearch'
import CommandPalette from './components/CommandPalette'
import HubOverlay from './components/HubOverlay'
import HubWorkspace from './components/HubWorkspace'
import { useHubActivity } from './hub-activity'
import { focusTerminal } from './terminal-registry'
import logoUrl from './assets/logo.png'
import { useProfile } from './hooks/useProfile'
import { PLAN_LIMITS } from './lib/stripe'
import { broadcastTargets, isAgentPane } from './lib/broadcast'
import { moveTabAcrossWorkspaces, openFileInPane, splitEditorTabFromHub } from './lib/editor-tab-move'
import { dropTabBuffer } from './lib/editor-buffer-handoff'
import UpgradeModal from './components/UpgradeModal'
import TeamsWorkspace from './components/TeamsWorkspace'
import MyReposPanel from './components/MyReposPanel'
import { useGitHub } from './hooks/useGitHub'
import { usePendingInvitesCount } from './hooks/usePendingInvitesCount'
import { useSpeechRecognition } from './hooks/useSpeechRecognition'
import { useSettings } from './hooks/useSettings'
import { matchesBinding, formatBinding } from './lib/keybindings'
import { WORKTREE_DRAG_MIME } from './lib/dragTypes'
import { useUserPreferences } from './hooks/useUserPreferences'
import SharedTerminalViewer from './components/SharedTerminalViewer'
import { terminalShareService } from './lib/terminalShareService'
import ResourceBar from './components/ResourceBar'
import { useLocalPathsMigration } from './hooks/useLocalPathsMigration'
import type { MetricsPaneInput } from './types'
import { OnboardingTour } from './tutorial/OnboardingTour'
import { getTour } from './tutorial/registry'


let paneCounter = 0
const generateId = () => `pane-${++paneCounter}-${Date.now()}`


export default function App() {
  const generateTabId = () => `tab-${Date.now()}`

  const initialTabId = useRef(`tab-${Date.now()}`).current
  const [tabs, setTabs] = useState<WorkspaceTab[]>([{
    id: initialTabId,
    name: 'Workspace',
    layoutId: '1',
    panes: [],
  }])
  const [activeTabId, setActiveTabId] = useState<string>(initialTabId)
  const [confirmClose, setConfirmClose] = useState<{ tabId: string; name: string; isHub?: boolean } | null>(null)

  // Derive active tab data
  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0]
  const panes = activeTab.panes
  const panesRef = useRef(panes)
  panesRef.current = panes

  const updateActiveTab = useCallback((updater: (tab: WorkspaceTab) => WorkspaceTab) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? updater(t) : t))
  }, [activeTabId])

  const [addingPane, setAddingPane] = useState<null | { worktreePath?: string }>(null)
  // Mirror addingPane in a ref so addPane reads the freshest value without
  // depending on a closure that React may not have updated yet — the dialog
  // sometimes captures the previous addPane closure where worktreePath is null.
  const addingPaneRef = useRef<null | { worktreePath?: string }>(null)
  addingPaneRef.current = addingPane
  const [zoomedPaneId, setZoomedPaneId] = useState<string | null>(null)
  const [zoomingOut, setZoomingOut] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [broadcastMode, setBroadcastMode] = useState(false)
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null)
  const [panePorts, setPanePorts] = useState<Record<string, number[]>>({})
  const focusedPaneIdRef = useRef<string | null>(null)
  const zoomedPaneIdRef = useRef<string | null>(null)
  zoomedPaneIdRef.current = zoomedPaneId

  const activeCellRepoPath = (() => {
    const focusedId = focusedPaneIdRef.current
    if (!focusedId) return activeTab.repoPath
    const pane = activeTab.panes.find(p => p.id === focusedId)
    return pane?.repoPath ?? activeTab.repoPath
  })()

  const [convSidebarOpen, setConvSidebarOpen] = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [hubOpen, setHubOpen] = useState(false)
  const hubOpenRef = useRef(false)
  hubOpenRef.current = hubOpen
  const hubPrevFocusRef = useRef<string | null>(null)
  // Panes currently rendered in the Hub (curated subset), for drag-reorder.
  const hubPanesRef = useRef<PaneNode[]>([])
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem('nest-font-size')
    return saved ? parseInt(saved, 10) : 13
  })

  // Activity tracking: tabId -> Set of paneIds with recent activity
  const [tabActivity, setTabActivity] = useState<Map<string, Set<string>>>(new Map())

  // Busy state: paneId -> boolean
  const [busyPanes, setBusyPanes] = useState<Set<string>>(new Set())
  const activePanes = useHubActivity()

  const handleBusyChange = useCallback((paneId: string, busy: boolean) => {
    setBusyPanes(prev => {
      const next = new Set(prev)
      if (busy) next.add(paneId)
      else next.delete(paneId)
      return next
    })
  }, [])

  const handlePaneActivity = useCallback((paneId: string, active: boolean) => {
    setTabActivity(prev => {
      const next = new Map(prev)
      const tabSet = new Set(next.get(activeTabId) ?? new Set<string>())
      if (active) tabSet.add(paneId)
      else tabSet.delete(paneId)
      next.set(activeTabId, tabSet)
      return next
    })
  }, [activeTabId])

  // Auto-clear activity indicators after 3s. Only return a new Map when at
  // least one tab had non-empty activity that got cleared — otherwise every
  // consumer of `tabActivity` re-renders every 3s for nothing (TabBar, etc.)
  // when all tabs are already idle.
  useEffect(() => {
    const interval = setInterval(() => {
      setTabActivity(prev => {
        let changed = false
        const next = new Map(prev)
        for (const [tabId, panes] of next) {
          if (panes.size > 0) {
            next.set(tabId, new Set())
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  // Per-pane port poll. ports:byPane attributes each listening process to
  // the pane that owns it via PID tree → PPID → cwd (3 fallbacks), so a
  // dev server launched detached by Claude/OpenCode still maps to one
  // specific pane instead of broadcasting to every pane in the workspace.
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const livePanes = panesRef.current.filter(p => p.aiType !== 'browser')
        if (livePanes.length === 0) {
          if (!cancelled) setPanePorts({})
          return
        }
        const result = await window.port.byPane({
          panes: livePanes.map(p => ({ paneId: p.id, repoPath: p.repoPath ?? null })),
        })
        if (cancelled) return
        setPanePorts(result)
      } catch (err) {
        // IPC failures (handler throws, koffi crash, netstat timeout) bubble
        // up here. Without this catch the rejection becomes an unhandled
        // promise — the setInterval keeps firing but chips silently freeze
        // on the last successful tick. Clear the state so the user can tell
        // attribution is currently broken instead of seeing stale data.
        console.warn('[App] port poll failed', err instanceof Error ? err.message : err)
        if (!cancelled) setPanePorts({})
      }
    }
    tick()
    const handle = setInterval(tick, 5000)
    return () => { cancelled = true; clearInterval(handle) }
  }, [])

  const { plan, isTrialActive, trialDaysLeft, loading: profileLoading } = useProfile()
  const planLimits = PLAN_LIMITS[plan]
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [teamsOpen, setTeamsOpen] = useState(false)
  const { count: pendingInvitesCount, refresh: refreshPendingInvitesCount } = usePendingInvitesCount()
  const [myReposOpen, setMyReposOpen] = useState(false)
  const [showJoinViewer, setShowJoinViewer] = useState(false)
  const [joinRequest, setJoinRequest] = useState<{ paneId: string; paneTitle: string } | null>(null)
  const { githubToken, githubLogin, connectGitHub } = useGitHub()

  const userPrefs = useUserPreferences()

  useLocalPathsMigration()

  // Sync fontSize from Supabase once loaded
  useEffect(() => {
    if (userPrefs.loaded && userPrefs.prefs.ui_settings.fontSize != null) {
      setFontSize(userPrefs.prefs.ui_settings.fontSize)
    }
  }, [userPrefs.loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const { settings } = useSettings()
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const { isListening, isTranscribing, isModelLoading, toggle: toggleListening } = useSpeechRecognition(
    useCallback((text: string) => {
      const paneId = focusedPaneIdRef.current
      if (paneId) window.pty.write(paneId, text)
    }, []),
    settings.voiceLanguage ?? 'es'
  )

  const [updateStatus, setUpdateStatus] = useState<{ type: 'downloading' | 'ready' | 'error', msg?: string } | null>(null)

  // Auto-updater listener
  useEffect(() => {
    if (!window.updater) return
    window.updater.onStatus((status, msg) => setUpdateStatus({ type: status, msg }))
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )


  const addPane = useCallback((
    aiType: AIType, accountName: string, accountDir: string, borderColor: string,
    cmd: string, customLabel?: string, customColor?: string, shellId?: string,
    initial?: Partial<Pick<PaneNode, 'editorTabs' | 'activeEditorTabPath' | 'repoPath'>>,
  ) => {
    if (panesRef.current.length >= MAX_PANES) {
      setAddingPane(null)
      return
    }
    if (panesRef.current.length >= planLimits.maxPanes) {
      // Plan cap (e.g. Free is 3) — offer upgrade rather than silently no-op.
      setAddingPane(null)
      setShowUpgrade(true)
      return
    }
    // A Hub tab owns no terminals of its own (HubView filters isHub tabs out
    // of the grid). Pushing a pane onto it would create an invisible,
    // unclosable pane, so route the new terminal into a fresh workspace.
    const activeNow = tabsRef.current.find(t => t.id === activeTabIdRef.current)
    if (activeNow?.isHub) {
      const newTabId = generateTabId()
      const pane: PaneNode = {
        id: generateId(), aiType, accountName, accountDir, borderColor, cmd,
        customLabel, customColor, shellId,
        repoPath: addingPaneRef.current?.worktreePath,
        // Sin el spread, un pane de editor creado desde el Hub perdía sus
        // editorTabs iniciales y nacía cascarón (finding del review).
        ...initial,
      }
      setTabs(prev => [...prev, { id: newTabId, name: 'Workspace', layoutId: '1', panes: [pane] }])
      setActiveTabId(newTabId)
      setAddingPane(null)
      return
    }
    const worktreePath = addingPaneRef.current?.worktreePath
    updateActiveTab(t => {
      const pane: PaneNode = {
        id: generateId(), aiType, accountName, accountDir, borderColor, cmd,
        customLabel, customColor, shellId,
        repoPath: worktreePath ?? t.repoPath,
        ...initial,
      }
      const nextPanes = [...t.panes, pane]
      // Promote layoutId if current preset is full and there's a default for the
      // new size. When the layout changes, clear splitRatios — the persisted
      // weights belong to the old tree shape and would apply to the wrong number
      // of children, leaving slots at undefined sizes (visible as a degenerate
      // sliver pane).
      const currentSlots = getPreset(t.layoutId).slotCount
      const promoted = nextPanes.length > currentSlots
      const layoutId: LayoutId = promoted ? defaultLayoutFor(nextPanes.length) : t.layoutId
      return promoted
        ? { ...t, panes: nextPanes, layoutId, splitRatios: {} }
        : { ...t, panes: nextPanes, layoutId }
    })
    setAddingPane(null)
  }, [updateActiveTab, planLimits.maxPanes])

  const handleRepoLink = useCallback(async () => {
    try {
      const path = await window.dialog.openFolder()
      if (!path) return

      // Push cd into running plain shells so the cwd updates without restart.
      // AI agent panes are left alone — sending keystrokes mid-session would be
      // disruptive; their cwd will pick up the new repoPath on the next Restart.
      const isWin = window.platform.isWin
      const quoted = isWin
        ? `'${path.replace(/'/g, "''")}'`
        : `'${path.replace(/'/g, "'\\''")}'`
      const cdCmd = `${isWin ? 'Set-Location' : 'cd'} ${quoted}\r`
      for (const p of panesRef.current) {
        if (p.cmd === '' && await window.pty.exists(p.id)) {
          window.pty.write(p.id, cdCmd)
        }
      }

      updateActiveTab(t => ({
        ...t,
        repoPath: path,
        panes: t.panes.map(p => ({ ...p, repoPath: path })),
      }))
    } catch (err) {
      console.error('handleRepoLink error:', err)
    }
  }, [updateActiveTab])

  const handleRepoUnlink = useCallback(() => {
    updateActiveTab(t => ({
      ...t,
      repoPath: undefined,
      panes: t.panes.map(p => ({ ...p, repoPath: undefined })),
    }))
  }, [updateActiveTab])

  // E2E-only bypass for handleRepoLink's native folder dialog (not
  // automatable via Playwright). Mirrors the tab-update half of
  // handleRepoLink; skips the pty cd-push, which is irrelevant for tests
  // that link a fresh repo before any pane exists. Gated behind the same
  // appFlags.e2eBypass flag (RAVEN_E2E=1) used for auth bypass.
  useEffect(() => {
    if (!window.appFlags?.e2eBypass) return
    window.__e2e_linkRepo = (path: string) => {
      updateActiveTab(t => ({
        ...t,
        repoPath: path,
        panes: t.panes.map(p => ({ ...p, repoPath: path })),
      }))
    }
    return () => { delete window.__e2e_linkRepo }
  }, [updateActiveTab])

  const [worktreeRefreshKey, setWorktreeRefreshKey] = useState(0)

  const handleWorktreeSelect = useCallback(async (worktreePath: string) => {
    const focusedId = focusedPaneIdRef.current

    // Push cd into running plain shells (mirror of handleRepoLink). AI panes
    // are left alone. With focus → only that cell's shell. Without focus →
    // all plain shells in the tab.
    const isWin = window.platform.isWin
    const quoted = isWin
      ? `'${worktreePath.replace(/'/g, "''")}'`
      : `'${worktreePath.replace(/'/g, "'\\''")}'`
    const cdCmd = `${isWin ? 'Set-Location' : 'cd'} ${quoted}\r`
    for (const p of panesRef.current) {
      if (p.cmd !== '') continue
      if (focusedId && p.id !== focusedId) continue
      if (await window.pty.exists(p.id)) {
        window.pty.write(p.id, cdCmd)
      }
    }

    updateActiveTab(t => {
      if (focusedId) {
        return {
          ...t,
          panes: t.panes.map(p => p.id === focusedId ? { ...p, repoPath: worktreePath } : p),
        }
      }
      return {
        ...t,
        repoPath: worktreePath,
        panes: t.panes.map(p => ({ ...p, repoPath: worktreePath })),
      }
    })
  }, [updateActiveTab])

  const [showNewWorktree, setShowNewWorktree] = useState(false)
  const handleNewWorktree = useCallback(() => {
    if (!planLimits.allowCreateWorktree) { setShowUpgrade(true); return }
    setShowNewWorktree(true)
  }, [planLimits.allowCreateWorktree])
  const [quickWorktreeOpen, setQuickWorktreeOpen] = useState(false)
  const [diffViewerOpen, setDiffViewerOpen] = useState(false)
  // The tutorial is launched on demand: from the "?" button in the Worktrees
  // section header or from Settings → Tutorial. No blind auto-launch — the tour
  // spotlights the live app, so it only makes sense once you're on that view.
  const [tutorialTour, setTutorialTour] = useState<import('./tutorial/types').TourId | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The Hub overlay owns the keyboard while open — don't open worktree/diff
      // modals behind it using the hidden workspace's context.
      if (hubOpenRef.current) return
      const isCmdShift = (e.metaKey || e.ctrlKey) && e.shiftKey
      if (isCmdShift && e.key.toLowerCase() === 'w') {
        if (!activeTab.repoPath) return
        e.preventDefault()
        if (!planLimits.allowCreateWorktree) { setShowUpgrade(true); return }
        setQuickWorktreeOpen(true)
      }
      if (isCmdShift && e.key.toLowerCase() === 'd') {
        if (!activeCellRepoPath) return
        e.preventDefault()
        if (!planLimits.allowDiffViewer) { setShowUpgrade(true); return }
        setDiffViewerOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [activeTab.repoPath, activeCellRepoPath, planLimits.allowCreateWorktree, planLimits.allowDiffViewer])

  const removePane = useCallback((paneId: string) => {
    window.pty.kill(paneId)
    updateActiveTab(t => {
      const nextPanes = t.panes.filter(p => p.id !== paneId)
      // Demote layoutId if a smaller default fits the remaining panes.
      // Clear splitRatios when the layout shape changes so the persisted
      // weights from a different tree don't bleed into the new one.
      const naturalDefault = defaultLayoutFor(nextPanes.length)
      const naturalSlots = getPreset(naturalDefault).slotCount
      const demoted = naturalSlots < getPreset(t.layoutId).slotCount
      const layoutId: LayoutId = demoted ? naturalDefault : t.layoutId
      return demoted
        ? { ...t, panes: nextPanes, layoutId, splitRatios: {} }
        : { ...t, panes: nextPanes, layoutId }
    })
    if (zoomedPaneId === paneId) { setZoomedPaneId(null); setZoomingOut(false) }
    if (focusedPaneIdRef.current === paneId) {
      focusedPaneIdRef.current = null
      setFocusedPaneId(null)
    }
  }, [updateActiveTab, zoomedPaneId])

  // ── Hub: the panes live in OTHER workspaces, so these handlers operate on
  // the pane's origin tab (not on the active tab, which is the Hub). ──
  const updatePaneAnywhere = useCallback((paneId: string, updater: (p: PaneNode) => PaneNode) => {
    setTabs(prev => prev.map(t =>
      t.panes.some(p => p.id === paneId)
        ? { ...t, panes: t.panes.map(p => p.id === paneId ? updater(p) : p) }
        : t
    ))
  }, [])

  const removePaneAnywhere = useCallback((paneId: string) => {
    window.pty.kill(paneId)
    setTabs(prev => prev.map(t => {
      // Podar el id de los hubPanes de CUALQUIER tab Hub: sin esto quedaban
      // ids colgantes en la sesión persistida (y shouldConfirmTabClose
      // preguntaba por contenido que ya no existe).
      const prunedHub = t.isHub && (t.hubPanes ?? []).includes(paneId)
        ? { ...t, hubPanes: (t.hubPanes ?? []).filter(id => id !== paneId) }
        : t
      if (!prunedHub.panes.some(p => p.id === paneId)) return prunedHub
      const nextPanes = prunedHub.panes.filter(p => p.id !== paneId)
      const naturalDefault = defaultLayoutFor(nextPanes.length)
      const demoted = getPreset(naturalDefault).slotCount < getPreset(prunedHub.layoutId).slotCount
      return demoted
        ? { ...prunedHub, panes: nextPanes, layoutId: naturalDefault, splitRatios: {} }
        : { ...prunedHub, panes: nextPanes }
    }))
    if (zoomedPaneIdRef.current === paneId) { setZoomedPaneId(null); setZoomingOut(false) }
    if (focusedPaneIdRef.current === paneId) { focusedPaneIdRef.current = null; setFocusedPaneId(null) }
  }, [])

  const updatePaneColor = useCallback((paneId: string, borderColor: string) => {
    updateActiveTab(t => ({
      ...t,
      panes: t.panes.map(p => p.id === paneId ? { ...p, borderColor } : p),
    }))
  }, [updateActiveTab])

  const updatePaneNote = useCallback((paneId: string, note: string) => {
    updateActiveTab(t => ({
      ...t,
      panes: t.panes.map(p => p.id === paneId ? { ...p, note } : p),
    }))
  }, [updateActiveTab])

  // Mirror the browser's current URL onto the pane model so that switching
  // tabs (which unmounts the cell and destroys the WebContentsView) doesn't
  // throw away where the user had navigated to. Also fed into the session
  // snapshot below so the URL survives restarts.
  const updatePaneUrl = useCallback((paneId: string, url: string) => {
    updateActiveTab(t => ({
      ...t,
      panes: t.panes.map(p => p.id === paneId ? { ...p, url } : p),
    }))
  }, [updateActiveTab])

  const updatePaneEditorTabs = useCallback((paneId: string, tabs: EditorTab[], activeEditorTabPath: string | undefined) => {
    updateActiveTab(t => ({
      ...t,
      panes: t.panes.map(p => p.id === paneId ? { ...p, editorTabs: tabs, activeEditorTabPath } : p),
    }))
  }, [updateActiveTab])

  const openFileInEditor = useCallback((relPath: string) => {
    const worktreePath = activeCellRepoPath
    if (!worktreePath) return
    const focusedId = focusedPaneIdRef.current
    const focusedPane = focusedId ? activeTab.panes.find(p => p.id === focusedId) : undefined
    const sameWorktreeEditor = (p: PaneNode) => p.aiType === 'editor' && p.repoPath === worktreePath
    const targetPane = focusedPane && sameWorktreeEditor(focusedPane) ? focusedPane : activeTab.panes.find(sameWorktreeEditor)

    if (targetPane) {
      updateActiveTab(t => ({
        ...t,
        panes: t.panes.map(p => {
          if (p.id !== targetPane.id) return p
          const existing = p.editorTabs ?? []
          const tabs = existing.some(tab => tab.relPath === relPath) ? existing : [...existing, { relPath, dirty: false }]
          return { ...p, editorTabs: tabs, activeEditorTabPath: relPath }
        }),
      }))
      return
    }

    addPane('editor', '', '', AI_CONFIG.editor.color, '', undefined, undefined, undefined, {
      editorTabs: [{ relPath, dirty: false }],
      activeEditorTabPath: relPath,
      repoPath: worktreePath,
    })
  }, [activeTab, activeCellRepoPath, updateActiveTab, addPane])

  const moveEditorTabToNewPane = useCallback((paneId: string, relPath: string) => {
    const sourcePane = activeTab.panes.find(p => p.id === paneId)
    if (!sourcePane) return
    // Única tab del pane: mover "a un pane nuevo" es un no-op conceptual (ya
    // está sola en el suyo). El botón ni se renderiza en ese caso, pero el
    // guard evita que cualquier otro caller deje un pane cascarón sin tabs.
    if ((sourcePane.editorTabs ?? []).length <= 1) return
    // Chequear el cap ANTES de sacar la tab del pane origen: addPane corre
    // después y se bloquea silencioso en el tope de plan/MAX_PANES — sin este
    // pre-check la tab ya removida no se agregaba a ningún lado (se perdía).
    if (panesRef.current.length >= MAX_PANES) return
    if (panesRef.current.length >= planLimits.maxPanes) {
      setShowUpgrade(true)
      return
    }
    updateActiveTab(t => ({
      ...t,
      panes: t.panes.map(p => {
        if (p.id !== paneId) return p
        const remaining = (p.editorTabs ?? []).filter(tab => tab.relPath !== relPath)
        return { ...p, editorTabs: remaining, activeEditorTabPath: remaining[0]?.relPath }
      }),
    }))
    // El dirty viaja con la tab: el buffer sin guardar llega por el handoff
    // (el EditorPane origen lo stashea antes de invocar este handler).
    const sourceTab = (sourcePane.editorTabs ?? []).find(tb => tb.relPath === relPath)
    addPane('editor', '', '', AI_CONFIG.editor.color, '', undefined, undefined, undefined, {
      editorTabs: [{ relPath, dirty: sourceTab?.dirty ?? false }],
      activeEditorTabPath: relPath,
      repoPath: sourcePane.repoPath,
    })
  }, [activeTab, updateActiveTab, addPane, planLimits.maxPanes])

  // Drag & drop: una tab soltada sobre OTRO pane de editor — del mismo
  // workspace o, en el Hub, de workspaces distintos (mismo worktree).
  const handleEditorTabDropped = useCallback((destPaneId: string, drop: { sourcePaneId: string; relPath: string; dirty: boolean }) => {
    setTabs(prev => {
      const res = moveTabAcrossWorkspaces(prev, drop.sourcePaneId, destPaneId, drop.relPath, drop.dirty)
      if (!res) return prev
      if (res.dropStash) {
        // El destino ya tenía el archivo (con su propio buffer): no va a
        // consumir el handoff — descartarlo. Idempotente si corre dos veces.
        const destTab = prev.find(t => t.panes.some(p => p.id === destPaneId))
        const dest = destTab?.panes.find(p => p.id === destPaneId)
        if (dest?.repoPath) dropTabBuffer(dest.repoPath, drop.relPath)
      }
      return res.tabs
    })
  }, [])

  // Drag & drop: un archivo del Explorer soltado sobre un pane de editor.
  // Cross-workspace a propósito (funciona igual desde el Hub, donde el pane
  // destino vive en otro tab): openFileInPane no-opea para todo pane que no
  // sea el destino, así que mapear todos los workspaces es inocuo.
  const handleEditorFileDropped = useCallback((paneId: string, relPath: string) => {
    setTabs(prev => prev.map(t => t.isHub ? t : { ...t, panes: openFileInPane(t.panes, paneId, relPath) }))
  }, [])

  // "Open in new pane" desde el Hub: el split se crea en el workspace de
  // ORIGEN del pane y se auto-pinnea al Hub (mismo patrón que el browser).
  const moveEditorTabToNewPaneFromHub = useCallback((paneId: string, relPath: string) => {
    const hubTabId = activeTabIdRef.current
    const sourceTab = tabsRef.current.find(t => !t.isHub && t.panes.some(p => p.id === paneId))
    if (!sourceTab) return
    if (sourceTab.panes.length >= MAX_PANES) return
    if (sourceTab.panes.length >= planLimits.maxPanes) {
      setShowUpgrade(true)
      return
    }
    const newId = generateId()
    setTabs(prev => splitEditorTabFromHub(prev, hubTabId, paneId, relPath, newId) ?? prev)
  }, [planLimits.maxPanes])

  const handlePtyStarted = useCallback((paneId: string, runningRepoPath: string | undefined) => {
    updateActiveTab(t => ({
      ...t,
      panes: t.panes.map(p => p.id === paneId ? { ...p, runningRepoPath } : p),
    }))
  }, [updateActiveTab])

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setDraggingId(String(e.active.id))
  }, [])

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setDraggingId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    updateActiveTab(t => {
      const from = t.panes.findIndex(p => p.id === active.id)
      const to = t.panes.findIndex(p => p.id === over.id)
      if (from < 0 || to < 0) return t
      return { ...t, panes: swap(t.panes, from, to) }
    })
  }, [updateActiveTab])

  const handleSplitResize = useCallback((path: string, sizes: number[]) => {
    updateActiveTab(t => ({
      ...t,
      splitRatios: { ...(t.splitRatios ?? {}), [path]: sizes },
    }))
  }, [updateActiveTab])

  const handleLayoutIdChange = useCallback((id: LayoutId) => {
    updateActiveTab(t => ({ ...t, layoutId: id, splitRatios: {} }))
  }, [updateActiveTab])

  const handleUnzoom = useCallback(() => {
    setZoomingOut(true)
    setTimeout(() => {
      setZoomedPaneId(null)
      setZoomingOut(false)
    }, 300)
  }, [])

  const handleZoom = useCallback((paneId: string) => {
    if (zoomedPaneId === paneId) {
      handleUnzoom()
    } else {
      setZoomingOut(false)
      setZoomedPaneId(paneId)
    }
  }, [zoomedPaneId, handleUnzoom])

  const saveWorkspace = useCallback(async (name: string) => {
    const liveCount = Math.max(1, panesRef.current.length)
    const ws: Workspace = {
      id: `ws-${Date.now()}`,
      name,
      // Legacy snapshot fields kept for forward-compat. Workspace files older
      // than v1.1 expect layout/rows/cols — fill with a 1×N row.
      layout: { rows: 1, cols: liveCount },
      colSizes: [Array(liveCount).fill(Math.floor(100 / liveCount))],
      rowSizes: [100],
      cells: panesRef.current.map(p => ({
        aiType: p.aiType,
        accountName: p.accountName,
        accountDir: p.accountDir,
        borderColor: p.borderColor,
        cmd: p.cmd,
        customLabel: p.customLabel,
        customColor: p.customColor,
        note: p.note,
        shellId: p.shellId,
        // Misma omisión que tenía el save de sesión: sin repoPath el editor
        // restaurado no sabe su worktree, y sin editorTabs queda cascarón.
        repoPath: p.repoPath,
        url: p.url,
        editorTabs: p.editorTabs,
        activeEditorTabPath: p.activeEditorTabPath,
      })),
      resumeLastSession: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      repoPath: activeTab.repoPath,
    }
    await window.workspaces.save(ws)
  }, [activeTab.repoPath])

  const loadWorkspace = useCallback((ws: Workspace) => {
    const id = generateTabId()
    const restored = (ws.cells ?? [])
      .filter((c): c is SessionPane => c != null)
      .map(sp => ({ ...sp, id: generateId() } as PaneNode))
    setTabs(prev => [...prev, {
      id,
      name: ws.name,
      layoutId: defaultLayoutFor(restored.length),
      panes: restored,
      repoPath: ws.repoPath,
    }])
    setActiveTabId(id)
  }, [])

  const handleTabNew = useCallback(() => {
    const id = generateTabId()
    setTabs(prev => [...prev, { id, name: 'Workspace', layoutId: '1', panes: [] }])
    setActiveTabId(id)
  }, [])

  const openRepoInNewTab = useCallback(async (repoFullName: string, localPath: string) => {
    // Central bottleneck for "open repo in a new tab" — both MyReposPanel and
    // TeamsWorkspace funnel through here. Validate the path exists BEFORE
    // creating the tab so a stale link/clone doesn't produce a broken pane
    // with a dead cwd (pty.spawn would fail with ERROR_DIRECTORY 267 on Win).
    if (localPath) {
      const exists = await window.pathUtils.exists(localPath)
      if (!exists) {
        // Surface the failure to the user. We use a window.alert here
        // because there's no global toast service in the app; both callers
        // (MyReposPanel/TeamsWorkspace) already validate themselves so this
        // is a defense-in-depth fallback rather than the primary UX.
        window.alert(`La carpeta "${localPath}" ya no existe. Re-linkeala o cloná de nuevo desde My Repos.`)
        return
      }
    }
    const id = generateTabId()
    // H2: GitLab paths like `group/subgroup/repo` need the last segment, not [1].
    // Using split('/')[1] would yield "subgroup" instead of "repo".
    const folderName = repoFullName.includes('/') ? repoFullName.split('/').pop()! : repoFullName
    setTabs(prev => [...prev, { id, name: folderName, layoutId: '1', panes: [], repoPath: localPath }])
    setActiveTabId(id)
    setMyReposOpen(false)
    setTeamsOpen(false)
  }, [])

  const handleTabSelect = useCallback((id: string) => {
    setActiveTabId(id)
  }, [])

  const openHub = useCallback(() => {
    // Already viewing the Hub as a workspace tab — don't stack the overlay on
    // top (would mount a second HubView / duplicate xterms for the same PTYs).
    if (activeTab.isHub) return
    hubPrevFocusRef.current = focusedPaneIdRef.current
    setHubOpen(true)
  }, [activeTab.isHub])

  const closeHub = useCallback(() => {
    setHubOpen(false)
    const prev = hubPrevFocusRef.current
    // Restore focus after the overlay unmounts and the pane below re-renders.
    if (prev) setTimeout(() => focusTerminal(prev), 50)
  }, [])

  const handleHubJump = useCallback((tabId: string, paneId: string) => {
    setHubOpen(false)
    setActiveTabId(tabId)
    setFocusedPaneId(paneId)
    focusedPaneIdRef.current = paneId
    // The pane's xterm mounts on tab switch; focus once it registered.
    setTimeout(() => focusTerminal(paneId), 150)
  }, [])

  const handleHubTogglePin = useCallback((tabId: string, paneId: string) => {
    setTabs(prev => prev.map(t => t.id !== tabId ? t : {
      ...t,
      panes: t.panes.map(p => p.id !== paneId ? p : { ...p, pinned: !p.pinned }),
    }))
  }, [])

  // ── Hub composition — `hubPanes` on the active Hub tab is the ORDERED set of
  // pane ids the user curated into the Hub (the terminals they use most). The Hub
  // then renders exactly like a workspace with those panes (real TerminalPane). ──
  const handleHubToggleTerminal = useCallback((paneId: string) => {
    updateActiveTab(t => {
      const cur = t.hubPanes ?? []
      return cur.includes(paneId)
        ? { ...t, hubPanes: cur.filter(id => id !== paneId) }
        : { ...t, hubPanes: [...cur, paneId] }
    })
  }, [updateActiveTab])

  const handleHubToggleWorkspace = useCallback((tabId: string) => {
    const src = tabsRef.current.find(t => t.id === tabId)
    if (!src) return
    const ids = src.panes.filter(p => p.aiType !== 'browser').map(p => p.id)
    updateActiveTab(t => {
      const cur = t.hubPanes ?? []
      const allIn = ids.length > 0 && ids.every(id => cur.includes(id))
      return allIn
        ? { ...t, hubPanes: cur.filter(id => !ids.includes(id)) }
        : { ...t, hubPanes: [...cur, ...ids.filter(id => !cur.includes(id))] }
    })
  }, [updateActiveTab])

  // Reorder the Hub's curated panes by drag (same gesture as a workspace).
  const handleHubDragEnd = useCallback((e: DragEndEvent) => {
    setDraggingId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = hubPanesRef.current.map(p => p.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    updateActiveTab(t => ({ ...t, hubPanes: swap(ids, from, to) }))
  }, [updateActiveTab])

  // Sidebar terminal click: ensure it's in the Hub, then focus its pane.
  const handleHubFocus = useCallback((paneId: string) => {
    updateActiveTab(t =>
      (t.hubPanes ?? []).includes(paneId) ? t : { ...t, hubPanes: [...(t.hubPanes ?? []), paneId] }
    )
    setTimeout(() => focusTerminal(paneId), 120)
  }, [updateActiveTab])

  const convertActiveTabToHub = useCallback(() => {
    // A Hub tab owns no panes (HubView would filter them out → invisible,
    // uncloseable). Only reached from EmptyState (panes already []), but clear
    // defensively so a Hub tab can never hold orphan panes.
    updateActiveTab(t => ({ ...t, isHub: true, name: 'Hub', panes: [] }))
  }, [updateActiveTab])

  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId

  const cycleTab = useCallback((isPrev: boolean) => {
    const allTabs = tabsRef.current
    if (allTabs.length <= 1) return
    const currentIdx = allTabs.findIndex(t => t.id === activeTabIdRef.current)
    if (currentIdx === -1) return
    const next = isPrev
      ? (currentIdx - 1 + allTabs.length) % allTabs.length
      : (currentIdx + 1) % allTabs.length
    setActiveTabId(allTabs[next].id)
  }, [])

  // Ctrl+Tab is reserved on Windows and never reaches the renderer keydown
  // listener; main intercepts before-input-event and forwards via IPC.
  useEffect(() => {
    window.keybinds?.onTabCycle((shift) => cycleTab(shift))
    return () => window.keybinds?.removeTabCycleListener()
  }, [cycleTab])

  const closeTab = useCallback((id: string) => {
    const currentTabs = tabsRef.current
    const tab = currentTabs.find(t => t.id === id)
    if (tab) tab.panes.forEach(p => window.pty.kill(p.id))
    setTabActivity(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id)
      if (next.length === 0) {
        const fallbackId = generateTabId()
        setActiveTabId(fallbackId)
        return [{ id: fallbackId, name: 'Workspace', layoutId: '1', panes: [] }]
      }
      setActiveTabId(prevActive => {
        if (prevActive !== id) return prevActive
        const idx = currentTabs.findIndex(t => t.id === id)
        const remaining = currentTabs.filter(t => t.id !== id)
        return remaining[Math.max(0, idx - 1)]?.id ?? remaining[0]?.id ?? next[0].id
      })
      return next
    })
  }, [])

  const handleTabClose = useCallback((id: string) => {
    const tab = tabsRef.current.find(t => t.id === id)
    if (!tab) return
    if (shouldConfirmTabClose(tab)) {
      setConfirmClose({ tabId: id, name: tab.name, isHub: tab.isHub })
    } else {
      closeTab(id)
    }
  }, [closeTab])

  const handleTabRename = useCallback((id: string, name: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, name } : t))
  }, [])

  const handleTabColorChange = useCallback((tabId: string, color: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, accentColor: color } : t))
  }, [])

  const handleTabReorder = useCallback((fromId: string, toId: string) => {
    setTabs(prev => {
      const fromIdx = prev.findIndex(t => t.id === fromId)
      const toIdx = prev.findIndex(t => t.id === toId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const next = [...prev]
      ;[next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]]
      return next
    })
  }, [])

  const openBrowserCell = useCallback((url: string) => {
    if (panesRef.current.length >= MAX_PANES) return
    if (panesRef.current.length >= planLimits.maxPanes) {
      setShowUpgrade(true)
      return
    }
    // Hub tabs own no panes — el browser vive en un workspace nuevo, pero se
    // auto-pinnea al Hub y el usuario SE QUEDA en el Hub (antes esto
    // navegaba al workspace nuevo, dejando la sensación de "no puedo tener
    // un browser en el Hub").
    const activeNow = tabsRef.current.find(t => t.id === activeTabIdRef.current)
    if (activeNow?.isHub) {
      const newTabId = generateTabId()
      const pane: PaneNode = {
        id: generateId(), aiType: 'browser', accountName: 'browser', accountDir: '',
        borderColor: '#0066FF', cmd: '', url,
        sessionPartition: `persist:browser-${newTabId}`,
      }
      setTabs(prev => prev
        .map(t => t.id === activeNow.id ? { ...t, hubPanes: [...(t.hubPanes ?? []), pane.id] } : t)
        .concat({ id: newTabId, name: 'Workspace', layoutId: '1', panes: [pane] }))
      return
    }
    const pane: PaneNode = {
      id: generateId(),
      aiType: 'browser',
      accountName: 'browser',
      accountDir: '',
      borderColor: '#0066FF',
      cmd: '',
      url,
      sessionPartition: `persist:browser-${activeTabId}`,
    }
    updateActiveTab(t => {
      const nextPanes = [...t.panes, pane]
      const currentSlots = getPreset(t.layoutId).slotCount
      const promoted = nextPanes.length > currentSlots
      const layoutId: LayoutId = promoted ? defaultLayoutFor(nextPanes.length) : t.layoutId
      return promoted
        ? { ...t, panes: nextPanes, layoutId, splitRatios: {} }
        : { ...t, panes: nextPanes, layoutId }
    })
  }, [activeTabId, updateActiveTab, planLimits.maxPanes])

  // When a link click in xterm or a PortChip dispatches nest:pty-url and no
  // BrowserCell is mounted to capture it, create one. If a BrowserCell IS
  // mounted, its own listener (BrowserCell.tsx:166) already navigates it —
  // we no-op to avoid duplicating panes.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ paneId: string; url: string }>
      if (!ce.detail?.url) return
      const hasBrowser = panesRef.current.some(p => p.aiType === 'browser')
      if (!hasBrowser) openBrowserCell(ce.detail.url)
    }
    window.addEventListener('nest:pty-url', handler as EventListener)
    return () => window.removeEventListener('nest:pty-url', handler as EventListener)
  }, [openBrowserCell])

  // Re-focus the active terminal when the window comes back from win.hide()
  // (e.g. Cmd+Q on macOS hides instead of quitting). main.ts emits 'window:shown'
  // on every BrowserWindow 'show' event — more reliable than the 'focus' DOM event
  // which Electron doesn't always fire after win.hide()/win.show().
  useEffect(() => {
    window.windowControls?.onShown(() => {
      const id = focusedPaneIdRef.current
      if (id) focusTerminal(id)
    })
  }, [])

  // Open the new-pane dialog (engine handles slot placement)
  const addNextPane = useCallback(() => {
    setAddingPane({})
  }, [])

  // Saves must wait until the restore attempt finished: the debounced save
  // below fires 800ms after mount, and with the initial empty workspace it
  // would overwrite session.json before the async restore populates the tabs.
  const sessionRestoredRef = useRef(false)

  // Load session on startup
  useEffect(() => {
    window.session.load().then((data) => {
      if (!data) {
        sessionRestoredRef.current = true
        return
      }

      const COLOR_MIGRATION: Record<string, string> = {
        '#3B82F6': '#0055FF', '#EF4444': '#FF1A1A', '#10B981': '#00CC44',
        '#F59E0B': '#FFB800', '#8B5CF6': '#CC44FF', '#EC4899': '#FF2D78',
        '#06B6D4': '#00CCCC', '#F97316': '#FF6600', '#6366F1': '#4455FF',
        '#84CC16': '#88FF00', '#6B7280': '#666666',
      }

      const sessionToPane = (sp: SessionPane): PaneNode => {
        const borderColor = COLOR_MIGRATION[sp.borderColor] ?? sp.borderColor
        return {
          ...sp,
          // Reusar el id persistido: hubPanes referencia ids — regenerarlos
          // dejaba el Hub restaurado vacío (curación perdida en cada
          // relanzamiento). Sesiones viejas sin id siguen generando uno.
          id: sp.id ?? generateId(),
          cmd: sp.cmd ?? AI_CONFIG[sp.aiType]?.cmd ?? '',
          borderColor,
        } as PaneNode
      }

      const migrate = (raw: NonNullable<SessionData['tabs']>[number]): WorkspaceTab => {
        if (raw.layoutId && Array.isArray(raw.panes)) {
          return {
            id: raw.id, name: raw.name, accentColor: raw.accentColor, repoPath: raw.repoPath,
            layoutId: raw.layoutId,
            panes: raw.panes.map(sessionToPane),
            splitRatios: raw.splitRatios ?? {},
            isHub: raw.isHub,
            hubPanes: raw.hubPanes,
          }
        }
        // v2: layout + cells
        const live = (raw.cells ?? []).filter((c): c is SessionPane => c != null).map(sessionToPane)
        const layoutId = raw.layout
          ? mapLegacyToPreset(raw.layout.rows, raw.layout.cols, live.length)
          : defaultLayoutFor(live.length)
        return {
          id: raw.id, name: raw.name, accentColor: raw.accentColor, repoPath: raw.repoPath,
          layoutId,
          panes: live,
        }
      }

      // v1 legacy format: single layout + cells at root
      if (!data.tabs && data.layout && data.cells) {
        const live = data.cells.filter((c): c is SessionPane => c != null).map(sessionToPane)
        const id = `tab-${Date.now()}`
        setTabs([{
          id,
          name: 'Workspace',
          layoutId: mapLegacyToPreset(data.layout.rows, data.layout.cols, live.length),
          panes: live,
        }])
        setActiveTabId(id)
        sessionRestoredRef.current = true
        return
      }

      // v2/v3 format: tabs array
      if (data.tabs && data.tabs.length > 0) {
        const restored = data.tabs.map(migrate)
        // Drop repoPath references to directories that no longer exist on disk —
        // otherwise every new pane inherits a dead cwd and pty.spawn fails with
        // ERROR_DIRECTORY (267) on Windows. Applies to both tab.repoPath AND
        // pane.repoPath (panes override tab scope when set).
        Promise.all(restored.map(async (t) => {
          const pathsToCheck = new Set<string>()
          if (t.repoPath) pathsToCheck.add(t.repoPath)
          for (const p of t.panes) if (p.repoPath) pathsToCheck.add(p.repoPath)
          if (pathsToCheck.size === 0) return t

          const existence = await Promise.all(
            [...pathsToCheck].map(async (p) => [p, await window.pathUtils.exists(p)] as const)
          )
          const dead = new Set(existence.filter(([, ok]) => !ok).map(([p]) => p))
          if (dead.size === 0) return t

          for (const p of dead) console.warn('[session] dropping stale repoPath', p)
          return {
            ...t,
            repoPath: t.repoPath && dead.has(t.repoPath) ? undefined : t.repoPath,
            panes: t.panes.map((p) =>
              p.repoPath && dead.has(p.repoPath) ? { ...p, repoPath: undefined } : p
            ),
          }
        })).then((cleaned) => {
          setTabs(cleaned)
          setActiveTabId(data.activeTabId ?? cleaned[0].id)
          sessionRestoredRef.current = true
        }).catch((err) => {
          console.error('[session] restore failed; re-enabling saves with current state', err)
          sessionRestoredRef.current = true
        })
        return
      }

      // Session exists but has no restorable tabs — nothing to protect.
      sessionRestoredRef.current = true
    }).catch(() => {
      sessionRestoredRef.current = true
    })
  }, [])

  // Save session on changes (debounced 800ms). Gated until the restore
  // attempt finishes — see sessionRestoredRef above.
  useEffect(() => {
    if (!sessionRestoredRef.current) return
    const timer = setTimeout(() => {
      const sessionData: SessionData = {
        tabs: tabs.map(tab => ({
          id: tab.id,
          name: tab.name,
          accentColor: tab.accentColor,
          repoPath: tab.repoPath,
          layoutId: tab.layoutId,
          panes: tab.panes.map(p => ({
            // El id viaja: hubPanes referencia ids y regenerarlos en el
            // restore dejaba el Hub vacío tras cada relanzamiento.
            id: p.id,
            aiType: p.aiType, accountName: p.accountName, accountDir: p.accountDir,
            borderColor: p.borderColor, cmd: p.cmd,
            customLabel: p.customLabel, customColor: p.customColor, note: p.note,
            repoPath: p.repoPath,
            shellId: p.shellId,
            pinned: p.pinned,
            // Persist the browser pane's current URL so reopening Nest (or
            // switching workspaces) restores the page instead of the placeholder.
            url: p.url,
            // Editor: sin estos dos, el pane restauraba como cascarón sin
            // tabs (negro, incerrable). Las tabs dirty recargan de disco al
            // restaurar (el buffer no sobrevive el proceso) pero conservan
            // la señal de "tenías trabajo sin guardar".
            editorTabs: p.editorTabs,
            activeEditorTabPath: p.activeEditorTabPath,
          })),
          splitRatios: tab.splitRatios,
          isHub: tab.isHub,
          hubPanes: tab.hubPanes,
        })),
        activeTabId,
      }
      window.session.save(sessionData)
    }, 800)
    return () => clearTimeout(timer)
  }, [tabs, activeTabId])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const kb = settingsRef.current.keybindings

      // Voice input toggle
      if (matchesBinding(e, kb.voiceInput)) {
        e.preventDefault()
        if (!planLimits.allowVoice) { setShowUpgrade(true); return }
        toggleListening()
        return
      }

      if (e.key === 'Escape' && hubOpenRef.current) { closeHub(); return }
      if (e.key === 'Escape' && zoomedPaneIdRef.current !== null) { handleUnzoom(); return }

      if (!e.metaKey && !e.ctrlKey) return

      // While the Hub overlay is open, its own listener owns the keyboard.
      // Swallow every App-level Meta/Ctrl binding (pane cycling, Cmd+1-9, new
      // pane, zoom, font size…) so a shell shortcut typed into a Hub tile
      // (e.g. Ctrl+←/→ word-jump) can't redirect focus to a hidden pane
      // behind the overlay. Only the Hub toggle still acts here (to close);
      // Escape is handled above. Returning without preventDefault lets the
      // keystroke reach the focused tile's terminal.
      if (hubOpenRef.current) {
        if (matchesBinding(e, kb.hubOverlay)) { e.preventDefault(); closeHub(); return }
        return
      }

      if (matchesBinding(e, kb.newPane)) { e.preventDefault(); addNextPane(); return }

      if (matchesBinding(e, kb.fontSizeUp)) {
        e.preventDefault()
        setFontSize(s => { const n = Math.min(s + 1, 20); localStorage.setItem('nest-font-size', String(n)); userPrefs.setFontSize(n); return n })
        return
      }
      if (matchesBinding(e, kb.fontSizeDown)) {
        e.preventDefault()
        setFontSize(s => { const n = Math.max(s - 1, 9); localStorage.setItem('nest-font-size', String(n)); userPrefs.setFontSize(n); return n })
        return
      }
      if (matchesBinding(e, kb.fontSizeReset)) {
        e.preventDefault()
        setFontSize(13); localStorage.setItem('nest-font-size', '13'); userPrefs.setFontSize(13)
        return
      }

      if (matchesBinding(e, kb.toggleZoom)) {
        e.preventDefault()
        if (zoomedPaneIdRef.current !== null) { handleUnzoom(); return }
        const focusedId = focusedPaneIdRef.current
        if (focusedId) handleZoom(focusedId)
        return
      }

      // Cmd+1-9 — jump to Nth pane (not configurable, stays hardcoded)
      const n = parseInt(e.key, 10)
      if (!isNaN(n) && n >= 1 && n <= 9) {
        e.preventDefault()
        const target = panesRef.current[n - 1]
        if (target) {
          setFocusedPaneId(target.id)
          focusedPaneIdRef.current = target.id
          focusTerminal(target.id)
        }
        return
      }

      if (matchesBinding(e, kb.globalSearch)) { e.preventDefault(); setGlobalSearchOpen(true); return }
      if (matchesBinding(e, kb.commandPalette)) { e.preventDefault(); setCommandPaletteOpen(v => !v); return }
      if (matchesBinding(e, kb.hubOverlay)) {
        e.preventDefault()
        if (hubOpenRef.current) closeHub()
        else openHub()
        return
      }

      if (matchesBinding(e, kb.nextPane) || matchesBinding(e, kb.prevPane)) {
        e.preventDefault()
        const all = panesRef.current
        if (all.length === 0) return
        const currentIdx = all.findIndex(p => p.id === focusedPaneIdRef.current)
        const isNext = matchesBinding(e, kb.nextPane)
        const next = isNext
          ? (currentIdx + 1) % all.length
          : (currentIdx - 1 + all.length) % all.length
        const target = all[next]
        setFocusedPaneId(target.id)
        focusedPaneIdRef.current = target.id
        focusTerminal(target.id)
        return
      }

      if (matchesBinding(e, kb.nextTab) || matchesBinding(e, kb.prevTab)) {
        e.preventDefault()
        cycleTab(matchesBinding(e, kb.prevTab))
      }
    }
    // Capture phase: intercept matching keybinds before xterm.js (which is
    // focused inside cells) consumes them. The early-return on "no Meta/Ctrl"
    // means non-modified keystrokes still flow through to the terminal.
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [addNextPane, toggleListening, cycleTab, handleUnzoom, handleZoom, planLimits.allowVoice, openHub, closeHub])

  const isInitialState = panes.length === 0

  // Workspace-level drop handling for worktree drag-and-drop
  const [dropActive, setDropActive] = useState(false)
  const workspaceRef = useRef<HTMLDivElement>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes(WORKTREE_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!dropActive) setDropActive(true)
  }, [dropActive])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDropActive(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    const path = e.dataTransfer.getData(WORKTREE_DRAG_MIME)
    setDropActive(false)
    if (!path) return
    e.preventDefault()
    setAddingPane({ worktreePath: path })
  }, [])

  // ResourceBar payload — flatten ALL tabs (not just active) so the panel
  // reflects every running PTY in the app. Memoize on a structural key so the
  // hook's ref doesn't churn when unrelated state (focus, drag) changes.
  const activePanesPayload = useMemo<MetricsPaneInput[]>(() => {
    const out: MetricsPaneInput[] = []
    for (const tab of tabs) {
      for (const pane of tab.panes) {
        if (pane.aiType === 'browser') continue
        const label = pane.customLabel ?? AI_CONFIG[pane.aiType]?.label ?? 'Terminal'
        // The user-typed pane note is the most useful discriminator (e.g.
        // "fixing auth", "running tests"). When empty the row shows only
        // the AI-coloured bullet — the AI name itself is intentionally not
        // rendered (the bullet's color identifies it). workspaceName lets
        // the collector group panes with no linked repo under their tab.
        // Color priority: the user-picked borderColor (changed via the
        // header's color picker) wins so the panel mirrors what they see
        // in the pane header. Falls back to customColor (custom CLIs) and
        // then to the AI's default color.
        const aiColor = pane.borderColor ?? pane.customColor ?? AI_CONFIG[pane.aiType]?.color ?? '#888888'
        out.push({ paneId: pane.id, repoPath: pane.repoPath, label, note: pane.note, workspaceName: tab.name, aiColor, aiType: pane.aiType })
      }
    }
    return out
  }, [tabs])

  // Todos los panes de los workspaces son elegibles para el Hub — terminales,
  // editores y browsers (renderHubPane branchea por tipo).
  const hubTermCount = useMemo(
    () => tabs.reduce((n, t) => t.isHub ? n : n + t.panes.length, 0),
    [tabs]
  )

  // The Hub is a normal workspace whose panes are a CURATED subset the user pulls
  // from across every workspace (the terminals they use most). Same layout engine
  // + real TerminalPane as any workspace — the Hub tab replaces the whole view
  // (not an overlay), so the real pane mounts here safely. Membership AND order
  // both live in `hubPanes` (ids); capped at MAX_PANES like any workspace.
  const hubPaneSet = useMemo(() => new Set(activeTab.hubPanes ?? []), [activeTab.hubPanes])
  const hubData = useMemo(() => {
    if (!activeTab.isHub) return null
    const byId = new Map<string, PaneNode>()
    for (const t of tabs) {
      if (t.isHub) continue
      for (const p of t.panes) byId.set(p.id, p)
    }
    const picked = (activeTab.hubPanes ?? [])
      .map(id => byId.get(id))
      .filter((p): p is PaneNode => !!p)
    const panes = picked.slice(0, MAX_PANES)
    return { panes, layoutId: hubLayoutFor(activeTab.layoutId, panes.length), hiddenCount: Math.max(0, picked.length - MAX_PANES) }
  }, [activeTab.isHub, activeTab.hubPanes, activeTab.layoutId, tabs])
  hubPanesRef.current = hubData?.panes ?? []

  const hubWorkspaces = useMemo(() => tabs.filter(t => !t.isHub).map(t => ({
    id: t.id,
    name: t.name,
    accentColor: t.accentColor,
    terminals: t.panes.map(p => ({
      id: p.id,
      // Un pane de editor se identifica por su archivo activo, no por "Editor".
      label: p.customLabel ?? p.note
        ?? (p.aiType === 'editor' ? p.activeEditorTabPath?.split('/').pop() : undefined)
        ?? AI_CONFIG[p.aiType]?.label ?? 'Terminal',
      color: p.borderColor ?? p.customColor ?? AI_CONFIG[p.aiType]?.color ?? '#888888',
      aiType: p.aiType,
      inHub: hubPaneSet.has(p.id),
      busy: activePanes.has(p.id),
    })),
  })), [tabs, hubPaneSet, activePanes])

  // El Hub muestra panes de OTROS workspaces: toda mutación va vía los
  // helpers *Anywhere (la tab activa es la del Hub y no posee estos panes).
  // Sin el branch por tipo, un pane de editor agregado al Hub se renderizaba
  // como TerminalPane — un xterm sin PTY, roto.
  const renderHubPane = (pane: PaneNode) => pane.aiType === 'editor'
    ? (
      <PaneErrorBoundary key={pane.id} onClose={() => removePaneAnywhere(pane.id)}>
        <EditorPane
          pane={pane}
          onTabsChange={(editorTabs, activeEditorTabPath) => updatePaneAnywhere(pane.id, p => ({ ...p, editorTabs, activeEditorTabPath }))}
          onClose={() => removePaneAnywhere(pane.id)}
          onFocus={() => { setFocusedPaneId(pane.id); focusedPaneIdRef.current = pane.id }}
          onOpenInNewPane={(relPath) => moveEditorTabToNewPaneFromHub(pane.id, relPath)}
          onTabDropped={(drop) => handleEditorTabDropped(pane.id, drop)}
          onFileDropped={(relPath) => handleEditorFileDropped(pane.id, relPath)}
          editorOptions={userPrefs.prefs.ui_settings.editorOptions}
          editorTheme={userPrefs.prefs.ui_settings.editorTheme}
        />
      </PaneErrorBoundary>
    )
    : pane.aiType === 'browser'
    ? (
      <BrowserCell
        key={pane.id}
        pane={pane}
        borderColor={pane.borderColor}
        siblingPaneIds={hubPanesRef.current.filter(p => p.id !== pane.id).map(p => p.id)}
        workspaceRepoPath={pane.repoPath}
        siblingRepoPaths={Array.from(new Set(
          hubPanesRef.current.map(p => p.repoPath).filter((p): p is string => !!p)
        ))}
        onClose={() => removePaneAnywhere(pane.id)}
        onNavigate={(url) => updatePaneAnywhere(pane.id, p => ({ ...p, url }))}
      />
    )
    : (
    <TerminalPane
      key={pane.id}
      pane={pane}
      ports={panePorts[pane.id] ?? []}
      isDragging={draggingId === pane.id}
      zoomed={zoomedPaneId === pane.id}
      zoomingOut={zoomedPaneId === pane.id && zoomingOut}
      onZoom={() => handleZoom(pane.id)}
      onClose={() => removePaneAnywhere(pane.id)}
      onColorChange={(c) => updatePaneAnywhere(pane.id, p => ({ ...p, borderColor: c }))}
      onNoteChange={(note) => updatePaneAnywhere(pane.id, p => ({ ...p, note }))}
      fontSize={fontSize}
      onInput={(data) => {
        // El broadcast también aplica DESDE el Hub: los targets son los panes
        // agentes visibles en el Hub (el onInput del workspace no corre acá —
        // este es el camino que faltaba y por el que "no funcionaba").
        const targets = broadcastMode ? broadcastTargets(hubPanesRef.current, pane.id) : [pane.id]
        targets.forEach((id) => window.pty.write(id, data))
      }}
      onFocus={() => { setFocusedPaneId(pane.id); focusedPaneIdRef.current = pane.id }}
      onBusyChange={handleBusyChange}
      onActivity={handlePaneActivity}
      onJoinRequest={() => setJoinRequest({ paneId: pane.id, paneTitle: pane.customLabel ?? pane.accountName ?? 'Terminal' })}
      onPtyStarted={(id, rp) => updatePaneAnywhere(id, p => ({ ...p, runningRepoPath: rp }))}
      allowSharing={planLimits.allowSharing}
      onRequireUpgrade={() => setShowUpgrade(true)}
      onRename={(label) => updatePaneAnywhere(pane.id, p => ({ ...p, customLabel: label || undefined }))}
    />
    )

  return (
    <div className="app" style={{ '--tab-accent': activeTab.accentColor ?? 'var(--raven-blue)' } as React.CSSProperties}>
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={handleTabSelect}
        onTabClose={handleTabClose}
        onTabNew={handleTabNew}
        onTabRename={handleTabRename}
        onTabReorder={handleTabReorder}
        onTabColorChange={handleTabColorChange}
        isWin={window.platform?.isWin ?? false}
        tabActivity={tabActivity}
        rightSlot={<ResourceBar panes={activePanesPayload} />}
      />
      {updateStatus?.type === 'downloading' && (
        <div className="update-banner update-banner--downloading">
          Downloading update…
        </div>
      )}
      {updateStatus?.type === 'ready' && (
        <div className="update-banner update-banner--ready">
          New version ready.{' '}
          <button className="update-install-btn" onClick={() => window.updater.install()}>
            Install and restart
          </button>
        </div>
      )}
      {updateStatus?.type === 'error' && (
        <div className="update-banner update-banner--error">
          Error downloading update.{updateStatus.msg ? ` (${updateStatus.msg})` : ''}{' '}
          <button className="update-install-btn" onClick={() => { setUpdateStatus(null); window.updater.checkForUpdates() }}>
            Retry
          </button>
          {' '}
          <button className="update-install-btn" onClick={() => window.electronShell.openExternal('https://github.com/GeronimoDiClemente/raven-nest/releases/latest')}>
            Download manually
          </button>
        </div>
      )}

      <div className="app-body">
      <Sidebar
        expanded={sidebarExpanded}
        onToggle={() => setSidebarExpanded((v) => !v)}
        broadcastMode={broadcastMode}
        onBroadcastToggle={() => setBroadcastMode((v) => !v)}
        onNewPane={addNextPane}
        onHistoryOpen={() => setConvSidebarOpen(true)}
        onSnippetSend={(content) => {
          const id = focusedPaneIdRef.current
          if (id) window.pty.write(id, content + '\r')
        }}
        onSnippetBroadcast={(content) => {
          // Vista-consciente: en el Hub la tab activa no posee panes — los
          // targets salen de los panes del Hub. Y siempre solo agentes.
          const viewPanes = activeTab.isHub ? hubPanesRef.current : panes
          viewPanes.filter((p) => isAgentPane(p.aiType)).forEach((p) => window.pty.write(p.id, content + '\r'))
        }}
        onCommandRun={(cmd) => {
          const id = focusedPaneIdRef.current
          if (id) window.pty.write(id, cmd + '\r')
        }}
        onWorkspaceSave={saveWorkspace}
        onWorkspaceLoad={loadWorkspace}
        isWin={window.platform?.isWin ?? false}
        isTrialActive={isTrialActive}
        trialDaysLeft={trialDaysLeft}
        profileLoading={profileLoading}
        onUpgrade={() => setShowUpgrade(true)}
        onTeamsOpen={() => {
          if (!planLimits.allowTeam) { setShowUpgrade(true); return }
          setTeamsOpen(true)
        }}
        pendingInvitesCount={pendingInvitesCount}
        onMyReposOpen={() => {
          if (!planLimits.allowMyRepos) { setShowUpgrade(true); return }
          setMyReposOpen(true)
        }}
        plan={plan}
        repoPath={activeTab.repoPath}
        isHub={activeTab.isHub ?? false}
        hubWorkspaces={hubWorkspaces}
        onSelectWorkspace={(id) => {
          // Hub is a curated workspace: clicking a workspace focuses its first
          // pane *inside* the Hub (adding it if needed), never navigates away.
          const t = tabs.find(x => x.id === id)
          const p = t?.panes[0]
          if (p) handleHubFocus(p.id)
        }}
        onJumpToPane={(_tabId, paneId) => handleHubFocus(paneId)}
        onToggleTerminal={handleHubToggleTerminal}
        onToggleWorkspace={handleHubToggleWorkspace}
        onNewWorkspace={handleTabNew}
        onAddTerminalToWorkspace={(tabId) => { setActiveTabId(tabId); setAddingPane({}) }}
        onRepoLink={handleRepoLink}
        onRepoUnlink={handleRepoUnlink}
        isListening={isListening}
        isTranscribing={isTranscribing}
        isModelLoading={isModelLoading}
        onMicToggle={() => {
          if (!planLimits.allowVoice) { setShowUpgrade(true); return }
          toggleListening()
        }}
        onJoinTerminal={() => setShowJoinViewer(true)}
        activeCellRepoPath={activeCellRepoPath}
        onWorktreeSelect={handleWorktreeSelect}
        onNewWorktree={handleNewWorktree}
        worktreeRefreshKey={worktreeRefreshKey}
        layoutId={activeTab.isHub ? (hubData?.layoutId ?? '1') : activeTab.layoutId}
        paneCount={activeTab.isHub ? (hubData?.panes.length ?? 0) : panes.length}
        onLayoutChange={handleLayoutIdChange}
        onOpenTutorial={(id) => setTutorialTour(id)}
        onFileOpen={openFileInEditor}
        userPrefs={userPrefs}
      />
      <div
        ref={workspaceRef}
        className={`workspace${dropActive ? ' grid-workspace--drop-target' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {activeTab.isHub ? (
          <HubWorkspace
            panes={hubData?.panes ?? []}
            layoutId={hubData?.layoutId ?? '1'}
            splitRatios={activeTab.splitRatios}
            hiddenCount={hubData?.hiddenCount ?? 0}
            onResize={handleSplitResize}
            onDragStart={handleDragStart}
            onDragEnd={handleHubDragEnd}
            draggingId={draggingId}
            sensors={sensors}
            renderPane={renderHubPane}
          />
        ) : isInitialState ? (
          <EmptyState
            onNewPane={addNextPane}
            onShowHub={hubTermCount > 0 ? convertActiveTabToHub : undefined}
            hubCount={hubTermCount}
          />
        ) : (
          <>
            {zoomedPaneId !== null && (
              <div
                className={`zoom-backdrop${zoomingOut ? ' zooming-out' : ''}`}
                onClick={handleUnzoom}
              />
            )}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={panes.map(p => p.id)} strategy={rectSortingStrategy}>
                <PaneLayoutEngine
                  layoutId={activeTab.layoutId}
                  panes={panes}
                  splitRatios={activeTab.splitRatios}
                  onResize={handleSplitResize}
                  renderPane={(pane) => pane.aiType === 'editor'
                    ? (
                      // Boundary solo en el editor: es el único pane que corre
                      // código de terceros patcheando globals (Monaco/shiki) —
                      // un throw ahí en pleno commit desmontaba la app entera.
                      <PaneErrorBoundary key={pane.id} onClose={() => removePane(pane.id)}>
                        <EditorPane
                          pane={pane}
                          onTabsChange={(tabs, activeEditorTabPath) => updatePaneEditorTabs(pane.id, tabs, activeEditorTabPath)}
                          onClose={() => removePane(pane.id)}
                          onFocus={() => { setFocusedPaneId(pane.id); focusedPaneIdRef.current = pane.id }}
                          onOpenInNewPane={(relPath) => moveEditorTabToNewPane(pane.id, relPath)}
                          onTabDropped={(drop) => handleEditorTabDropped(pane.id, drop)}
                          onFileDropped={(relPath) => handleEditorFileDropped(pane.id, relPath)}
                          editorOptions={userPrefs.prefs.ui_settings.editorOptions}
                          editorTheme={userPrefs.prefs.ui_settings.editorTheme}
                        />
                      </PaneErrorBoundary>
                    )
                    : pane.aiType === 'browser'
                    ? (
                      <BrowserCell
                        key={pane.id}
                        pane={pane}
                        borderColor={pane.borderColor}
                        siblingPaneIds={panes.filter(p => p.id !== pane.id).map(p => p.id)}
                        workspaceRepoPath={activeTab.repoPath ?? pane.repoPath}
                        siblingRepoPaths={Array.from(new Set(
                          panes
                            .map((p) => p.repoPath)
                            .filter((p): p is string => !!p)
                        ))}
                        onClose={() => removePane(pane.id)}
                        onNavigate={(url) => updatePaneUrl(pane.id, url)}
                      />
                    )
                    : (
                      <TerminalPane
                        key={pane.id}
                        pane={pane}
                        ports={panePorts[pane.id] ?? []}
                        isDragging={draggingId === pane.id}
                        zoomed={zoomedPaneId === pane.id}
                        zoomingOut={zoomedPaneId === pane.id && zoomingOut}
                        onZoom={() => handleZoom(pane.id)}
                        onClose={() => removePane(pane.id)}
                        onColorChange={(c) => updatePaneColor(pane.id, c)}
                        onNoteChange={(note) => updatePaneNote(pane.id, note)}
                        fontSize={fontSize}
                        onInput={(data) => {
                          // Broadcast solo a panes de AGENTE (más la propia):
                          // editor/browser no tienen PTY y una shell plana
                          // ejecutaría el prompt como comando.
                          const targets = broadcastMode ? broadcastTargets(panes, pane.id) : [pane.id]
                          targets.forEach((id) => window.pty.write(id, data))
                        }}
                        onFocus={() => {
                          setFocusedPaneId(pane.id)
                          focusedPaneIdRef.current = pane.id
                        }}
                        onBusyChange={handleBusyChange}
                        onActivity={handlePaneActivity}
                        onJoinRequest={() => setJoinRequest({ paneId: pane.id, paneTitle: pane.customLabel ?? pane.accountName ?? 'Terminal' })}
                        onPtyStarted={handlePtyStarted}
                        allowSharing={planLimits.allowSharing}
                        onRequireUpgrade={() => setShowUpgrade(true)}
                        onRename={(label) => updatePaneAnywhere(pane.id, p => ({ ...p, customLabel: label || undefined }))}
                      />
                    )
                  }
                  renderEmpty={() => (
                    <EmptyCell onClick={() => setAddingPane({})} />
                  )}
                />
              </SortableContext>
              <DragOverlay>
                {draggingId !== null && (() => {
                  const pane = panes.find(p => p.id === draggingId)
                  return pane ? (
                    <div className="drag-overlay-pane" style={{ '--pane-color': pane.borderColor } as React.CSSProperties}>
                      <div className="pane-header" style={{ borderBottom: `1px solid ${pane.borderColor}44` }}>
                        <span className="pane-ai-label" style={{ color: AI_CONFIG[pane.aiType].color, paddingLeft: 10 }}>
                          {AI_CONFIG[pane.aiType].label}
                        </span>
                        <span className="pane-account-name" style={{ paddingLeft: 6 }}>{pane.accountName}</span>
                      </div>
                    </div>
                  ) : null
                })()}
              </DragOverlay>
            </DndContext>
          </>
        )}
      </div>
      </div>

      <ConversationSidebar open={convSidebarOpen} onClose={() => setConvSidebarOpen(false)} />

      {globalSearchOpen && (
        <GlobalSearch onClose={() => setGlobalSearchOpen(false)} />
      )}

      {hubOpen && (
        <HubOverlay
          tabs={tabs}
          activeTabId={activeTabId}
          activePanes={activePanes}
          onClose={closeHub}
          onJump={handleHubJump}
          onTogglePin={handleHubTogglePin}
        />
      )}

      {commandPaletteOpen && (
        <CommandPalette
          onClose={() => setCommandPaletteOpen(false)}
          tabs={tabs}
          activeTabId={activeTabId}
          focusedPaneId={focusedPaneId}
          broadcastMode={broadcastMode}
          onTabSelect={(id) => { handleTabSelect(id) }}
          onWorkspaceLoad={loadWorkspace}
          onSnippetSend={(content) => { if (focusedPaneId) window.pty.write(focusedPaneId, content + '\n') }}
          onSnippetBroadcast={(content) => {
            const viewPanes = activeTab.isHub ? hubPanesRef.current : panes
            viewPanes.filter(p => isAgentPane(p.aiType)).forEach(p => window.pty.write(p.id, content + '\n'))
          }}
          onHistoryOpen={() => setConvSidebarOpen(true)}
          onNewTab={handleTabNew}
          onNewPane={addNextPane}
          onBroadcastToggle={() => setBroadcastMode(v => !v)}
          onHubOpen={openHub}
        />
      )}

      {addingPane !== null && (
        <NewPaneDialog
          onConfirm={addPane}
          onCancel={() => setAddingPane(null)}
          allowedAIs={planLimits.allowedAIs}
          onUpgrade={() => { setAddingPane(null); setShowUpgrade(true) }}
        />
      )}

      {showJoinViewer && (
        <SharedTerminalViewer onClose={() => setShowJoinViewer(false)} />
      )}

      {showUpgrade && (
        <UpgradeModal currentPlan={plan} onClose={() => setShowUpgrade(false)} />
      )}

      {teamsOpen && (
        <TeamsWorkspace
          onClose={() => { setTeamsOpen(false); refreshPendingInvitesCount() }}
          onLoad={loadWorkspace}
          onRequireUpgrade={() => setShowUpgrade(true)}
          onOpenRepoTerminal={openRepoInNewTab}
          onPendingInvitesChange={refreshPendingInvitesCount}
          onStartTutorial={() => setTutorialTour('teams')}
        />
      )}

      {myReposOpen && (
        <MyReposPanel
          onClose={() => setMyReposOpen(false)}
          githubToken={githubToken}
          githubLogin={githubLogin}
          onConnectGitHub={connectGitHub}
          onOpenRepoTerminal={openRepoInNewTab}
          onStartTutorial={() => setTutorialTour('my-repos')}
        />
      )}

      {joinRequest && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 500,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '16px 20px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', gap: 12, width: 280,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Guest wants to connect</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Someone is requesting interactive access to your terminal.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { terminalShareService.approveGuest(joinRequest.paneId); setJoinRequest(null) }}
              style={{ flex: 1, background: '#0066FF', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Allow
            </button>
            <button onClick={() => { terminalShareService.rejectGuest(joinRequest.paneId); setJoinRequest(null) }}
              style={{ flex: 1, background: '#7f1d1d', color: '#fca5a5', border: '1px solid #991b1b', borderRadius: 6, padding: '7px 0', fontSize: 12, cursor: 'pointer' }}>
              Deny
            </button>
          </div>
        </div>
      )}

      {confirmClose && (
        <ConfirmDialog
          title={confirmClose.isHub ? 'Close the Hub?' : `Close "${confirmClose.name}"?`}
          message={confirmClose.isHub
            ? 'This clears the terminals you pinned into the Hub. They stay open in their own workspaces — only the Hub set is cleared.'
            : 'There are terminals running in this workspace. They will all be closed.'}
          confirmLabel={confirmClose.isHub ? 'Close Hub' : 'Close'}
          confirmDanger
          onConfirm={() => { closeTab(confirmClose.tabId); setConfirmClose(null) }}
          onCancel={() => setConfirmClose(null)}
        />
      )}

      {activeTab.repoPath && (
        <NewWorktreeModal
          open={showNewWorktree}
          repoPath={activeTab.repoPath}
          onClose={() => setShowNewWorktree(false)}
          onCreated={(meta) => {
            setWorktreeRefreshKey(k => k + 1)
            void handleWorktreeSelect(meta.repoPath)
          }}
        />
      )}

      {activeTab.repoPath && (
        <QuickWorktreePalette
          open={quickWorktreeOpen}
          repoPath={activeTab.repoPath}
          onClose={() => setQuickWorktreeOpen(false)}
          onCreated={(meta) => {
            setWorktreeRefreshKey(k => k + 1)
            void handleWorktreeSelect(meta.repoPath)
          }}
        />
      )}

      <DiffViewerPanel
        open={diffViewerOpen}
        worktreePath={activeCellRepoPath ?? null}
        onClose={() => setDiffViewerOpen(false)}
      />
      {tutorialTour && (() => {
        const tour = getTour(tutorialTour)
        return tour ? <OnboardingTour steps={tour.steps} onClose={() => setTutorialTour(null)} /> : null
      })()}
    </div>
  )
}


function EmptyCell({ onClick }: { onClick: () => void }) {
  return (
    <div className="empty-cell" onClick={onClick}>
      <span className="empty-cell-icon">+</span>
      <span className="empty-cell-label">New Terminal</span>
    </div>
  )
}

function EmptyState({ onNewPane, onShowHub, hubCount }: { onNewPane: () => void; onShowHub?: () => void; hubCount?: number }) {
  return (
    <div className="empty-state">
      <div className="empty-logo">
        <img src={logoUrl} alt="Nest" className="empty-logo-img" />
      </div>
      <h1 className="empty-title">Nest</h1>
      <p className="empty-subtitle">Multi-AI Terminal Workspace by RAVEN</p>
      <button className="btn-primary" onClick={onNewPane}>
        + New Terminal
      </button>
      <p className="empty-hint">or press <kbd>{window.platform?.isWin ? 'Ctrl+T' : '⌘T'}</kbd></p>
      {onShowHub && (
        <>
          <div className="empty-or">or</div>
          <button className="empty-hub-btn" onClick={onShowHub}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            View all terminals in the Hub
            {hubCount ? <span className="empty-hub-count">{hubCount}</span> : null}
          </button>
        </>
      )}
    </div>
  )
}
