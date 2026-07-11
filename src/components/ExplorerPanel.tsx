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
    bridge.fs.watch(worktreePath, '', { depth: 0 })
    const unsubscribe = bridge.fs.onChanged((wt, relPath) => {
      if (wt !== worktreePath) return
      // El watcher reporta el relPath de la CARPETA watcheada (ver Task 2);
      // si la tenemos cargada, se re-lista.
      if (entriesByDirRef.current[relPath] !== undefined) loadDir(relPath)
    })
    return () => {
      unsubscribe()
      bridge.fs.unwatch(worktreePath, '')
      watchedDirsRef.current.forEach((dir) => bridge.fs.unwatch(worktreePath, dir))
      watchedDirsRef.current.clear()
    }
  }, [worktreePath, loadDir, bridge])

  const toggleDir = useCallback((relPath: string) => {
    if (!worktreePath) return
    const willExpand = !expanded[relPath]
    setExpanded((e) => ({ ...e, [relPath]: willExpand }))
    if (willExpand) {
      if (!entriesByDirRef.current[relPath]) loadDir(relPath)
      bridge.fs.watch(worktreePath, relPath, { depth: 0 })
      watchedDirsRef.current.add(relPath)
    } else {
      bridge.fs.unwatch(worktreePath, relPath)
      watchedDirsRef.current.delete(relPath)
    }
  }, [worktreePath, expanded, loadDir, bridge])

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
