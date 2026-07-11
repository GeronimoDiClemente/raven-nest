import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { useBridge } from '../lib/bridge'
import type { EditorTab, PaneNode } from '../types'

interface EditorPaneProps {
  pane: PaneNode
  onTabsChange: (tabs: EditorTab[], activeEditorTabPath: string | undefined) => void
  onClose: () => void
  onFocus: () => void
  onOpenInNewPane: (relPath: string) => void
}

export function EditorPane({ pane, onTabsChange, onClose, onFocus, onOpenInNewPane }: EditorPaneProps) {
  const bridge = useBridge()
  const worktreePath = pane.repoPath
  const tabs = pane.editorTabs ?? []
  const activePath = pane.activeEditorTabPath ?? tabs[0]?.relPath

  const [contents, setContents] = useState<Record<string, string>>({})
  const [conflicts, setConflicts] = useState<Record<string, boolean>>({})
  // Read failures: initial open of a binary/oversized file, or a re-read after
  // a disk change fails (typically ENOENT — the file/worktree was removed).
  // Distinct from `conflicts`, which is only about unsaved-edits-vs-disk.
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({})
  const contentsRef = useRef(contents)
  contentsRef.current = contents
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  useEffect(() => {
    if (!worktreePath) return
    tabs.forEach((tab) => {
      if (contentsRef.current[tab.relPath] !== undefined) return
      bridge.fs.readFile(worktreePath, tab.relPath).then((res) => {
        if (res.ok) {
          setContents((c) => ({ ...c, [tab.relPath]: res.content }))
          setLoadErrors((e) => { const { [tab.relPath]: _drop, ...rest } = e; return rest })
        } else {
          setLoadErrors((e) => ({ ...e, [tab.relPath]: res.error }))
        }
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, worktreePath, bridge])

  useEffect(() => {
    if (!worktreePath) return
    tabs.forEach((tab) => bridge.fs.watch(worktreePath, tab.relPath))
    const unsubscribe = bridge.fs.onChanged((changedWorktree, relPath) => {
      if (changedWorktree !== worktreePath) return
      const tab = tabsRef.current.find((t) => t.relPath === relPath)
      if (!tab) return
      if (tab.dirty) {
        setConflicts((c) => ({ ...c, [relPath]: true }))
        return
      }
      bridge.fs.readFile(worktreePath, relPath).then((res) => {
        if (res.ok) {
          setContents((c) => ({ ...c, [relPath]: res.content }))
          setLoadErrors((e) => { const { [relPath]: _drop, ...rest } = e; return rest })
        } else {
          // Most commonly ENOENT — the file (or its whole worktree) was
          // removed on disk. No proactive pane teardown on worktree:remove
          // exists in this codebase for any pane type (see design spec,
          // "Manejo de errores") — this reuses the same watch/read path
          // conflicts already go through, so it needs no separate listener.
          setLoadErrors((e) => ({ ...e, [relPath]: res.error }))
        }
      })
    })
    return () => {
      unsubscribe()
      tabs.forEach((tab) => bridge.fs.unwatch(worktreePath, tab.relPath))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, worktreePath, bridge])

  const setDirty = useCallback((relPath: string, dirty: boolean) => {
    onTabsChange(tabs.map((t) => (t.relPath === relPath ? { ...t, dirty } : t)), activePath)
  }, [tabs, activePath, onTabsChange])

  const handleChange = useCallback((relPath: string, value: string | undefined) => {
    setContents((c) => ({ ...c, [relPath]: value ?? '' }))
    setDirty(relPath, true)
  }, [setDirty])

  const save = useCallback(async (relPath: string) => {
    if (!worktreePath) return
    const content = contentsRef.current[relPath] ?? ''
    const res = await bridge.fs.writeFile(worktreePath, relPath, content)
    if (res.ok) {
      setDirty(relPath, false)
      setConflicts((c) => ({ ...c, [relPath]: false }))
    } else {
      // No global toast service exists in this app (see design spec) — the
      // established precedent for surfacing a rare failure immediately is
      // window.alert (src/App.tsx:537-541, WorktreesSection.tsx:160).
      window.alert(`No se pudo guardar ${relPath}: ${res.error}`)
    }
  }, [worktreePath, bridge, setDirty])

  const keepMine = useCallback((relPath: string) => {
    setConflicts((c) => ({ ...c, [relPath]: false }))
  }, [])

  const reloadFromDisk = useCallback(async (relPath: string) => {
    if (!worktreePath) return
    const res = await bridge.fs.readFile(worktreePath, relPath)
    if (res.ok) setContents((c) => ({ ...c, [relPath]: res.content }))
    setConflicts((c) => ({ ...c, [relPath]: false }))
    setDirty(relPath, false)
  }, [worktreePath, bridge, setDirty])

  const closeTab = useCallback((relPath: string) => {
    const nextTabs = tabs.filter((t) => t.relPath !== relPath)
    const nextActive = activePath === relPath ? nextTabs[0]?.relPath : activePath
    onTabsChange(nextTabs, nextActive)
    if (nextTabs.length === 0) onClose()
  }, [tabs, activePath, onTabsChange, onClose])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isSave = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's'
      if (isSave && activePath) {
        e.preventDefault()
        save(activePath)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activePath, save])

  return (
    <div className="editor-pane" onFocus={onFocus} tabIndex={-1}>
      <div className="editor-pane-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.relPath}
            className={`editor-tab${tab.relPath === activePath ? ' active' : ''}`}
            onClick={() => onTabsChange(tabs, tab.relPath)}
          >
            <span className="editor-tab-name">{tab.relPath.split('/').pop()}</span>
            {tab.dirty && <span className="editor-tab-dirty" data-testid={`dirty-${tab.relPath}`}>●</span>}
            <button
              className="editor-tab-move"
              title="Abrir en pane nuevo"
              onClick={(e) => { e.stopPropagation(); onOpenInNewPane(tab.relPath) }}
            >⇱</button>
            <button className="editor-tab-close" onClick={(e) => { e.stopPropagation(); closeTab(tab.relPath) }}>×</button>
          </div>
        ))}
      </div>
      {activePath && conflicts[activePath] && (
        <div className="editor-conflict-banner" data-testid="conflict-banner">
          El archivo cambió en disco.
          <button onClick={() => keepMine(activePath)}>Mantener mis cambios</button>
          <button onClick={() => reloadFromDisk(activePath)}>Recargar de disco</button>
        </div>
      )}
      {activePath && loadErrors[activePath] ? (
        <div className="editor-file-unavailable" data-testid="file-unavailable">
          {loadErrors[activePath]}
          <button onClick={() => closeTab(activePath)}>Cerrar</button>
        </div>
      ) : activePath && (
        <Editor path={activePath} value={contents[activePath] ?? ''} onChange={(value) => handleChange(activePath, value)} theme="vs-dark" />
      )}
    </div>
  )
}
