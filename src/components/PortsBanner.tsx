import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { WorktreeMeta } from '../types'

interface CellRef {
  paneId: string
  repoPath: string
}

interface Props {
  cells: CellRef[]
  rootRepoPath: string | null
  onOpenInternal?: (url: string) => void
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

export function PortsBanner({ cells, rootRepoPath, onOpenInternal }: Props) {
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

  // Guard against overlapping ticks: a single port scan can outlast the 3s
  // poll (slow git, many panes) and stack up, multiplying IPC pressure. Same
  // pattern as `inFlightRef` in src/hooks/useMetrics.ts.
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!rootRepoPath || cellsByWorktree.size === 0) { setGroups([]); return }
    let cancelled = false

    const tick = async () => {
      if (inFlightRef.current) return
      inFlightRef.current = true
      try {
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
      } finally {
        inFlightRef.current = false
      }
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
            <PortPill key={`d-${p}`} port={p} kind="declared" onOpenInternal={onOpenInternal} />
          ))}
          {g.detected.map((p) => (
            <PortPill key={`x-${p}`} port={p} kind="discovered" onOpenInternal={onOpenInternal} />
          ))}
        </div>
      ))}
    </div>
  )
}

function PortPill({ port, kind, onOpenInternal }: {
  port: number
  kind: 'declared' | 'discovered'
  onOpenInternal?: (url: string) => void
}) {
  const url = `http://localhost:${port}`
  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || !onOpenInternal) {
      window.electronShell.openExternal(url)
    } else {
      onOpenInternal(url)
    }
  }
  return (
    <button
      className={`port-pill port-pill-${kind}`}
      onClick={handleClick}
      title={`${url} · ${kind} · click to open in Browser cell, shift+click for external`}
    >
      :{port}
    </button>
  )
}
