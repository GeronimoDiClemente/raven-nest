import { useEffect, useMemo, useState } from 'react'
import type { WorktreeMeta } from '../types'

interface CellRef {
  paneId: string
  repoPath: string
}

interface Props {
  cells: CellRef[]
  rootRepoPath: string | null
}

interface PortGroup {
  worktreePath: string
  branch: string
  declared: number[]
  detected: number[]
}

const POLL_MS = 3000

async function safeListWorktrees(repoPath: string): Promise<WorktreeMeta[]> {
  try { return await window.worktree.list(repoPath) } catch { return [] }
}

export function PortsBanner({ cells, rootRepoPath }: Props) {
  const [groups, setGroups] = useState<PortGroup[]>([])

  // Map: worktreePath → set of paneIds (cells running there)
  const cellsByWorktree = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const c of cells) {
      const arr = m.get(c.repoPath) ?? []
      arr.push(c.paneId)
      m.set(c.repoPath, arr)
    }
    return m
  }, [cells])

  useEffect(() => {
    if (!rootRepoPath || cellsByWorktree.size === 0) { setGroups([]); return }
    let cancelled = false

    const tick = async () => {
      const wts = await safeListWorktrees(rootRepoPath)
      const byPath = new Map(wts.map((w) => [w.repoPath, w]))
      const result: PortGroup[] = []

      for (const [wtPath, paneIds] of cellsByWorktree) {
        const meta = byPath.get(wtPath)
        if (!meta) continue
        const detected = new Set<number>()
        for (const paneId of paneIds) {
          try {
            const pid = await window.pty.getPid(paneId)
            if (!pid) continue
            const ports = await window.port.scan(pid)
            for (const p of ports) detected.add(p)
          } catch {}
        }
        const declared = meta.declaredPorts ?? []
        for (const d of declared) detected.delete(d)  // declared takes precedence label-wise
        result.push({
          worktreePath: wtPath,
          branch: meta.branch,
          declared,
          detected: Array.from(detected).sort((a, b) => a - b),
        })
      }
      if (!cancelled) setGroups(result)
    }

    void tick()
    const id = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [rootRepoPath, cellsByWorktree])

  if (groups.length === 0) return null
  const totalPorts = groups.reduce((n, g) => n + g.declared.length + g.detected.length, 0)
  if (totalPorts === 0) return null

  const showSubheaders = groups.length > 1

  return (
    <div className="ports-banner">
      {groups.map((g) => (
        <div key={g.worktreePath} className="ports-group">
          {showSubheaders && (
            <span className="ports-group-label" title={g.worktreePath}>{g.branch}</span>
          )}
          {g.declared.map((p) => (
            <PortPill key={`d-${p}`} port={p} kind="declared" />
          ))}
          {g.detected.map((p) => (
            <PortPill key={`x-${p}`} port={p} kind="discovered" />
          ))}
        </div>
      ))}
    </div>
  )
}

function PortPill({ port, kind }: { port: number; kind: 'declared' | 'discovered' }) {
  const url = `http://localhost:${port}`
  return (
    <button
      className={`port-pill port-pill-${kind}`}
      onClick={() => window.electronShell.openExternal(url)}
      title={`${url} · ${kind}`}
    >
      :{port}
    </button>
  )
}
