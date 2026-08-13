import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { useBridge } from '../lib/bridge'
import type { EditorTab, PaneNode } from '../types'
import type { EditorPreferences, EditorTheme } from '../lib/ide-config-mappings'

// Monaco inserts its platform-default EOL (CRLF on Windows) for any line the
// user creates via Enter, regardless of the loaded file's own convention —
// it does not infer EOL from loaded content. Left unchecked, editing an
// LF file on Windows silently produces mixed LF/CRLF line endings on save.
function detectEol(content: string): '\n' | '\r\n' {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

function normalizeEol(content: string, eol: '\n' | '\r\n'): string {
  const withLf = content.replace(/\r\n/g, '\n')
  return eol === '\r\n' ? withLf.replace(/\n/g, '\r\n') : withLf
}

interface EditorPaneProps {
  pane: PaneNode
  onTabsChange: (tabs: EditorTab[], activeEditorTabPath: string | undefined) => void
  onClose: () => void
  onFocus: () => void
  onOpenInNewPane: (relPath: string) => void
  editorOptions?: EditorPreferences
  editorTheme?: EditorTheme
}

export function EditorPane({ pane, onTabsChange, onClose, onFocus, onOpenInNewPane, editorOptions, editorTheme }: EditorPaneProps) {
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
  const loadErrorsRef = useRef(loadErrors)
  loadErrorsRef.current = loadErrors
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activePathRef = useRef(activePath)
  activePathRef.current = activePath

  // watch()/unwatch() are un-awaited async IPC round-trips into a single,
  // non-ref-counted registry keyed by `worktreePath::relPath` (see
  // electron/fs-bridge.ts FsWatchRegistry). A watch effect that re-runs
  // (cleanup+setup) before the prior unwatch()'s async teardown has deleted
  // its key can race: watch()'s synchronous dedupe-check sees the key still
  // present and no-ops, then the in-flight unwatch() finishes and deletes it
  // anyway — leaving the file silently unwatched even though this component
  // believes it's watched. Ported from ExplorerPanel.tsx, which hit the same
  // bug class on directory watches: sequence watch/unwatch calls per key so
  // the last toggle always wins.
  const pendingOpsRef = useRef(new Map<string, Promise<void>>())
  const eolRef = useRef<Record<string, '\n' | '\r\n'>>({})
  const containerRef = useRef<HTMLDivElement>(null)

  const sequencedOp = useCallback((key: string, op: () => Promise<unknown>) => {
    const prior = pendingOpsRef.current.get(key) ?? Promise.resolve()
    const next = prior.then(() => op()).then(() => {}, () => {})
    pendingOpsRef.current.set(key, next)
    return next
  }, [])

  const sequencedWatch = useCallback((wt: string, relPath: string) => {
    return sequencedOp(`${wt}::${relPath}`, () => bridge.fs.watch(wt, relPath))
  }, [bridge, sequencedOp])

  const sequencedUnwatch = useCallback((wt: string, relPath: string) => {
    return sequencedOp(`${wt}::${relPath}`, () => bridge.fs.unwatch(wt, relPath))
  }, [bridge, sequencedOp])

  useEffect(() => {
    if (!worktreePath) return
    tabs.forEach((tab) => {
      if (contentsRef.current[tab.relPath] !== undefined) return
      bridge.fs.readFile(worktreePath, tab.relPath).then((res) => {
        if (res.ok) {
          eolRef.current[tab.relPath] = detectEol(res.content)
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
    tabs.forEach((tab) => sequencedWatch(worktreePath, tab.relPath))
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
          eolRef.current[relPath] = detectEol(res.content)
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
      tabs.forEach((tab) => sequencedUnwatch(worktreePath, tab.relPath))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, worktreePath, bridge, sequencedWatch, sequencedUnwatch])

  // Reads current tabs/activePath via refs instead of closing over the
  // `tabs`/`activePath` render-scoped variables. This matters for callers
  // that resolve asynchronously after the render that created them (see
  // `save()` below): without it, an in-flight save's completion would
  // clobber onTabsChange with a stale tabs/activePath snapshot from before
  // the user closed or switched tabs while the save was in flight. Refs are
  // kept in sync every render (see tabsRef/activePathRef above), so
  // synchronous callers (e.g. handleChange) see identical behavior to
  // before — they read the ref at the time they're invoked, same as they'd
  // have read the closure.
  const setDirty = useCallback((relPath: string, dirty: boolean) => {
    onTabsChange(tabsRef.current.map((t) => (t.relPath === relPath ? { ...t, dirty } : t)), activePathRef.current)
  }, [onTabsChange])

  const handleChange = useCallback((relPath: string, value: string | undefined) => {
    const eol = eolRef.current[relPath] ?? '\n'
    setContents((c) => ({ ...c, [relPath]: normalizeEol(value ?? '', eol) }))
    // Only flip dirty (and thus only churn a new tabs array reference via
    // onTabsChange) if the tab isn't ALREADY dirty. Without this, every
    // keystroke calls setDirty(relPath, true) unconditionally, .map()
    // returns a new array reference every time, and the parent hands this
    // component a new `tabs` prop reference on every keystroke — re-running
    // the watch effect's cleanup+setup for no state-meaningful reason and
    // opening the watch/unwatch race window on every keystroke.
    const tab = tabsRef.current.find((t) => t.relPath === relPath)
    if (tab?.dirty) return
    setDirty(relPath, true)
  }, [setDirty])

  const save = useCallback(async (relPath: string) => {
    if (!worktreePath) return
    const content = contentsRef.current[relPath]
    // The tab's content never loaded successfully (binary/oversized file,
    // still-in-flight initial read, or a failed re-read left `loadErrors`
    // set without ever refreshing `contents`) — `content` is `undefined` or
    // stale-relative-to-a-known-error. Writing anyway would truncate (or
    // resurrect with stale data) the file on disk. Bail out silently: the
    // "file unavailable" banner already communicates why, and a still-loading
    // read will complete and let a later Ctrl+S succeed normally.
    if (content === undefined || loadErrorsRef.current[relPath] !== undefined) return
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
    if (res.ok) {
      eolRef.current[relPath] = detectEol(res.content)
      setContents((c) => ({ ...c, [relPath]: res.content }))
      setConflicts((c) => ({ ...c, [relPath]: false }))
      setDirty(relPath, false)
    } else {
      // The reload didn't actually happen — the conflict is still real, and
      // the in-memory content is unchanged (still whatever it was before the
      // click), so `conflicts`/`dirty` must NOT be cleared. Same
      // window.alert precedent as save()'s failure path (no global toast
      // service exists — see design spec).
      window.alert(`No se pudo recargar ${relPath} desde disco: ${res.error}`)
    }
  }, [worktreePath, bridge, setDirty])

  const closeTab = useCallback((relPath: string) => {
    const nextTabs = tabs.filter((t) => t.relPath !== relPath)
    const nextActive = activePath === relPath ? nextTabs[0]?.relPath : activePath
    onTabsChange(nextTabs, nextActive)
    // Purge every per-path cache for the closed tab. Without this, reopening
    // the same relPath later (a brand-new tab entry, but the same key into
    // these Record<string, ...> caches) resurrects whatever was here before
    // — including discarded, unsaved edits — and shows it marked NOT dirty,
    // so a subsequent Ctrl+S silently writes the forgotten changes back out.
    setContents((c) => { const { [relPath]: _drop, ...rest } = c; return rest })
    setConflicts((c) => { const { [relPath]: _drop, ...rest } = c; return rest })
    setLoadErrors((e) => { const { [relPath]: _drop, ...rest } = e; return rest })
    delete eolRef.current[relPath]
    if (nextTabs.length === 0) onClose()
  }, [tabs, activePath, onTabsChange, onClose])

  useEffect(() => {
    // Scoped to THIS pane's own container, not `window`: with multiple
    // editor panes open, a window-level listener fires save() for every
    // pane's active file on a single Ctrl+S — even one triggered from a
    // terminal pane, since the keydown bubbles up from xterm's textarea
    // through the DOM to `window` regardless of which pane it originated in.
    const el = containerRef.current
    if (!el) return
    const onKeyDown = (e: KeyboardEvent) => {
      const isSave = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's'
      if (isSave && activePath) {
        e.preventDefault()
        save(activePath)
      }
    }
    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [activePath, save])

  return (
    <div className="editor-pane" data-testid="editor-pane" onFocus={onFocus} tabIndex={-1} ref={containerRef}>
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
        <Editor
          path={activePath}
          value={contents[activePath] ?? ''}
          onChange={(value) => handleChange(activePath, value)}
          theme={editorTheme ?? 'vs-dark'}
          options={editorOptions}
        />
      )}
    </div>
  )
}
