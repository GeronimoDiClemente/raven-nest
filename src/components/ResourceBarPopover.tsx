import { useMemo, useState, type ReactNode } from 'react'
import type { MetricsSnapshot, RepoMetric, WorktreeMetricInfo, PaneMetric, DiskBucket } from '../types'
import { ClaudeLogo, GeminiLogo, CodexLogo, CopilotLogo, OpenCodeLogo } from './AILogos'

type PrimaryMetric = 'memory' | 'cpu'

interface Props {
  snapshot: MetricsSnapshot | null
  ports: Record<number, number[]>
  primary: PrimaryMetric
  onPrimaryChange: (next: PrimaryMetric) => void
  onRefreshDisk: () => void
  onRefresh: () => Promise<void>
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

// Thresholds for the "heaviest pane" callout. Fires when EITHER total RAM
// share crosses 50% OR absolute memory crosses 6 GB — covers both small-RAM
// laptops (16 GB user hits 50% sooner than 6 GB) and big rigs where 6 GB is
// still meaningful in absolute terms even if it's a small share.
const HEAVY_RAM_SHARE_PCT = 50
const HEAVY_MEM_BYTES = 6 * 1024 * 1024 * 1024

interface HeaviestPaneInfo {
  pane: PaneMetric
  repoName: string
  branchLabel: string
}

function findHeaviestPane(snapshot: MetricsSnapshot): HeaviestPaneInfo | null {
  let best: HeaviestPaneInfo | null = null
  for (const repo of snapshot.repos) {
    for (const wt of repo.worktrees) {
      for (const pane of wt.panes) {
        if (!Number.isFinite(pane.memBytes) || pane.memBytes <= 0) continue
        if (best === null || pane.memBytes > best.pane.memBytes) {
          best = { pane, repoName: repo.repoName, branchLabel: wt.branchLabel }
        }
      }
    }
  }
  return best
}

export default function ResourceBarPopover({
  snapshot, ports, primary, onPrimaryChange, onRefreshDisk, onRefresh, isDiskRefreshing, onClose,
}: Props) {
  const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(new Set())
  const [collapsedWorktrees, setCollapsedWorktrees] = useState<Set<string>>(new Set())
  // Track which PID is mid-kill so we can disable the button and avoid a
  // second confirm dialog landing while the first taskkill is still running.
  const [killingPid, setKillingPid] = useState<number | null>(null)

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

  const heaviestCallout = useMemo(() => {
    if (!snapshot) return null
    const overShare = snapshot.totals.ramSharePercent > HEAVY_RAM_SHARE_PCT
    const overAbsolute = snapshot.totals.memBytes > HEAVY_MEM_BYTES
    if (!overShare && !overAbsolute) return null
    return findHeaviestPane(snapshot)
  }, [snapshot])

  const handleKill = async (pane: PaneMetric) => {
    if (killingPid !== null) return
    // Native confirm is sufficient per spec; matches what other in-app kill
    // flows do (PaneHeader uses confirm() too). Keeping it synchronous and
    // dependency-free.
    const ok = window.confirm(`Kill ${pane.label} (PID ${pane.pid})?`)
    if (!ok) return
    setKillingPid(pane.pid)
    try {
      const res = await window.metrics.killPid(pane.pid)
      if (!res.ok) {
        console.warn('[ResourceBar] killPid failed', res.error)
      }
    } catch (err) {
      console.warn('[ResourceBar] killPid threw', err)
    } finally {
      // Re-poll so the killed pane drops out of the tree without waiting for
      // the next interval (would otherwise show 0%/0B for up to 2s).
      try { await onRefresh() } catch {}
      setKillingPid(null)
    }
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
            {heaviestCallout && (
              <div className="rb-heavy-banner" role="status">
                <span className="rb-heavy-icon">⚠</span>
                <span className="rb-heavy-text">
                  Heaviest pane: <strong>{heaviestCallout.pane.label}</strong> using {formatBytes(heaviestCallout.pane.memBytes)}
                  {' · '}
                  <span className="rb-heavy-loc">{heaviestCallout.repoName}/{heaviestCallout.branchLabel}</span>
                </span>
              </div>
            )}

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
                  ports={ports}
                  killingPid={killingPid}
                  collapsed={collapsedRepos.has(repo.commonDir)}
                  collapsedWorktrees={collapsedWorktrees}
                  onToggleRepo={() => toggleRepo(repo.commonDir)}
                  onToggleWorktree={toggleWorktree}
                  onKill={handleKill}
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

// Top-N bucket preview for the inline repo header — keeps the header dense
// without overwhelming it. 3 is the magic number where you still see the
// dominant categories (node_modules + .git + dist usually).
function topBuckets(buckets: DiskBucket[] | undefined, n: number): DiskBucket[] {
  if (!Array.isArray(buckets) || buckets.length === 0) return []
  return buckets.slice(0, n)
}

function RepoNode({
  repo, ports, killingPid, collapsed, collapsedWorktrees, onToggleRepo, onToggleWorktree, onKill,
}: {
  repo: RepoMetric
  ports: Record<number, number[]>
  killingPid: number | null
  collapsed: boolean
  collapsedWorktrees: Set<string>
  onToggleRepo: () => void
  onToggleWorktree: (key: string) => void
  onKill: (pane: PaneMetric) => void
}) {
  const arrow = collapsed ? '▸' : '▾'
  const disk = diskLabel(repo.diskBytes)
  const inlineBuckets = topBuckets(repo.diskBuckets, 3)
  return (
    <div className="rb-section">
      <button className="rb-row rb-row--header rb-row--clickable" onClick={onToggleRepo}>
        <span className="rb-row-label">
          <span className="rb-arrow">{arrow}</span> {repo.repoName}
          {inlineBuckets.length > 0 && (
            <span className="rb-bucket-inline">
              {inlineBuckets.map((b) => (
                <span key={b.name} className="rb-bucket-inline-item">
                  <span className="rb-bucket-sep">·</span> {b.name} {formatBytes(b.size)}
                </span>
              ))}
            </span>
          )}
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
          ports={ports}
          killingPid={killingPid}
          collapsed={collapsedWorktrees.has(wt.worktreePath)}
          onToggle={() => onToggleWorktree(wt.worktreePath)}
          onKill={onKill}
        />
      ))}
    </div>
  )
}

