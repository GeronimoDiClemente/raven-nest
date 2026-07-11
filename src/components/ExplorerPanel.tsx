import { useCallback, useEffect, useRef, useState } from 'react'
import { useBridge } from '../lib/bridge'
import type { DirEntry } from '../types'

interface ExplorerPanelProps {
  worktreePath: string | null
  onFileOpen: (relPath: string) => void
}

export function ExplorerPanel({ worktreePath, onFileOpen }: ExplorerPanelProps) {
  const bridge = useBridge()
  const [entriesByDir, setEntriesByDir] = useState<Record<string, DirEntry[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
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

  useEffect(() => {
    setEntriesByDir({})
    setExpanded({})
    if (!worktreePath) return
    loadDir('')
    sequencedWatch(worktreePath, '', { depth: 0 })
    const unsubscribe = bridge.fs.onChanged((wt, relPath) => {
      if (wt !== worktreePath) return
      // El watcher reporta el relPath de la CARPETA watcheada (ver Task 2);
      // si la tenemos cargada, se re-lista.
      if (entriesByDirRef.current[relPath] !== undefined) loadDir(relPath)
    })
    return () => {
      unsubscribe()
      sequencedUnwatch(worktreePath, '')
      watchedDirsRef.current.forEach((dir) => sequencedUnwatch(worktreePath, dir))
      watchedDirsRef.current.clear()
    }
  }, [worktreePath, loadDir, bridge, sequencedWatch, sequencedUnwatch])

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

  if (!worktreePath) {
    return <div className="explorer-panel explorer-panel-empty">No hay repo activo</div>
  }

  const renderEntries = (relPath: string, depth: number) => {
    const entries = entriesByDir[relPath] ?? []
    return entries.map((entry) => (
      <div key={entry.path}>
        <div
          className="explorer-entry"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => (entry.isDirectory ? toggleDir(entry.path) : onFileOpen(entry.path))}
        >
          <span className="explorer-entry-icon">{entry.isDirectory ? (expanded[entry.path] ? '▾' : '▸') : '·'}</span>
          <span className="explorer-entry-name">{entry.name}</span>
        </div>
        {entry.isDirectory && expanded[entry.path] && renderEntries(entry.path, depth + 1)}
      </div>
    ))
  }

  return <div className="explorer-panel">{renderEntries('', 0)}</div>
}
