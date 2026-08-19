import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useBridge } from '../lib/bridge'
import { FILE_DRAG_MIME } from '../lib/dragTypes'
import { sameWorktree } from '../lib/worktree-path'
import type { DirEntry } from '../types'

interface ExplorerPanelProps {
  worktreePath: string | null
  onFileOpen: (relPath: string) => void
  // Anidado bajo el HubExplorerPanel: la raíz aporta su propio header (nombre
  // del workspace), así que acá se omite el header "EXPLORER" y la fila de root.
  treeOnly?: boolean
}

// Tint family per extension. One hue per language family, drawn from the
// platform palette (raven blue, the settings-accent violet) — not VS Code's
// icon theme.
function extClass(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'ts' || ext === 'tsx') return 'ic-ts'
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'ic-js'
  if (ext === 'json') return 'ic-json'
  if (ext === 'md' || ext === 'mdx') return 'ic-md'
  if (ext === 'css' || ext === 'scss' || ext === 'less') return 'ic-css'
  if (ext === 'html' || ext === 'xml' || ext === 'svg') return 'ic-html'
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp' || ext === 'ico') return 'ic-img'
  return 'ic-file'
}

function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg className={`explorer-chevron${open ? ' open' : ''}`} width="8" height="8" viewBox="0 0 8 8" fill="none">
    <path d="M2.5 1L6 4L2.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const FolderIcon = ({ open }: { open: boolean }) => (
  <svg className="explorer-type-icon ic-folder" width="14" height="14" viewBox="0 0 16 16" fill="none">
    {open ? (
      <path d="M1.5 4.5a1 1 0 0 1 1-1h3l1.4 1.5h6.6a1 1 0 0 1 1 1v.5H3.6L2 12.2V4.5zM3.9 7.5h10.9l-1.6 5a1 1 0 0 1-.95.7H2.4l1.5-5.7z" fill="currentColor" opacity=".85" />
    ) : (
      <path d="M1.5 4.5a1 1 0 0 1 1-1h3l1.4 1.5h6.6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7.5z" fill="currentColor" opacity=".85" />
    )}
  </svg>
)

export const FileIcon = ({ name }: { name: string }) => (
  <svg className={`explorer-type-icon ${extClass(name)}`} width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M4 1.5h5.5L13 5v9a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8V2.3a.8.8 0 0 1 .8-.8z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    <path d="M9.5 1.5V5H13" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>
)

