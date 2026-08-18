import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { useBridge } from '../lib/bridge'
import { FileIcon } from './ExplorerPanel'
import { applyTheme, ensureLanguage, isMonacoBuiltinTheme } from '../lib/shiki-monaco'
import { stashTabBuffer, takeTabBuffer, dropTabBuffer } from '../lib/editor-buffer-handoff'
import { modelPathFor } from '../lib/editor-model-path'
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

// UN solo import dinámico compartido entre todos los panes: monaco-setup es
// idempotente pero dos import() concurrentes del mismo módulo pueden no
// resolver ambos .then en algunos runners (visto en vitest) — y compartir el
// promise es lo correcto de todos modos.
let monacoSetupPromise: Promise<unknown> | null = null
function ensureMonacoSetup(): Promise<unknown> {
  monacoSetupPromise ??= import('../lib/monaco-setup')
  return monacoSetupPromise
}

interface EditorPaneProps {
  pane: PaneNode
  onTabsChange: (tabs: EditorTab[], activeEditorTabPath: string | undefined) => void
  onClose: () => void
  onFocus: () => void
  onOpenInNewPane: (relPath: string) => void
  // Drag & drop: una tab de OTRO pane soltada acá (mismo worktree; el buffer
  // sin guardar viaja por editor-buffer-handoff), o un archivo del Explorer.
  onTabDropped?: (drop: { sourcePaneId: string; relPath: string; dirty: boolean }) => void
  onFileDropped?: (relPath: string) => void
  editorOptions?: EditorPreferences
  editorTheme?: EditorTheme
}

