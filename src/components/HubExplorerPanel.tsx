import { useState } from 'react'
import { ExplorerPanel } from './ExplorerPanel'

export interface ExplorerRoot {
  tabId: string       // workspace (tab) dueño del repo
  name: string        // nombre del workspace
  repoPath: string    // worktree del workspace
}

interface Props {
  roots: ExplorerRoot[]
  // Abrir un archivo: viaja el workspace dueño + su repoPath, para que el
  // archivo se abra EN ese workspace (y se ancle al Hub).
  onOpenFile: (tabId: string, repoPath: string, relPath: string) => void
}

function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
}

/**
 * Explorer multi-raíz del Hub: una raíz colapsable por workspace abierto con
 * repo. Cada raíz monta perezosamente un ExplorerPanel (árbol + watcher + diff)
 * SOLO al expandirse — con muchos workspaces no se disparan N watchers de golpe
 * al abrir el Hub. Fuera del Hub sigue vivo el ExplorerPanel de una sola raíz.
 */
export default function HubExplorerPanel({ roots, onOpenFile }: Props) {
  // Colapsado por default: el set guarda las raíces EXPANDIDAS.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (tabId: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(tabId)) next.delete(tabId); else next.add(tabId)
    return next
  })

  if (roots.length === 0) {
    return (
      <div className="explorer-panel explorer-panel-empty">
        <span className="explorer-empty-title">No repos open</span>
        <span className="explorer-empty-hint">Open a workspace with a repo to browse its files.</span>
      </div>
    )
  }

  return (
    <div className="explorer-panel hub-explorer">
      <div className="explorer-header">EXPLORER</div>
      {roots.map(root => {
        const open = expanded.has(root.tabId)
        return (
          <div key={root.tabId} className="hub-explorer-root">
            <div
              className="hub-explorer-root-head"
              onClick={() => toggle(root.tabId)}
              title={root.repoPath}
            >
              <svg className={`explorer-chevron${open ? ' open' : ''}`} width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M2.5 1L6 4L2.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="hub-explorer-root-name">{root.name}</span>
              <span className="hub-explorer-root-repo">{basename(root.repoPath)}</span>
            </div>
            {open && (
              <ExplorerPanel
                worktreePath={root.repoPath}
                treeOnly
                onFileOpen={(relPath) => onOpenFile(root.tabId, root.repoPath, relPath)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
