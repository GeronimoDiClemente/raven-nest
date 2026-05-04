import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCenter
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { PaneNode, AIType, GridLayout, AI_CONFIG, SessionData, SessionPane, Workspace, WorkspaceTab, equalSizes } from './types'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import TerminalPane from './components/TerminalPane'
import NewPaneDialog from './components/NewPaneDialog'
import TabBar from './components/TabBar'
import ConfirmDialog from './components/ConfirmDialog'
import ConversationSidebar from './components/ConversationSidebar'
import Sidebar from './components/Sidebar'
import GlobalSearch from './components/GlobalSearch'
import CommandPalette from './components/CommandPalette'
import { focusTerminal } from './terminal-registry'
import logoUrl from './assets/logo.png'
import { useProfile } from './hooks/useProfile'
import { PLAN_LIMITS } from './lib/stripe'
import UpgradeModal from './components/UpgradeModal'
import TeamsWorkspace from './components/TeamsWorkspace'
import MyReposPanel from './components/MyReposPanel'
import { useGitHub } from './hooks/useGitHub'
import { usePendingInvitesCount } from './hooks/usePendingInvitesCount'
import { useSpeechRecognition } from './hooks/useSpeechRecognition'
import { useSettings } from './hooks/useSettings'
import { matchesBinding } from './lib/keybindings'
import { useUserPreferences } from './hooks/useUserPreferences'
import SharedTerminalViewer from './components/SharedTerminalViewer'
import { terminalShareService } from './lib/terminalShareService'


let paneCounter = 0
const generateId = () => `pane-${++paneCounter}-${Date.now()}`

