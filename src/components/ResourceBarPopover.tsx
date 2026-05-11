import { useState } from 'react'
import type { MetricsSnapshot, RepoMetric, WorktreeMetricInfo, PaneMetric } from '../types'

type PrimaryMetric = 'memory' | 'cpu'

interface Props {
  snapshot: MetricsSnapshot | null
  primary: PrimaryMetric
  onPrimaryChange: (next: PrimaryMetric) => void
  onRefreshDisk: () => void
  isDiskRefreshing: boolean
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let idx = 0
  let val = bytes
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024
    idx += 1
  }
  const decimals = val < 10 ? 2 : val < 100 ? 1 : 0
  return `${val.toFixed(decimals)} ${units[idx]}`
}

function formatPct(pct: number): string {
  if (!Number.isFinite(pct) || pct < 0) return '0.0%'
  return `${pct.toFixed(1)}%`
}

function diskLabel(bytes: number | null): string {
  return bytes === null ? '—' : formatBytes(bytes)
}

export default function ResourceBarPopover({
  snapshot, primary, onPrimaryChange, onRefreshDisk, isDiskRefreshing, onClose,
}: Props) {
  const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(new Set())
  const [collapsedWorktrees, setCollapsedWorktrees] = useState<Set<string>>(new Set())

  const toggleRepo = (key: string) => {
    setCollapsedRepos((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const toggleWorktree = (key: string) => {
    setCollapsedWorktrees((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <>
      <div className="rb-overlay" onClick={onClose} />
      <div className="resource-bar-popover" role="dialog" aria-label="Resource Usage">
        <div className="rb-popover-header">
          <span className="rb-popover-title">RESOURCE USAGE</span>
          <div className="rb-popover-controls">
            <select
              className="rb-toggle"
              value={primary}
              onChange={(e) => onPrimaryChange(e.target.value as PrimaryMetric)}
              aria-label="Primary metric"
            >
              <option value="memory">Memory</option>
              <option value="cpu">CPU</option>
            </select>
            <button
              className={`rb-refresh${isDiskRefreshing ? ' rb-refresh--spinning' : ''}`}
              onClick={onRefreshDisk}
              disabled={isDiskRefreshing}
              title="Recompute disk usage for all worktrees"
            >
              ↻
            </button>
          </div>
        </div>

        {snapshot ? (
          <>
            <div className="rb-totals">
              <div className="rb-total-item">
                <span className="rb-total-label">CPU</span>
                <span className="rb-total-value">{formatPct(snapshot.totals.cpuPercent)}</span>
              </div>
              <div className="rb-total-item">
                <span className="rb-total-label">MEMORY</span>
                <span className="rb-total-value">{formatBytes(snapshot.totals.memBytes)}</span>
              </div>
              <div className="rb-total-item">
                <span className="rb-total-label">RAM SHARE</span>
                <span className="rb-total-value">{formatPct(snapshot.totals.ramSharePercent)}</span>
              </div>
            </div>

            <div className="rb-divider" />

            <div className="rb-section">
              <div className="rb-row rb-row--header">
                <span className="rb-row-label">Nest App</span>
                <span className="rb-row-metric">
                  {formatPct(snapshot.nest.cpuPercent)} / {formatBytes(snapshot.nest.memBytes)}
                </span>
              </div>
              {snapshot.nest.processes.length === 0 ? (
                <div className="rb-row rb-row--child rb-row--empty">No process data</div>
              ) : (
                groupNestProcesses(snapshot.nest.processes).map((g) => (
                  <div key={g.type} className="rb-row rb-row--child">
                    <span className="rb-row-label">{g.type}</span>
                    <span className="rb-row-metric">
                      {formatPct(g.cpuPercent)} / {formatBytes(g.memBytes)}
                    </span>
                  </div>
                ))
              )}
            </div>

            {snapshot.repos.length > 0 && <div className="rb-divider" />}

            {snapshot.repos.length === 0 ? (
              <div className="rb-row rb-row--empty">No repos linked to active panes</div>
            ) : (
              snapshot.repos.map((repo) => (
                <RepoNode
                  key={repo.commonDir}
                  repo={repo}
                  collapsed={collapsedRepos.has(repo.commonDir)}
                  collapsedWorktrees={collapsedWorktrees}
                  onToggleRepo={() => toggleRepo(repo.commonDir)}
                  onToggleWorktree={toggleWorktree}
                />
              ))
            )}
          </>
        ) : (
          <div className="rb-row rb-row--empty">Loading…</div>
        )}
      </div>
    </>
  )
}

function groupNestProcesses(processes: { type: 'Main' | 'Renderer' | 'Other'; cpuPercent: number; memBytes: number }[]) {
  const groups = new Map<'Main' | 'Renderer' | 'Other', { type: 'Main' | 'Renderer' | 'Other'; cpuPercent: number; memBytes: number }>()
  for (const p of processes) {
    const existing = groups.get(p.type)
    if (existing) {
      existing.cpuPercent += p.cpuPercent
      existing.memBytes += p.memBytes
    } else {
      groups.set(p.type, { type: p.type, cpuPercent: p.cpuPercent, memBytes: p.memBytes })
    }
  }
  // Always show Main/Renderer first if present, then Other.
  const order: Array<'Main' | 'Renderer' | 'Other'> = ['Main', 'Renderer', 'Other']
  return order.flatMap((t) => {
    const g = groups.get(t)
    return g ? [g] : []
  })
}

function RepoNode({
  repo, collapsed, collapsedWorktrees, onToggleRepo, onToggleWorktree,
}: {
  repo: RepoMetric
  collapsed: boolean
  collapsedWorktrees: Set<string>
  onToggleRepo: () => void
  onToggleWorktree: (key: string) => void
}) {
  const arrow = collapsed ? '▸' : '▾'
  const disk = diskLabel(repo.diskBytes)
  return (
    <div className="rb-section">
      <button className="rb-row rb-row--header rb-row--clickable" onClick={onToggleRepo}>
        <span className="rb-row-label">
          <span className="rb-arrow">{arrow}</span> {repo.repoName}
        </span>
        <span className="rb-row-metric">
          {formatPct(repo.cpuPercent)} / {formatBytes(repo.memBytes)}
          <span className="rb-row-disk"> · disk {disk}</span>
        </span>
      </button>
      {!collapsed && repo.worktrees.map((wt) => (
        <WorktreeNode
          key={wt.worktreePath}
          worktree={wt}
          collapsed={collapsedWorktrees.has(wt.worktreePath)}
          onToggle={() => onToggleWorktree(wt.worktreePath)}
        />
      ))}
    </div>
  )
}

function WorktreeNode({
  worktree, collapsed, onToggle,
}: {
  worktree: WorktreeMetricInfo
  collapsed: boolean
  onToggle: () => void
}) {
  const arrow = collapsed ? '▸' : '▾'
  const disk = diskLabel(worktree.diskBytes)
  return (
    <>
      <button className="rb-row rb-row--child rb-row--clickable" onClick={onToggle}>
        <span className="rb-row-label">
          <span className="rb-arrow">{arrow}</span> {worktree.branchLabel}
        </span>
        <span className="rb-row-metric">
          {formatPct(worktree.cpuPercent)} / {formatBytes(worktree.memBytes)}
          <span className="rb-row-disk"> · disk {disk}</span>
        </span>
      </button>
      {!collapsed && worktree.panes.map((pane) => (
        <PaneRow key={pane.paneId} pane={pane} />
      ))}
    </>
  )
}

function PaneRow({ pane }: { pane: PaneMetric }) {
  return (
    <div className="rb-row rb-row--grandchild">
      <span className="rb-row-label">
        <span className="rb-bullet">■</span> {pane.label}
      </span>
      <span className="rb-row-metric">
        {formatPct(pane.cpuPercent)} / {formatBytes(pane.memBytes)}
      </span>
    </div>
  )
}