export function EditorPane({ pane, onTabsChange, onClose, onFocus, onOpenInNewPane, onTabDropped, onFileDropped, editorOptions, editorTheme }: EditorPaneProps) {
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
  // Feedback visual mientras un drag compatible está encima del pane.
  const [dropActive, setDropActive] = useState(false)
  // Monaco se carga LAZY en el primer pane de editor (no en el bundle de
  // arranque). <Editor> recién puede montar cuando monaco-setup corrió —
  // si no, @monaco-editor/react cae a su loader CDN (offline: roto).
  const [monacoSetupReady, setMonacoSetupReady] = useState(false)
  useEffect(() => {
    let alive = true
    void ensureMonacoSetup().then(() => { if (alive) setMonacoSetupReady(true) })
    return () => { alive = false }
  }, [])
  const contentsRef = useRef(contents)
  contentsRef.current = contents
  const loadErrorsRef = useRef(loadErrors)
  loadErrorsRef.current = loadErrors
  const conflictsRef = useRef(conflicts)
  conflictsRef.current = conflicts
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activePathRef = useRef(activePath)
  activePathRef.current = activePath
  const worktreePathRef = useRef(worktreePath)
  worktreePathRef.current = worktreePath

  // Los buffers dirty viven en el state de ESTE componente y cambiar de
  // workspace tab lo DESMONTA (App renderiza solo el tab activo, sin
  // keep-alive): sin esto, al volver la tab seguía marcada dirty pero
  // recargaba de disco — y Ctrl+S escribía el contenido de disco pisando
  // las ediciones del usuario. El unmount stashea todo buffer dirty al
  // handoff; la carga ya consume stashes para tabs que llegan dirty.
  useEffect(() => () => {
    const wt = worktreePathRef.current
    if (!wt) return
    for (const tab of tabsRef.current) {
      if (!tab.dirty) continue
      const content = contentsRef.current[tab.relPath]
      if (content === undefined) continue
      stashTabBuffer(wt, tab.relPath, {
        content,
        eol: eolRef.current[tab.relPath] ?? '\n',
        dirty: true,
      })
    }
  }, [])

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
  // --- Diff vs HEAD: líneas agregadas en verde (como GitHub) --------------
  // La colección de decoraciones vive en la INSTANCIA del editor (primer arg
  // de onMount); se re-setea por completo en cada refresh.
  const decorationsRef = useRef<{ set: (d: unknown[]) => void } | null>(null)
  const editorInstanceRef = useRef<{ createDecorationsCollection: (d: unknown[]) => { set: (d: unknown[]) => void } } | null>(null)
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
  // Monaco dispara onDidChangeModelContent (→ onChange del wrapper) también
  // para el setValue PROGRAMÁTICO de las cargas de disco — sin esta guarda,
  // cada carga marcaba la tab dirty sin que el usuario tocara nada. Contador
  // y no boolean por si una escritura anida otra; funciona porque Monaco
  // notifica sincrónicamente dentro de setValue.
  const suppressChangeRef = useRef(0)

  const setModelText = useCallback((relPath: string, text: string) => {
    const monaco = monacoRef.current
    if (!monaco) return
    // Matching EXACTO contra el path calificado por worktree. El matching
    // viejo por sufijo (endsWith('/'+relPath)) inyectaba el contenido de
    // foo.ts de raíz en el modelo de src/foo.ts — y sin calificar, dos
    // worktrees compartían modelo (clobber cruzado en Ctrl+S).
    const target = worktreePath ? modelPathFor(worktreePath, relPath) : relPath
    const model = monaco.editor.getModels().find(
      (m) => m.uri.path === target || m.uri.path === `/${target}`,
    )
    if (model && model.getValue() !== text) {
      suppressChangeRef.current++
      try {
        model.setValue(text)
      } finally {
        suppressChangeRef.current--
      }
    }
  }, [worktreePath])

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

  // Pide a git las líneas agregadas/cambiadas vs HEAD del path ACTIVO y las
  // pinta como decoraciones whole-line. Los edits en curso corren las
  // decoraciones solos (Monaco trackea rangos); el refresh real llega al
  // guardar o recargar de disco.
  const refreshDiffDecorations = useCallback((relPath: string | undefined) => {
    const editor = editorInstanceRef.current
    if (!editor || !worktreePath || !relPath) return
    bridge.gitDiff?.addedLines(worktreePath, relPath).then((res) => {
      if (relPath !== activePathRef.current) return // cambió la tab en vuelo
      if (!decorationsRef.current) decorationsRef.current = editor.createDecorationsCollection([])
      if (!res.ok) { decorationsRef.current.set([]); return }
      decorationsRef.current.set(res.ranges.map((r) => ({
        range: { startLineNumber: r.start, startColumn: 1, endLineNumber: r.end, endColumn: 1 },
        options: {
          isWholeLine: true,
          className: 'nest-diff-added',
          linesDecorationsClassName: 'nest-diff-added-gutter',
        },
      })))
    }).catch(() => { /* sin decoraciones ante cualquier falla */ })
  }, [worktreePath, bridge])
  const refreshDiffDecorationsRef = useRef(refreshDiffDecorations)
  refreshDiffDecorationsRef.current = refreshDiffDecorations

  const handleEditorMount = useCallback((editorInstance: unknown, monaco: MonacoLike) => {
    editorInstanceRef.current = editorInstance as typeof editorInstanceRef.current
    monacoRef.current = monaco
    // Sin LSP real (fuera de alcance v1 a propósito), la validación SEMÁNTICA
    // de TS/JS de Monaco marca en rojo imports perfectamente válidos (no
    // resuelve módulos del proyecto) — falsos positivos en cada archivo. La
    // sintáctica queda: los typos reales sí valen. Best-effort: MonacoLike no
    // tipa languages, y un Monaco sin el worker de TS simplemente no lo tiene.
    const langs = (monaco as unknown as {
      languages?: { typescript?: Record<'typescriptDefaults' | 'javascriptDefaults', { setDiagnosticsOptions?: (o: unknown) => void } | undefined> }
    }).languages
    for (const d of [langs?.typescript?.typescriptDefaults, langs?.typescript?.javascriptDefaults]) {
      d?.setDiagnosticsOptions?.({ noSemanticValidation: true, noSyntaxValidation: false })
    }
    // applyTheme cae solo a vs-dark ante cualquier falla — el editor ya está
    // usable con Monarch antes de que esto resuelva.
    void applyTheme(monaco, editorThemeRef.current ?? 'vs-dark')
    requestShikiLang(activePathRef.current)
    // El wrapper dispara onMount en un SEGUNDO commit (flip interno de
    // isEditorReady): cualquier carga que resolvió en el primero — un
    // handoff consumido tras el remount del pane (la remoción de un pane
    // vecino cambia el layout y React remonta al superviviente) — escribió
    // `contents` con monacoRef aún null y nunca llegó al modelo, que pudo
    // nacer vacío o con contenido viejo del registro global de Monaco.
    // `contents` es la verdad: volcarla al modelo activo.
    const active = activePathRef.current
    if (active !== undefined) {
      const loaded = contentsRef.current[active]
      if (loaded !== undefined) setModelText(active, loaded)
    }
    refreshDiffDecorationsRef.current(active)
  }, [requestShikiLang, setModelText])

  useEffect(() => {
    const monaco = monacoRef.current
    if (!monaco) return
    void applyTheme(monaco, editorTheme ?? 'vs-dark')
  }, [editorTheme])

  useEffect(() => {
    requestShikiLang(activePath)
    refreshDiffDecorations(activePath)
  }, [activePath, requestShikiLang, refreshDiffDecorations])

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

  // Purga TODO el estado por-path de un relPath. Muta los refs además de
  // setear estado: los efectos de ESTE mismo commit (la carga de abajo) leen
  // los refs — sin la mutación verían el cache viejo y saltearían el read.
  const purgePathState = useCallback((relPath: string) => {
    const { [relPath]: _c, ...restContents } = contentsRef.current
    contentsRef.current = restContents
    setContents(restContents)
    const { [relPath]: _e, ...restErrors } = loadErrorsRef.current
    loadErrorsRef.current = restErrors
    setLoadErrors(restErrors)
    setConflicts((c) => { const { [relPath]: _x, ...rest } = c; return rest })
    delete eolRef.current[relPath]
    delete editSeqRef.current[relPath]
  }, [])

  const relPathsKey = tabs.map((t) => t.relPath).sort().join('\n')

  // Una tab que SALE del pane (mudanza por drag/botón, no solo closeTab)
  // debe soltar sus caches: el snapshot viejo hacía que al volver se
  // salteara la lectura y Ctrl+S escribiera contenido PRE-mudanza al disco.
  const prevRelPathsRef = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const current = new Set(tabsRef.current.map((t) => t.relPath))
    for (const rel of prevRelPathsRef.current) {
      if (!current.has(rel)) purgePathState(rel)
    }
    prevRelPathsRef.current = current
  }, [relPathsKey, purgePathState])

  // Cambio de worktree del pane (handleWorktreeSelect conserva las tabs):
  // TODO el cache pertenece al worktree viejo — mostrarlo (y peor, guardarlo)
  // contra el nuevo es clobber cruzado. Los buffers dirty se stashean con la
  // key del worktree VIEJO (volver a él los recupera) y se purga el resto.
  const prevWorktreeRef = useRef<string | undefined>(worktreePath)
  useEffect(() => {
    const prev = prevWorktreeRef.current
    prevWorktreeRef.current = worktreePath
    if (prev === undefined || prev === worktreePath) return
    for (const tab of tabsRef.current) {
      const content = contentsRef.current[tab.relPath]
      if (tab.dirty && content !== undefined) {
        stashTabBuffer(prev, tab.relPath, {
          content,
          eol: eolRef.current[tab.relPath] ?? '\n',
          dirty: true,
        })
      }
      purgePathState(tab.relPath)
    }
  }, [worktreePath, purgePathState])

  useEffect(() => {
    if (!worktreePath) return
    tabs.forEach((tab) => {
      if (contentsRef.current[tab.relPath] !== undefined) return
      // Tab DIRTY mudada desde otro pane (botón o drag & drop): su buffer
      // viaja por el handoff — consumirlo evita la lectura de disco que
      // pisaría el edit sin guardar. Solo tabs dirty: una limpia tiene su
      // contenido EN disco (leer disco es correcto), y así una tab reabierta
      // tras cerrarse (llega dirty:false) jamás consume un stash rancio de
      // un drag cancelado.
      const handoff = tab.dirty ? takeTabBuffer(worktreePath, tab.relPath) : undefined
      if (handoff) {
        eolRef.current[tab.relPath] = handoff.eol
        setContents((c) => ({ ...c, [tab.relPath]: handoff.content }))
        setModelText(tab.relPath, handoff.content)
        return
      }
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

  // Keyear por el SET de paths y no por la identidad de `tabs`: cada
  // transición de dirty (.map() del padre) creaba un array nuevo y rehacía
  // TODOS los watchers (2N round-trips IPC + teardown/rebuild de chokidar)
  // sin que el conjunto watcheado cambiara.
  const watchKey = tabs.map((t) => t.relPath).sort().join('\n')

  useEffect(() => {
    if (!worktreePath) return
    const watched = tabsRef.current.map((t) => t.relPath)
    watched.forEach((relPath) => sequencedWatch(worktreePath, relPath))
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
          refreshDiffDecorationsRef.current(relPath)
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
      watched.forEach((relPath) => sequencedUnwatch(worktreePath, relPath))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relPathsKey, worktreePath, bridge, sequencedWatch, sequencedUnwatch])

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
    // Eco de una escritura programática nuestra (carga/recarga de disco vía
    // setModelText) — no es tipeo del usuario: ni dirty ni editSeq.
    if (suppressChangeRef.current > 0) return
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

  // Devuelve si el guardado llegó al disco — "Save & move" solo muda la tab
  // con el contenido efectivamente persistido.
  const save = useCallback(async (relPath: string): Promise<boolean> => {
    if (!worktreePath) return false
    const content = contentsRef.current[relPath]
    // The tab's content never loaded successfully (binary/oversized file,
    // still-in-flight initial read, or a failed re-read left `loadErrors`
    // set without ever refreshing `contents`) — `content` is `undefined` or
    // stale-relative-to-a-known-error. Writing anyway would truncate (or
    // resurrect with stale data) the file on disk. Bail out silently: the
    // "file unavailable" banner already communicates why, and a still-loading
    // read will complete and let a later Ctrl+S succeed normally.
    if (content === undefined || loadErrorsRef.current[relPath] !== undefined) return false
    // Banner de conflicto abierto: la pregunta la responden SUS botones —
    // el Ctrl+S de memoria muscular no puede pisar la versión externa ni
    // limpiar el conflicto en silencio.
    if (conflictsRef.current[relPath]) return false
    const res = await bridge.fs.writeFile(worktreePath, relPath, content)
    if (res.ok) {
      setDirty(relPath, false)
      setConflicts((c) => ({ ...c, [relPath]: false }))
      // Refrescar el diff vs HEAD: las decoraciones de este pane y los
      // badges del Explorer (que escucha este evento — el watcher de
      // carpetas no ve el contenido de archivos).
      window.dispatchEvent(new CustomEvent('nest:file-saved', { detail: { worktreePath, relPath } }))
      refreshDiffDecorationsRef.current(relPath)
      return true
    }
    // No global toast service exists in this app (see design spec) — the
    // established precedent for surfacing a rare failure immediately is
    // window.alert (src/App.tsx:537-541, WorktreesSection.tsx:160).
    window.alert(`Could not save ${relPath}: ${res.error}`)
    return false
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
      refreshDiffDecorationsRef.current(relPath)
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
    purgePathState(relPath)
    if (nextTabs.length === 0) onClose()
  }, [tabs, activePath, onTabsChange, onClose, purgePathState])

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

  // Aceptar (y mostrar el outline) SOLO si hay handler para ese payload —
  // un pane que resalta pero no recibe se siente roto.
  const acceptsDrop = (e: React.DragEvent) =>
    (!!onTabDropped && e.dataTransfer.types.includes('application/x-nest-editor-tab')) ||
    (!!onFileDropped && e.dataTransfer.types.includes('application/x-nest-file'))

  return (
    <div
      className={`editor-pane${dropActive ? ' drop-target' : ''}`}
      data-testid="editor-pane"
      onFocus={onFocus}
      tabIndex={-1}
      ref={containerRef}
      onDragOver={(e) => {
        if (!acceptsDrop(e)) return
        e.preventDefault()
        // dropEffect DEBE ser compatible con el effectAllowed del origen: el
        // Explorer arrastra con 'copy' y forzar 'move' acá INVALIDA el drop
        // en Chromium (el pane resaltaba pero el drop jamás disparaba).
        e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-nest-editor-tab') ? 'move' : 'copy'
        setDropActive(true)
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        setDropActive(false)
        const tabRaw = e.dataTransfer.getData('application/x-nest-editor-tab')
        if (tabRaw) {
          e.preventDefault()
          try {
            const p = JSON.parse(tabRaw) as { sourcePaneId: string; relPath: string; dirty: boolean; worktreePath: string }
            // relPath es relativo al worktree del pane origen: en otro
            // worktree apunta a otro archivo — cross-worktree se ignora.
            if (p.worktreePath === worktreePath) onTabDropped?.({ sourcePaneId: p.sourcePaneId, relPath: p.relPath, dirty: p.dirty })
          } catch { /* payload ajeno, no es nuestro */ }
          return
        }
        const fileRaw = e.dataTransfer.getData('application/x-nest-file')
        if (fileRaw) {
          e.preventDefault()
          try {
            const p = JSON.parse(fileRaw) as { relPath: string; worktreePath?: string }
            // Mismo guard cross-worktree que el drop de tabs: el relPath de
            // otro worktree significa OTRO archivo acá.
            if (p.worktreePath === worktreePath) onFileDropped?.(p.relPath)
          } catch { /* payload ajeno */ }
        }
      }}
    >
      <div className="editor-pane-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.relPath}
            className={`editor-tab${tab.relPath === activePath ? ' active' : ''}${tab.dirty ? ' dirty' : ''}`}
            title={tab.relPath}
            onClick={() => onTabsChange(tabs, tab.relPath)}
            draggable
            onDragStart={(e) => {
              if (!worktreePath) return
              // Solo tabs DIRTY stashean: una limpia tiene su contenido en
              // disco y el destino lee disco. Sin limpieza en dragend a
              // propósito — el pane origen se desmonta con la mudanza y
              // cualquier chequeo post-unmount (tabsRef congelado) corría una
              // carrera contra el consumo del destino (pisaba el stash y el
              // edit se perdía). Un stash de un drag cancelado es inofensivo:
              // solo lo consume una tab que LLEGA dirty, y toda llegada dirty
              // viene de un gesto de mudanza que stashea fresco primero.
              const content = contentsRef.current[tab.relPath]
              if (tab.dirty && content !== undefined) {
                stashTabBuffer(worktreePath, tab.relPath, {
                  content,
                  eol: eolRef.current[tab.relPath] ?? '\n',
                  dirty: true,
                })
              }
              e.dataTransfer.setData('application/x-nest-editor-tab', JSON.stringify({
                sourcePaneId: pane.id, relPath: tab.relPath, dirty: tab.dirty, worktreePath,
              }))
              e.dataTransfer.effectAllowed = 'move'
            }}
          >
            <FileIcon name={tab.relPath} />
            <span className="editor-tab-name">{tab.relPath.split('/').pop()}</span>
            {/* Slot derecho estilo VS Code: el punto dirty se muestra hasta
                que el hover lo reemplaza por las acciones. */}
            {tab.dirty && <span className="editor-tab-dirty" data-testid={`dirty-${tab.relPath}`}>●</span>}
            <span className="editor-tab-actions">
              {/* Mover la ÚNICA tab del pane a "un pane nuevo" es un no-op
                  conceptual (ya está sola en el suyo) — y ofrecerlo dejaba un
                  pane cascarón sin tabs (negro) por cada click. */}
              {tabs.length > 1 && <button
                className="editor-tab-btn editor-tab-move"
                title="Open in new pane"
                onClick={(e) => {
                  e.stopPropagation()
                  // Tab dirty: el buffer viaja con la tab vía handoff y el
                  // destino lo consume en su carga (nada sin guardar se
                  // pierde). Limpia: el disco ya tiene el contenido.
                  const content = contentsRef.current[tab.relPath]
                  if (worktreePath && tab.dirty && content !== undefined) {
                    stashTabBuffer(worktreePath, tab.relPath, {
                      content,
                      eol: eolRef.current[tab.relPath] ?? '\n',
                      dirty: true,
                    })
                  }
                  onOpenInNewPane(tab.relPath)
                }}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path d="M6.5 2.5H3a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5V9.5M9.5 2.5h4v4M13.5 2.5L8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>}
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
      ) : activePath && monacoSetupReady && (
        <Editor
          // Path de modelo calificado por worktree: el mismo relPath en dos
          // worktrees son DOS modelos (ver lib/editor-model-path.ts).
          path={worktreePath && activePath ? modelPathFor(worktreePath, activePath) : activePath}
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
          // Minimap apagado por DEFAULT: en panes chicos renderiza texto
          // microscópico ilegible (ruido visual puro). Las opciones del
          // usuario (Settings / import de config) pueden re-activarlo.
          options={{ minimap: { enabled: false }, ...(editorOptions ?? {}) }}
        />
      )}
    </div>
  )
}