function WorktreeNode({
  worktree, ports, killingPid, collapsed, onToggle, onKill,
}: {
  worktree: WorktreeMetricInfo
  ports: Record<number, number[]>
  killingPid: number | null
  collapsed: boolean
  onToggle: () => void
  onKill: (pane: PaneMetric) => void
}) {
  const arrow = collapsed ? '▸' : '▾'
  const disk = diskLabel(worktree.diskBytes)
  // Union of ports listened on by any pane in this worktree, deduped + sorted.
  // We tolerate the case where ports[pid] is undefined (first poll, or pid
  // with no listening sockets) — just skip it silently.
  const worktreePorts: number[] = (() => {
    const set = new Set<number>()
    for (const pane of worktree.panes) {
      const list = ports[pane.pid]
      if (Array.isArray(list)) {
        for (const p of list) set.add(p)
      }
    }
    return Array.from(set).sort((a, b) => a - b)
  })()
  const showBuckets = !collapsed && Array.isArray(worktree.diskBuckets) && worktree.diskBuckets.length > 0
  return (
    <>
      <button className="rb-row rb-row--child rb-row--clickable" onClick={onToggle}>
        <span className="rb-row-label">
          <span className="rb-arrow">{arrow}</span> {worktree.branchLabel}
          {worktreePorts.length > 0 && (
            <span className="rb-port-chips">
              {worktreePorts.map((port) => (
                <span key={port} className="rb-port-chip">:{port}</span>
              ))}
            </span>
          )}
        </span>
        <span className="rb-row-metric">
          {formatPct(worktree.cpuPercent)} / {formatBytes(worktree.memBytes)}
          <span className="rb-row-disk"> · disk {disk}</span>
        </span>
      </button>
      {showBuckets && (
        <>
          {worktree.diskBuckets!.map((b) => (
            <div key={b.name} className="rb-row rb-row--grandchild rb-bucket-row">
              <span className="rb-row-label rb-bucket-name">{b.name}</span>
              <span className="rb-row-metric rb-bucket-size">{formatBytes(b.size)}</span>
            </div>
          ))}
          <div className="rb-bucket-divider" />
        </>
      )}
      {!collapsed && worktree.panes.map((pane) => (
        <PaneRow
          key={pane.paneId}
          pane={pane}
          killing={killingPid === pane.pid}
          killDisabled={killingPid !== null && killingPid !== pane.pid}
          onKill={onKill}
        />
      ))}
    </>
  )
}