export default function App() {
  const generateTabId = () => `tab-${Date.now()}`

  const initialTabId = useRef(`tab-${Date.now()}`).current
  const [tabs, setTabs] = useState<WorkspaceTab[]>([{
    id: initialTabId,
    name: 'Workspace',
    layout: { rows: 1, cols: 1 },
    colSizes: [equalSizes(1)],
    rowSizes: equalSizes(1),
    cells: [null],
  }])
  const [activeTabId, setActiveTabId] = useState<string>(initialTabId)
  const [confirmClose, setConfirmClose] = useState<{ tabId: string; name: string } | null>(null)

  // Derive active tab data
  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0]
  const layout = activeTab.layout
  const cells = activeTab.cells
  const colSizes: number[][] = activeTab.colSizes ?? Array.from({ length: layout.rows }, () => equalSizes(layout.cols))
  const rowSizes = activeTab.rowSizes ?? equalSizes(layout.rows)
  const cellsRef = useRef(cells)
  cellsRef.current = cells

  const updateActiveTab = useCallback((updater: (tab: WorkspaceTab) => WorkspaceTab) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? updater(t) : t))
  }, [activeTabId])

  const updateColSizesForRow = useCallback((rowIndex: number, sizes: number[]) => {
    updateActiveTab(t => {
      const next = [...(t.colSizes ?? [])]
      next[rowIndex] = sizes
      return { ...t, colSizes: next }
    })
  }, [updateActiveTab])

  const updateRowSizes = useCallback((sizes: number[]) => {
    updateActiveTab(t => ({ ...t, rowSizes: sizes }))
  }, [updateActiveTab])

  const [addingToCell, setAddingToCell] = useState<number | null>(null)
  const [zoomedCell, setZoomedCell] = useState<number | null>(null)
  const [zoomingOut, setZoomingOut] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [broadcastMode, setBroadcastMode] = useState(false)
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null)
  const focusedPaneIdRef = useRef<string | null>(null)
  const [convSidebarOpen, setConvSidebarOpen] = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem('nest-font-size')
    return saved ? parseInt(saved, 10) : 13
  })

  // Activity tracking: tabId -> Set of cell indices with recent activity
  const [tabActivity, setTabActivity] = useState<Map<string, Set<number>>>(new Map())
  const activeTabActivity = tabActivity.get(activeTabId) ?? new Set()

  // Busy state: paneId -> boolean
  const [busyPanes, setBusyPanes] = useState<Set<string>>(new Set())

  const handleBusyChange = useCallback((paneId: string, busy: boolean) => {
    setBusyPanes(prev => {
      const next = new Set(prev)
      if (busy) next.add(paneId)
      else next.delete(paneId)
      return next
    })
  }, [])

  const handlePaneActivity = useCallback((cellIndex: number, active: boolean) => {
    setTabActivity(prev => {
      const next = new Map(prev)
      const tabSet = new Set(next.get(activeTabId) ?? new Set())
      if (active) tabSet.add(cellIndex)
      else tabSet.delete(cellIndex)
      next.set(activeTabId, tabSet)
      return next
    })
  }, [activeTabId])

  // Auto-clear activity indicators after 3s
  useEffect(() => {
    const interval = setInterval(() => {
      setTabActivity(prev => {
        const next = new Map(prev)
        for (const [tabId, cells] of next) {
          if (cells.size > 0) {
            next.set(tabId, new Set())
          }
        }
        return next
      })
    }, 3000)
    return () => clearInterval(interval)
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

  // Request notification permission once
  useEffect(() => {
    if (Notification.permission === 'default') Notification.requestPermission()
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const applyLayout = useCallback((newLayout: GridLayout) => {
    // Feature gating — clamp to plan limits
    const clampedLayout = {
      rows: Math.min(newLayout.rows, planLimits.maxRows),
      cols: Math.min(newLayout.cols, planLimits.maxCols),
    }
    if (clampedLayout.rows < newLayout.rows || clampedLayout.cols < newLayout.cols) {
      setShowUpgrade(true)
    }
    const total = clampedLayout.rows * clampedLayout.cols
    updateActiveTab(t => ({
      ...t,
      layout: clampedLayout,
      colSizes: Array.from({ length: clampedLayout.rows }, () => equalSizes(clampedLayout.cols)),
      rowSizes: equalSizes(clampedLayout.rows),
      cells: Array.from({ length: total }, (_, i) => t.cells[i] ?? null),
    }))
  }, [updateActiveTab, planLimits])

  const activePaneIds = useMemo(
    () => cells.filter(Boolean).map((c) => c!.id),
    [cells]
  )

  const addPane = useCallback((
    aiType: AIType, accountName: string, accountDir: string, borderColor: string,
    cmd: string, customLabel?: string, customColor?: string
  ) => {
    if (addingToCell === null) return
    updateActiveTab(t => {
      const pane: PaneNode = { id: generateId(), aiType, accountName, accountDir, borderColor, cmd, customLabel, customColor, repoPath: t.repoPath }
      const next = [...t.cells]
      next[addingToCell] = pane
      return { ...t, cells: next }
    })
    setAddingToCell(null)
  }, [addingToCell, updateActiveTab])

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
      for (const cell of cellsRef.current) {
        if (cell && cell.cmd === '' && await window.pty.exists(cell.id)) {
          window.pty.write(cell.id, cdCmd)
        }
      }

      updateActiveTab(t => ({
        ...t,
        repoPath: path,
        cells: t.cells.map(c => c ? { ...c, repoPath: path } : null),
      }))
    } catch (err) {
      console.error('handleRepoLink error:', err)
    }
  }, [updateActiveTab])

  const handleRepoUnlink = useCallback(() => {
    updateActiveTab(t => ({
      ...t,
      repoPath: undefined,
      cells: t.cells.map(c => c ? { ...c, repoPath: undefined } : null),
    }))
  }, [updateActiveTab])

  const removePane = useCallback((cellIndex: number) => {
    const pane = cellsRef.current[cellIndex]
    if (pane) window.pty.kill(pane.id)
    updateActiveTab(t => {
      const next = [...t.cells]
      next[cellIndex] = null
      return { ...t, cells: next }
    })
  }, [updateActiveTab])

  const updatePaneColor = useCallback((cellIndex: number, borderColor: string) => {
    updateActiveTab(t => {
      const next = [...t.cells]
      if (next[cellIndex]) next[cellIndex] = { ...next[cellIndex]!, borderColor }
      return { ...t, cells: next }
    })
  }, [updateActiveTab])

  const updatePaneNote = useCallback((cellIndex: number, note: string) => {
    updateActiveTab(t => {
      const next = [...t.cells]
      if (next[cellIndex]) next[cellIndex] = { ...next[cellIndex]!, note }
      return { ...t, cells: next }
    })
  }, [updateActiveTab])

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setDraggingId(String(e.active.id))
  }, [])

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setDraggingId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const fromIdx = Number(active.id)
    const toIdx = Number(over.id)
    if (isNaN(fromIdx) || isNaN(toIdx)) return
    updateActiveTab(t => {
      const next = [...t.cells]
      ;[next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]]
      return { ...t, cells: next }
    })
  }, [updateActiveTab])

  const handleUnzoom = useCallback(() => {
    setZoomingOut(true)
    setTimeout(() => {
      setZoomedCell(null)
      setZoomingOut(false)
    }, 300)
  }, [])

  const handleZoom = useCallback((cellIndex: number) => {
    if (zoomedCell === cellIndex) {
      handleUnzoom()
    } else {
      setZoomingOut(false)
      setZoomedCell(cellIndex)
    }
  }, [zoomedCell, handleUnzoom])

  const saveWorkspace = useCallback(async (name: string) => {
    const ws: Workspace = {
      id: `ws-${Date.now()}`,
      name,
      layout,
      colSizes,
      rowSizes,
      cells: cellsRef.current.map((c) => c ? {
        aiType: c.aiType,
        accountName: c.accountName,
        accountDir: c.accountDir,
        borderColor: c.borderColor,
        cmd: c.cmd,
        customLabel: c.customLabel,
        customColor: c.customColor,
        note: c.note,
      } : null),
      resumeLastSession: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      repoPath: activeTab.repoPath,
    }
    await window.workspaces.save(ws)
  }, [layout, colSizes, rowSizes, activeTab.repoPath])

  const loadWorkspace = useCallback((ws: Workspace) => {
    const id = generateTabId()
    const total = ws.layout.rows * ws.layout.cols
    const restoredCells = Array.from({ length: total }, (_, i) => {
      const sp = ws.cells[i]
      if (!sp) return null
      return { ...sp, id: generateId() } as PaneNode
    })
    const newTab: WorkspaceTab = {
      id,
      name: ws.name,
      layout: ws.layout,
      colSizes: ws.colSizes ?? Array.from({ length: ws.layout.rows }, () => equalSizes(ws.layout.cols)),
      rowSizes: ws.rowSizes ?? equalSizes(ws.layout.rows),
      cells: restoredCells,
      repoPath: ws.repoPath,
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(id)
  }, [])

  const handleTabNew = useCallback(() => {
    const id = generateTabId()
    const newTab: WorkspaceTab = {
      id,
      name: 'Workspace',
      layout: { rows: 1, cols: 1 },
      colSizes: [equalSizes(1)],
      rowSizes: equalSizes(1),
      cells: [null],
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(id)
  }, [])

  const openRepoInNewTab = useCallback((repoFullName: string, localPath: string) => {
    const id = generateTabId()
    const folderName = repoFullName.includes('/') ? repoFullName.split('/')[1] : repoFullName
    const newTab: WorkspaceTab = {
      id,
      name: folderName,
      layout: { rows: 1, cols: 1 },
      colSizes: [equalSizes(1)],
      rowSizes: equalSizes(1),
      cells: [null],
      repoPath: localPath,
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(id)
    setMyReposOpen(false)
    setTeamsOpen(false)
  }, [])

  const handleTabSelect = useCallback((id: string) => {
    setActiveTabId(id)
  }, [])

  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const zoomedCellRef = useRef(zoomedCell)
  zoomedCellRef.current = zoomedCell

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
    if (tab) tab.cells.forEach(c => { if (c) window.pty.kill(c.id) })
    setTabActivity(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id)
      if (next.length === 0) {
        const fallbackId = generateTabId()
        const fallback: WorkspaceTab = {
          id: fallbackId,
          name: 'Workspace',
          layout: { rows: 1, cols: 1 },
          colSizes: [equalSizes(1)],
          rowSizes: equalSizes(1),
          cells: [null],
        }
        setActiveTabId(fallbackId)
        return [fallback]
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
    const hasTerminals = tab.cells.some(c => c !== null)
    if (hasTerminals) {
      setConfirmClose({ tabId: id, name: tab.name })
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

  // Open dialog for next empty cell, or expand grid if full
  const addNextPane = useCallback(() => {
    const emptyIdx = cells.findIndex((c) => c === null)
    if (emptyIdx !== -1) {
      setAddingToCell(emptyIdx)
      return
    }
    const { rows, cols } = layout
    const newLayout = cols <= rows ? { rows, cols: cols + 1 } : { rows: rows + 1, cols }
    const newTotal = newLayout.rows * newLayout.cols
    updateActiveTab(t => ({
      ...t,
      layout: newLayout,
      colSizes: Array.from({ length: newLayout.rows }, () => equalSizes(newLayout.cols)),
      rowSizes: equalSizes(newLayout.rows),
      cells: [...t.cells, ...Array(newTotal - t.cells.length).fill(null)],
    }))
    setAddingToCell(newTotal - 1)
  }, [cells, layout, updateActiveTab])

  // Load session on startup
  useEffect(() => {
    window.session.load().then((data) => {
      if (!data) return

      const COLOR_MIGRATION: Record<string, string> = {
        '#3B82F6': '#0055FF', '#EF4444': '#FF1A1A', '#10B981': '#00CC44',
        '#F59E0B': '#FFB800', '#8B5CF6': '#CC44FF', '#EC4899': '#FF2D78',
        '#06B6D4': '#00CCCC', '#F97316': '#FF6600', '#6366F1': '#4455FF',
        '#84CC16': '#88FF00', '#6B7280': '#666666',
      }

      const restoreCells = (rawCells: (SessionPane | null)[], total: number): (PaneNode | null)[] =>
        Array.from({ length: total }, (_, i) => {
          const sp = rawCells[i]
          if (!sp) return null
          const borderColor = COLOR_MIGRATION[sp.borderColor] ?? sp.borderColor
          return { ...sp, id: generateId(), cmd: sp.cmd ?? AI_CONFIG[sp.aiType]?.cmd ?? '', borderColor } as PaneNode
        })

      // v1 legacy format: single layout + cells at root
      if (!data.tabs && data.layout && data.cells) {
        const total = data.layout.rows * data.layout.cols
        const id = `tab-${Date.now()}`
        setTabs([{
          id,
          name: 'Workspace',
          layout: data.layout,
          colSizes: Array.from({ length: data.layout.rows }, () => equalSizes(data.layout.cols)),
          rowSizes: equalSizes(data.layout.rows),
          cells: restoreCells(data.cells, total),
        }])
        setActiveTabId(id)
        return
      }

      // v2 format: tabs array
      if (data.tabs && data.tabs.length > 0) {
        const restoredTabs: WorkspaceTab[] = data.tabs.map(tab => ({
          id: tab.id,
          name: tab.name,
          accentColor: tab.accentColor,
          repoPath: tab.repoPath,
          layout: tab.layout,
          colSizes: tab.colSizes ?? Array.from({ length: tab.layout.rows }, () => equalSizes(tab.layout.cols)),
          rowSizes: tab.rowSizes ?? equalSizes(tab.layout.rows),
          cells: restoreCells(tab.cells, tab.layout.rows * tab.layout.cols),
        }))
        setTabs(restoredTabs)
        setActiveTabId(data.activeTabId ?? restoredTabs[0].id)
      }
    })
  }, [])

  // Save session on changes (debounced 800ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      const sessionData: SessionData = {
        tabs: tabs.map(tab => ({
          id: tab.id,
          name: tab.name,
          accentColor: tab.accentColor,
          repoPath: tab.repoPath,
          layout: tab.layout,
          colSizes: tab.colSizes,
          rowSizes: tab.rowSizes,
          cells: tab.cells.map(c => c ? {
            aiType: c.aiType, accountName: c.accountName, accountDir: c.accountDir,
            borderColor: c.borderColor, cmd: c.cmd,
            customLabel: c.customLabel, customColor: c.customColor, note: c.note,
          } : null),
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
        toggleListening()
        return
      }

      if (e.key === 'Escape' && zoomedCell !== null) { handleUnzoom(); return }

      if (!e.metaKey && !e.ctrlKey) return

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
        if (zoomedCellRef.current !== null) { handleUnzoom(); return }
        const focusedId = focusedPaneIdRef.current
        if (!focusedId) return
        const cellIdx = cellsRef.current.findIndex(c => c?.id === focusedId)
        if (cellIdx >= 0) handleZoom(cellIdx)
        return
      }

      // Cmd+1-9 — jump to Nth pane (not configurable, stays hardcoded)
      const n = parseInt(e.key, 10)
      if (!isNaN(n) && n >= 1 && n <= 9) {
        e.preventDefault()
        const activePanes = cellsRef.current.filter(Boolean)
        const target = activePanes[n - 1]
        if (target) {
          setFocusedPaneId(target.id)
          focusedPaneIdRef.current = target.id
          focusTerminal(target.id)
        }
        return
      }

      if (matchesBinding(e, kb.globalSearch)) { e.preventDefault(); setGlobalSearchOpen(true); return }
      if (matchesBinding(e, kb.commandPalette)) { e.preventDefault(); setCommandPaletteOpen(v => !v); return }

      if (matchesBinding(e, kb.nextPane) || matchesBinding(e, kb.prevPane)) {
        e.preventDefault()
        const activePanes = cellsRef.current.filter(Boolean)
        if (activePanes.length === 0) return
        const currentIdx = activePanes.findIndex(p => p!.id === focusedPaneIdRef.current)
        const isNext = matchesBinding(e, kb.nextPane)
        const next = isNext
          ? (currentIdx + 1) % activePanes.length
          : (currentIdx - 1 + activePanes.length) % activePanes.length
        const target = activePanes[next]!
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
  }, [addNextPane, toggleListening, cycleTab])

  const totalCells = layout.rows * layout.cols
  const hasAnyPane = cells.some((c) => c !== null)
  const isInitialState = !hasAnyPane && totalCells <= 1

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
        layout={layout}
        onLayoutChange={applyLayout}
        onNewPane={addNextPane}
        onHistoryOpen={() => setConvSidebarOpen(true)}
        onSnippetSend={(content) => {
          const id = focusedPaneIdRef.current
          if (id) window.pty.write(id, content + '\r')
        }}
        onSnippetBroadcast={(content) => {
          activePaneIds.forEach((id) => window.pty.write(id, content + '\r'))
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
          if (plan !== 'team') { setShowUpgrade(true); return }
          setTeamsOpen(true)
        }}
        pendingInvitesCount={pendingInvitesCount}
        onMyReposOpen={() => {
          if (plan !== 'pro' && plan !== 'team') { setShowUpgrade(true); return }
          setMyReposOpen(true)
        }}
        plan={plan}
        repoPath={activeTab.repoPath}
        onRepoLink={handleRepoLink}
        onRepoUnlink={handleRepoUnlink}
        isListening={isListening}
        isTranscribing={isTranscribing}
        isModelLoading={isModelLoading}
        onMicToggle={toggleListening}
        onJoinTerminal={() => setShowJoinViewer(true)}
      />
      <div className="workspace">
        {isInitialState ? (
          <EmptyState onNewPane={() => setAddingToCell(0)} />
        ) : (
          <>
          {zoomedCell !== null && (
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
            <SortableContext
              items={Array.from({ length: totalCells }, (_, i) => String(i))}
              strategy={rectSortingStrategy}
            >
              <PanelGroup
                key={`${activeTabId}-${layout.rows}-${layout.cols}`}
                direction="vertical"
                className="grid-workspace"
                onLayout={updateRowSizes}
              >
                {Array.from({ length: layout.rows }).map((_, r) => (
                  <React.Fragment key={r}>
                    {r > 0 && (
                      <PanelResizeHandle
                        className={`resize-handle resize-handle--row${zoomedCell !== null ? ' resize-handle--disabled' : ''}`}
                      />
                    )}
                    <Panel defaultSize={rowSizes[r]}>
                      <PanelGroup
                        direction="horizontal"
                        onLayout={(sizes) => updateColSizesForRow(r, sizes)}
                      >
                        {Array.from({ length: layout.cols }).map((_, c) => {
                          const i = r * layout.cols + c
                          const pane = cells[i] ?? null
                          const rowColSizes = colSizes[r] ?? equalSizes(layout.cols)
                          return (
                            <React.Fragment key={c}>
                              {c > 0 && (
                                <PanelResizeHandle
                                  className={`resize-handle resize-handle--col${zoomedCell !== null ? ' resize-handle--disabled' : ''}`}
                                />
                              )}
                              <Panel defaultSize={rowColSizes[c]}>
                                {pane ? (
                                  <TerminalPane
                                    key={pane.id}
                                    cellId={String(i)}
                                    pane={pane}
                                    isDragging={draggingId === String(i)}
                                    zoomed={zoomedCell === i}
                                    zoomingOut={zoomedCell === i && zoomingOut}
                                    onZoom={() => handleZoom(i)}
                                    onClose={() => { removePane(i); if (zoomedCell === i) { setZoomedCell(null); setZoomingOut(false) } }}
                                    onColorChange={(c) => updatePaneColor(i, c)}
                                    onNoteChange={(note) => updatePaneNote(i, note)}
                                    fontSize={fontSize}
                                    onInput={(data) => {
                                      const targets = broadcastMode ? activePaneIds : [pane.id]
                                      targets.forEach((id) => window.pty.write(id, data))
                                    }}
                                    onFocus={() => {
                                      setFocusedPaneId(pane.id)
                                      focusedPaneIdRef.current = pane.id
                                    }}
                                    onBusyChange={handleBusyChange}
                                    onActivity={(paneId, active) => handlePaneActivity(i, active)}
                                    onJoinRequest={(paneId) => setJoinRequest({ paneId, paneTitle: pane.customLabel ?? pane.accountName ?? 'Terminal' })}
                                  />
                                ) : (
                                  <EmptyCell key={`empty-${i}`} cellId={String(i)} onClick={() => setAddingToCell(i)} />
                                )}
                              </Panel>
                            </React.Fragment>
                          )
                        })}
                      </PanelGroup>
                    </Panel>
                  </React.Fragment>
                ))}
              </PanelGroup>
            </SortableContext>
            <DragOverlay>
              {draggingId !== null && (() => {
                const i = Number(draggingId)
                const pane = cells[i]
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
          onSnippetBroadcast={(content) => { cells.filter(Boolean).forEach(p => window.pty.write(p!.id, content + '\n')) }}
          onHistoryOpen={() => setConvSidebarOpen(true)}
          onNewTab={handleTabNew}
          onNewPane={addNextPane}
          onBroadcastToggle={() => setBroadcastMode(v => !v)}
        />
      )}

      {addingToCell !== null && (
        <NewPaneDialog
          onConfirm={addPane}
          onCancel={() => setAddingToCell(null)}
          allowedAIs={planLimits.allowedAIs}
          onUpgrade={() => { setAddingToCell(null); setShowUpgrade(true) }}
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
        />
      )}

      {myReposOpen && (
        <MyReposPanel
          onClose={() => setMyReposOpen(false)}
          githubToken={githubToken}
          githubLogin={githubLogin}
          onConnectGitHub={connectGitHub}
          onOpenRepoTerminal={openRepoInNewTab}
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
          title={`Close "${confirmClose.name}"?`}
          message="There are terminals running in this workspace. They will all be closed."
          confirmLabel="Close"
          confirmDanger
          onConfirm={() => { closeTab(confirmClose.tabId); setConfirmClose(null) }}
          onCancel={() => setConfirmClose(null)}
        />
      )}
    </div>
  )
}


function EmptyCell({ cellId, onClick, style: outerStyle }: { cellId: string; onClick: () => void; style?: React.CSSProperties }) {
  const { setNodeRef, transform, transition, isOver } = useSortable({ id: cellId })
  const style: React.CSSProperties = {
    ...outerStyle,
    transform: CSS.Transform.toString(transform),
    transition,
    outline: isOver ? '2px solid #0066FF66' : undefined,
    outlineOffset: isOver ? '-2px' : undefined,
  }
  return (
    <div ref={setNodeRef} className="empty-cell" style={style} onClick={onClick}>
      <span className="empty-cell-icon">+</span>
      <span className="empty-cell-label">New Terminal</span>
    </div>
  )
}

function EmptyState({ onNewPane }: { onNewPane: () => void }) {
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
    </div>
  )
}

