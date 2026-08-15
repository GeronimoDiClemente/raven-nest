import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { useBridge } from '../lib/bridge'
import { FileIcon } from './ExplorerPanel'
import { applyTheme, ensureLanguage, isMonacoBuiltinTheme } from '../lib/shiki-monaco'
import type { MonacoLike } from '../lib/shiki-monaco'
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

  // --- Shiki (tokenización TextMate + temas) -----------------------------
  // La instancia de monaco recién existe en onMount; hasta entonces el prop
  // `theme` del wrapper queda en un built-in seguro (ver themeForWrapper).
  const monacoRef = useRef<MonacoLike | null>(null)
  // ext → lang id de shiki, 'pending' mientras carga, o null si esa ext quedó
  // en Monarch (sin grammar o falla de carga). Es un REF, nunca state: un
  // state acá re-renderizaba al resolver el import y @monaco-editor/react
  // pisaba el buffer del editor con el prop `value` atrasado en medio del
  // tipeo — se comía keystrokes. El lenguaje se aplica imperativamente vía
  // setModelLanguage (preserva buffer y cursor), jamás por el prop `language`.
  const shikiLangsRef = useRef<Record<string, string | null | 'pending'>>({})
  const editorThemeRef = useRef(editorTheme)
  editorThemeRef.current = editorTheme

  const applyShikiLang = useCallback((ext: string, lang: string) => {
    const monaco = monacoRef.current
    if (!monaco) return
    for (const model of monaco.editor.getModels()) {
      if (model.uri.path.endsWith(`.${ext}`)) monaco.editor.setModelLanguage(model, lang)
    }
  }, [])

  // Monaco corre NO-controlado (defaultValue): pasar `value` por keystroke
  // deja una race — el onChange de Monaco programa un setContents, el commit
  // de React se difiere (p.ej. shiki tokenizando en el main thread), el
  // usuario mete otra tecla, y el wrapper pisa el buffer con el prop viejo
  // (keystroke comido; visto como '#edited' en E2E). Las escrituras al
  // modelo van imperativas y SOLO en cargas/recargas de disco.
  const setModelText = useCallback((relPath: string, text: string) => {
    const monaco = monacoRef.current
    if (!monaco) return
    const model = monaco.editor.getModels().find(
      (m) => m.uri.path === relPath || m.uri.path.endsWith(`/${relPath}`),
    )
    if (model && model.getValue() !== text) model.setValue(text)
  }, [])

  // Contador monotónico de ediciones por path. Las cargas de disco lo
  // capturan al DESPACHAR la lectura y lo re-chequean al resolver: si el
  // usuario tipeó en el medio, el buffer del editor es la verdad y el
  // resultado de esa lectura se descarta (pisarlo comería keystrokes).
  // "Tab dirty" no sirve como guarda: una tab restaurada dirty desde el
  // estado persistido TIENE que cargar de disco en el mount.
  const editSeqRef = useRef<Record<string, number>>({})

  const requestShikiLang = useCallback((relPath: string | undefined) => {
    const monaco = monacoRef.current
    if (!monaco || !relPath) return
    const ext = relPath.split('.').pop() ?? ''
    if (!ext) return
    const known = shikiLangsRef.current[ext]
    if (known === 'pending' || known === null) return
    if (typeof known === 'string') {
      // Grammar ya cargada: re-aplicar por si el modelo de esta tab es nuevo.
      applyShikiLang(ext, known)
      return
    }
    shikiLangsRef.current[ext] = 'pending'
    ensureLanguage(monaco, ext).then((lang) => {
      shikiLangsRef.current[ext] = lang
      if (lang) applyShikiLang(ext, lang)
    })
  }, [applyShikiLang])

  const handleEditorMount = useCallback((_editor: unknown, monaco: MonacoLike) => {
    monacoRef.current = monaco
    // applyTheme cae solo a vs-dark ante cualquier falla — el editor ya está
    // usable con Monarch antes de que esto resuelva.
    void applyTheme(monaco, editorThemeRef.current ?? 'vs-dark')
    requestShikiLang(activePathRef.current)
  }, [requestShikiLang])

  useEffect(() => {
    const monaco = monacoRef.current
    if (!monaco) return
    void applyTheme(monaco, editorTheme ?? 'vs-dark')
  }, [editorTheme])

  useEffect(() => {
    requestShikiLang(activePath)
  }, [activePath, requestShikiLang])

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
      const seqAtDispatch = editSeqRef.current[tab.relPath] ?? 0
      bridge.fs.readFile(worktreePath, tab.relPath).then((res) => {
        // Si el usuario tipeó mientras esta lectura estaba en vuelo, el
        // buffer del editor es la verdad — no pisarlo con lo (viejo) del disco.
        if ((editSeqRef.current[tab.relPath] ?? 0) !== seqAtDispatch) return
        if (res.ok) {
          eolRef.current[tab.relPath] = detectEol(res.content)
          setContents((c) => ({ ...c, [tab.relPath]: res.content }))
          setModelText(tab.relPath, res.content)
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
      const seqAtDispatch = editSeqRef.current[relPath] ?? 0
      bridge.fs.readFile(worktreePath, relPath).then((res) => {
        // Se re-chequea al RESOLVER: el chequeo de dirty de arriba corre
        // antes del round-trip de lectura y el usuario pudo tipear en el
        // medio — en ese caso esto ES un conflicto edits-vs-disco.
        if ((editSeqRef.current[relPath] ?? 0) !== seqAtDispatch) {
          setConflicts((c) => ({ ...c, [relPath]: true }))
          return
        }
        if (res.ok) {
          eolRef.current[relPath] = detectEol(res.content)
          setContents((c) => ({ ...c, [relPath]: res.content }))
          setModelText(relPath, res.content)
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
    editSeqRef.current[relPath] = (editSeqRef.current[relPath] ?? 0) + 1
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
      window.alert(`Could not save ${relPath}: ${res.error}`)
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
      setModelText(relPath, res.content)
      setConflicts((c) => ({ ...c, [relPath]: false }))
      setDirty(relPath, false)
    } else {
      // The reload didn't actually happen — the conflict is still real, and
      // the in-memory content is unchanged (still whatever it was before the
      // click), so `conflicts`/`dirty` must NOT be cleared. Same
      // window.alert precedent as save()'s failure path (no global toast
      // service exists — see design spec).
      window.alert(`Could not reload ${relPath} from disk: ${res.error}`)
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
            className={`editor-tab${tab.relPath === activePath ? ' active' : ''}${tab.dirty ? ' dirty' : ''}`}
            title={tab.relPath}
            onClick={() => onTabsChange(tabs, tab.relPath)}
          >
            <FileIcon name={tab.relPath} />
            <span className="editor-tab-name">{tab.relPath.split('/').pop()}</span>
            {/* Slot derecho estilo VS Code: el punto dirty se muestra hasta
                que el hover lo reemplaza por las acciones. */}
            {tab.dirty && <span className="editor-tab-dirty" data-testid={`dirty-${tab.relPath}`}>●</span>}
            <span className="editor-tab-actions">
              <button
                className="editor-tab-btn editor-tab-move"
                title="Open in new pane"
                onClick={(e) => { e.stopPropagation(); onOpenInNewPane(tab.relPath) }}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path d="M6.5 2.5H3a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5V9.5M9.5 2.5h4v4M13.5 2.5L8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                className="editor-tab-btn editor-tab-close"
                title="Close"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.relPath) }}
              >×</button>
            </span>
          </div>
        ))}
      </div>
      {activePath && conflicts[activePath] && (
        <div className="editor-conflict-banner" data-testid="conflict-banner">
          <span className="editor-conflict-text">File changed on disk.</span>
          <button className="editor-banner-btn" onClick={() => keepMine(activePath)}>Keep my changes</button>
          <button className="editor-banner-btn primary" onClick={() => reloadFromDisk(activePath)}>Reload from disk</button>
        </div>
      )}
      {activePath && loadErrors[activePath] ? (
        <div className="editor-file-unavailable" data-testid="file-unavailable">
          <FileIcon name={activePath} />
          <span className="editor-unavailable-text">{loadErrors[activePath]}</span>
          <button className="editor-banner-btn" onClick={() => closeTab(activePath)}>Close tab</button>
        </div>
      ) : activePath && (
        <Editor
          path={activePath}
          defaultValue={contents[activePath] ?? ''}
          onChange={(value) => handleChange(activePath, value)}
          // Con shiki cargado, el lenguaje del modelo pasa a ser el id que
          // registró shikiToMonaco (p.ej. 'tsx'); si shiki no cargó queda
          // undefined y Monaco infiere por extensión → Monarch, como antes.
          // El wrapper llama monaco.editor.setTheme(theme) por su cuenta; un
          // nombre no registrado (tema shiki aún no cargado) lo haría tirar.
          // Los no built-in los aplica applyTheme; acá va el fallback seguro.
          theme={editorTheme && isMonacoBuiltinTheme(editorTheme) ? editorTheme : 'vs-dark'}
          onMount={handleEditorMount}
          options={editorOptions}
        />
      )}
    </div>
  )
}