export function ExplorerPanel({ worktreePath, onFileOpen, treeOnly = false }: ExplorerPanelProps) {
  const bridge = useBridge()
  const [entriesByDir, setEntriesByDir] = useState<Record<string, DirEntry[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<string | null>(null)
  // Diff vs HEAD del worktree: +N/−M por archivo modificado, U = untracked.
  const [diffFiles, setDiffFiles] = useState<Record<string, { added: number; deleted: number }>>({})
  const [untracked, setUntracked] = useState<ReadonlySet<string>>(new Set())
  const entriesByDirRef = useRef(entriesByDir)
  entriesByDirRef.current = entriesByDir
  // Dirs we watch besides root. Collapsing a parent leaves its expanded
  // children watched until unmount/worktree switch — bounded (depth-0
  // watchers are cheap) and simpler than tracking the subtree.
  const watchedDirsRef = useRef(new Set<string>())
  // watch()/unwatch() are un-awaited async IPC round-trips into a
  // chokidar-backed registry keyed by `worktreePath::relPath`. A fast
  // expand→collapse (or worktree switch) can fire watch() then unwatch()
  // for the SAME key before watch()'s underlying registration finishes,
  // letting unwatch() no-op (nothing registered yet) and the watcher get
  // registered afterwards anyway — orphaned forever. This map sequences
  // watch/unwatch calls per key so the last toggle always wins.
  const pendingOpsRef = useRef(new Map<string, Promise<void>>())

  const sequencedOp = useCallback((key: string, op: () => Promise<unknown>) => {
    const prior = pendingOpsRef.current.get(key) ?? Promise.resolve()
    const next = prior.then(() => op()).then(() => {}, () => {})
    pendingOpsRef.current.set(key, next)
    return next
  }, [])

  const sequencedWatch = useCallback((wt: string, relPath: string, opts: { depth: number }) => {
    return sequencedOp(`${wt}::${relPath}`, () => bridge.fs.watch(wt, relPath, opts))
  }, [bridge, sequencedOp])

  const sequencedUnwatch = useCallback((wt: string, relPath: string) => {
    return sequencedOp(`${wt}::${relPath}`, () => bridge.fs.unwatch(wt, relPath))
  }, [bridge, sequencedOp])

  const loadDir = useCallback((relPath: string) => {
    if (!worktreePath) return
    bridge.fs.listDir(worktreePath, relPath).then((res) => {
      if (res.ok) setEntriesByDir((e) => ({ ...e, [relPath]: res.entries }))
    })
  }, [worktreePath, bridge])

  // Debounce trailing: cada stats() spawnea git en el main — una ráfaga de
  // fs:changed (un agente escribiendo N archivos) colapsa en UN refresh.
  const diffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshDiff = useCallback(() => {
    if (!worktreePath) return
    if (diffTimerRef.current) clearTimeout(diffTimerRef.current)
    diffTimerRef.current = setTimeout(() => {
      diffTimerRef.current = null
      // Opcional: preloads viejos (o mocks parciales) no exponen gitDiff.
      bridge.gitDiff?.stats(worktreePath).then((res) => {
        if (!res.ok) return
        setDiffFiles(Object.fromEntries(res.files.map((f) => [f.relPath, { added: f.added, deleted: f.deleted }])))
        setUntracked(new Set(res.untracked))
      }).catch(() => { /* repo sin HEAD o similar: sin badges */ })
    }, 200)
  }, [worktreePath, bridge])

  useEffect(() => {
    setEntriesByDir({})
    setExpanded({})
    setSelected(null)
    setDiffFiles({})
    setUntracked(new Set())
    if (!worktreePath) return
    loadDir('')
    refreshDiff()
    sequencedWatch(worktreePath, '', { depth: 0 })
    const unsubscribe = bridge.fs.onChanged((wt, relPath) => {
      // sameWorktree y no ===: el registry deduplica dos formas del mismo
      // worktree (C:/ vs C:\) en un chokidar que emite UNA forma, y el Hub monta
      // este Explorer con tab.repoPath (otra forma en Windows). Con === el árbol
      // y los badges quedaban stale ante cambios externos.
      if (!sameWorktree(wt, worktreePath)) return
      // El watcher reporta el relPath de la CARPETA watcheada (ver Task 2);
      // si la tenemos cargada, se re-lista.
      if (entriesByDirRef.current[relPath] !== undefined) loadDir(relPath)
      refreshDiff()
    })
    // El guardado desde el editor no pasa por el watcher de carpetas — el
    // EditorPane lo anuncia con este evento para refrescar los badges al toque.
    const onSaved = (e: Event) => {
      const ce = e as CustomEvent<{ worktreePath?: string }>
      if (sameWorktree(ce.detail?.worktreePath, worktreePath)) refreshDiff()
    }
    window.addEventListener('nest:file-saved', onSaved)
    return () => {
      unsubscribe()
      window.removeEventListener('nest:file-saved', onSaved)
      if (diffTimerRef.current) { clearTimeout(diffTimerRef.current); diffTimerRef.current = null }
      sequencedUnwatch(worktreePath, '')
      watchedDirsRef.current.forEach((dir) => sequencedUnwatch(worktreePath, dir))
      watchedDirsRef.current.clear()
    }
  }, [worktreePath, loadDir, refreshDiff, bridge, sequencedWatch, sequencedUnwatch])

  const toggleDir = useCallback((relPath: string) => {
    if (!worktreePath) return
    const willExpand = !expanded[relPath]
    setExpanded((e) => ({ ...e, [relPath]: willExpand }))
    if (willExpand) {
      if (!entriesByDirRef.current[relPath]) loadDir(relPath)
      sequencedWatch(worktreePath, relPath, { depth: 0 })
      watchedDirsRef.current.add(relPath)
    } else {
      sequencedUnwatch(worktreePath, relPath)
      watchedDirsRef.current.delete(relPath)
    }
  }, [worktreePath, expanded, loadDir, sequencedWatch, sequencedUnwatch])

  const collapseAll = useCallback(() => {
    if (!worktreePath) return
    setExpanded({})
    watchedDirsRef.current.forEach((dir) => sequencedUnwatch(worktreePath, dir))
    watchedDirsRef.current.clear()
  }, [worktreePath, sequencedUnwatch])

  const refresh = useCallback(() => {
    Object.keys(entriesByDirRef.current).forEach((dir) => loadDir(dir))
    refreshDiff()
  }, [loadDir, refreshDiff])

  if (!worktreePath) {
    return (
      <div className="explorer-panel explorer-panel-empty">
        <span className="explorer-empty-title">No repo linked</span>
        <span className="explorer-empty-hint">Link a repo to browse its files.</span>
      </div>
    )
  }

  const renderEntries = (relPath: string, depth: number) => {
    const entries = entriesByDir[relPath] ?? []
    return entries.map((entry) => (
      <div key={entry.path}>
        <div
          className={`explorer-entry${selected === entry.path ? ' selected' : ''}`}
          style={{ paddingLeft: `${depth * 8 + 8}px` }}
          onClick={() => {
            if (entry.isDirectory) {
              toggleDir(entry.path)
            } else {
              setSelected(entry.path)
              onFileOpen(entry.path)
            }
          }}
          draggable={!entry.isDirectory}
          onDragStart={entry.isDirectory ? undefined : (e) => {
            // Arrastrable a cualquier pane de editor (drop lo abre AHÍ). El
            // worktree viaja en el payload: el pane receptor lo valida — un
            // relPath de otro worktree es otro archivo.
            e.dataTransfer.setData(FILE_DRAG_MIME, JSON.stringify({ relPath: entry.path, worktreePath }))
            e.dataTransfer.effectAllowed = 'copy'
          }}
        >
          <span className="explorer-entry-icon">
            {entry.isDirectory ? <Chevron open={!!expanded[entry.path]} /> : null}
          </span>
          {entry.isDirectory
            ? <FolderIcon open={!!expanded[entry.path]} />
            : <FileIcon name={entry.name} />}
          <span className="explorer-entry-name">{entry.name}</span>
          {!entry.isDirectory && diffFiles[entry.path] && (
            <span className="explorer-diff">
              {diffFiles[entry.path].added > 0 && <span className="diff-added">+{diffFiles[entry.path].added}</span>}
              {diffFiles[entry.path].deleted > 0 && <span className="diff-deleted">−{diffFiles[entry.path].deleted}</span>}
            </span>
          )}
          {!entry.isDirectory && !diffFiles[entry.path] && untracked.has(entry.path) && (
            <span className="explorer-diff"><span className="diff-untracked">U</span></span>
          )}
        </div>
        {entry.isDirectory && expanded[entry.path] && (
          <div
            className="explorer-subtree"
            style={{ '--guide-left': `${depth * 8 + 11}px` } as CSSProperties}
          >
            {renderEntries(entry.path, depth + 1)}
          </div>
        )}
      </div>
    ))
  }

  if (treeOnly) {
    return <div className="explorer-tree explorer-tree-nested">{renderEntries('', 0)}</div>
  }

  return (
    <div className="explorer-panel">
      <div className="explorer-header">EXPLORER</div>
      <div className="explorer-root-row">
        <span className="explorer-root-name">{basename(worktreePath).toUpperCase()}</span>
        <span className="explorer-root-actions">
          <button className="explorer-action-btn" title="Refresh" onClick={refresh}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.8v2.7h-2.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="explorer-action-btn" title="Collapse folders" onClick={collapseAll}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M13 6.5H3M13 9.5H3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M5.5 3.5L8 1.5l2.5 2M5.5 12.5L8 14.5l2.5-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </span>
      </div>
      <div className="explorer-tree">{renderEntries('', 0)}</div>
    </div>
  )
}