// AI identified by the same miniature logo used in the pane header
// (claude/gemini/codex/copilot/opencode SVGs). aiColor drives the tint —
// same color the user sees in the pane header's color dot, so changing
// the color from the header propagates here on the next poll. Custom
// CLIs without a known logo fall back to a colored square. The note is
// the only text — the AI name is intentionally omitted to avoid the
// redundant "Claude Claude Claude" stack in long worktrees.
function renderPaneLabel(pane: PaneMetric): ReactNode {
  const noteText = pane.label.trim()
  const color = pane.aiColor ?? '#888888'
  return (
    <>
      <span className="rb-bullet-logo" style={{ color }}>
        <PaneAILogo aiType={pane.aiType} color={color} size={11} />
      </span>
      {noteText && (
        <>
          {' '}
          <span className="rb-label-note">{noteText}</span>
        </>
      )}
    </>
  )
}

function PaneAILogo({ aiType, color, size }: { aiType: string | undefined; color: string; size: number }): ReactNode {
  switch (aiType) {
    case 'claude':   return <ClaudeLogo size={size} />
    case 'gemini':   return <GeminiLogo size={size} />
    case 'codex':    return <CodexLogo size={size} color={color} />
    case 'copilot':  return <CopilotLogo size={size} />
    case 'opencode': return <OpenCodeLogo size={size} color={color} />
    case 'external':
      // Mini terminal box icon — signals "aggregated process group, not a
      // single pane". Same stroke color as aiColor so the user can read it
      // as "neutral, non-AI" alongside the colorful AI logos.
      return (
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
          <rect x="0.75" y="2" width="10.5" height="8" rx="1.5" fill="none" stroke={color} strokeWidth="1.2" />
          <path d="M3 5.2 L5 6.5 L3 7.8 M6 8 L8.5 8" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      )
    default:
      // Custom CLIs (or panes whose aiType isn't surfaced) → colored square.
      return <span style={{ display: 'inline-block', width: size, height: size, background: color, borderRadius: 2 }} />
  }
}

function PaneRow({
  pane, killing, killDisabled, onKill,
}: {
  pane: PaneMetric
  killing: boolean
  killDisabled: boolean
  onKill: (pane: PaneMetric) => void
}) {
  // Aggregated "External" rows use pid: 0 as a sentinel — they represent
  // many child processes, not a single killable one. Hide the kill button.
  const killable = pane.pid > 0
  return (
    <div className="rb-row rb-row--grandchild rb-row--has-kill">
      <span className="rb-row-label">
        {renderPaneLabel(pane)}
      </span>
      <span className="rb-row-metric">
        {formatPct(pane.cpuPercent)} / {formatBytes(pane.memBytes)}
      </span>
      {killable && (
        <button
          className="rb-kill-btn"
          type="button"
          onClick={(e) => { e.stopPropagation(); onKill(pane) }}
          disabled={killing || killDisabled}
          title={killing ? 'Killing…' : `Kill ${pane.label} (PID ${pane.pid})`}
          aria-label={`Kill ${pane.label}`}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}
