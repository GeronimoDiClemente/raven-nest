import { useCallback, useEffect, useMemo, useRef, useState, type FC, type ReactNode } from 'react'
import type { MetricsSnapshot, RepoMetric, WorktreeMetricInfo, PaneMetric, DiskBucket } from '../types'
import { ClaudeLogo, GeminiLogo, CodexLogo, CopilotLogo, OpenCodeLogo } from './AILogos'
import { formatBytes, formatPct, diskLabel } from '../lib/formatMetrics'

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

function useToggleSet(): [Set<string>, (k: string) => void] {
  const [set, setSet] = useState<Set<string>>(new Set())
  const toggle = useCallback((k: string) => {
    setSet((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }, [])
  return [set, toggle]
}

export default function ResourceBarPopover({
  snapshot, ports, primary, onPrimaryChange, onRefreshDisk, onRefresh, isDiskRefreshing, onClose,
}: Props) {
  const [collapsedRepos, toggleRepo] = useToggleSet()
  const [collapsedWorktrees, toggleWorktree] = useToggleSet()
  // Track which PID is mid-kill so we can disable the button and avoid a
  // second confirm dialog landing while the first taskkill is still running.
  const [killingPid, setKillingPid] = useState<number | null>(null)
  // Guard setKillingPid() against the popover unmounting (e.g. user clicks the
  // backdrop) while the killPid IPC await is in flight.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

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
    if (mountedRef.current) setKillingPid(pane.pid)
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
      if (mountedRef.current) setKillingPid(null)
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
                <span className="rb-heavy-icon" aria-hidden="true">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M8 1.7 15 14.3H1L8 1.7Z" strokeLinejoin="round" />
                    <path d="M8 6.4v3.4M8 11.8v.5" strokeLinecap="round" />
                  </svg>
                </span>
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
  const worktreePorts = useMemo<number[]>(() => {
    const set = new Set<number>()
    for (const pane of worktree.panes) {
      const list = ports[pane.pid]
      if (Array.isArray(list)) {
        for (const p of list) set.add(p)
      }
    }
    return Array.from(set).sort((a, b) => a - b)
  }, [worktree.panes, ports])
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

// Each "external-*" kind is grouped server-side by classifyExternalProcess.
// Logos are intentionally minimal — they need to read at 11px next to the
// AI logos. Color comes from EXTERNAL_KIND_META in metrics-collector.ts.
// The map key is whatever comes after the `external-` prefix in aiType; the
// bare `external` aiType (and the legacy `external-external` value) both fall
// back to ShellLogo via the `external` entry.
const EXTERNAL_LOGOS: Record<string, FC<{ size: number; color: string }>> = {
  node: NodeLogo, electron: ElectronLogo, python: PythonLogo, docker: DockerLogo,
  postgres: PostgresLogo, redis: RedisLogo, mongo: MongoLogo, mysql: MysqlLogo,
  java: JavaLogo, ruby: RubyLogo, php: PhpLogo, go: GoLogo, rust: RustLogo,
  shell: ShellLogo, external: ShellLogo,
}

function PaneAILogo({ aiType, color, size }: { aiType: string | undefined; color: string; size: number }): ReactNode {
  switch (aiType) {
    case 'claude':   return <ClaudeLogo size={size} />
    case 'gemini':   return <GeminiLogo size={size} />
    case 'codex':    return <CodexLogo size={size} color={color} />
    case 'copilot':  return <CopilotLogo size={size} />
    case 'opencode': return <OpenCodeLogo size={size} color={color} />
  }

  if (aiType === 'external' || aiType?.startsWith('external-')) {
    const kind = aiType === 'external' ? 'external' : aiType.slice('external-'.length)
    const Logo = EXTERNAL_LOGOS[kind] ?? ShellLogo
    return <Logo size={size} color={color} />
  }

  // Custom CLIs (or panes whose aiType isn't surfaced) → colored square.
  return <span style={{ display: 'inline-block', width: size, height: size, background: color, borderRadius: 2 }} />
}

// ── External kind logos ────────────────────────────────────────────────────
// All sized to a 12×12 viewBox so they sit on the same baseline as AILogos.

function NodeLogo({ size, color }: { size: number; color: string }) {
  // Hexagon — Node.js' signature shape.
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 0.6 L11 3.3 L11 8.7 L6 11.4 L1 8.7 L1 3.3 Z" fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function ElectronLogo({ size, color }: { size: number; color: string }) {
  // Two crossed orbits + nucleus — Electron's atom mark.
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <ellipse cx="6" cy="6" rx="5" ry="2" fill="none" stroke={color} strokeWidth="1" />
      <ellipse cx="6" cy="6" rx="5" ry="2" fill="none" stroke={color} strokeWidth="1" transform="rotate(60 6 6)" />
      <ellipse cx="6" cy="6" rx="5" ry="2" fill="none" stroke={color} strokeWidth="1" transform="rotate(-60 6 6)" />
      <circle cx="6" cy="6" r="1" fill={color} />
    </svg>
  )
}

function PythonLogo({ size, color }: { size: number; color: string }) {
  // Two interlocked rounded rectangles — Python's snake-pair shape, simplified.
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2" y="1" width="6" height="6" rx="2" fill="none" stroke={color} strokeWidth="1.2" />
      <rect x="4" y="5" width="6" height="6" rx="2" fill="none" stroke={color} strokeWidth="1.2" />
      <circle cx="3.5" cy="2.6" r="0.5" fill={color} />
      <circle cx="8.5" cy="9.4" r="0.5" fill={color} />
    </svg>
  )
}

function DockerLogo({ size, color }: { size: number; color: string }) {
  // Stacked containers under a whale-fin curve.
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2"   y="6" width="1.6" height="1.6" fill={color} />
      <rect x="4"   y="6" width="1.6" height="1.6" fill={color} />
      <rect x="6"   y="6" width="1.6" height="1.6" fill={color} />
      <rect x="4"   y="4" width="1.6" height="1.6" fill={color} />
      <rect x="6"   y="4" width="1.6" height="1.6" fill={color} />
      <rect x="6"   y="2" width="1.6" height="1.6" fill={color} />
      <path d="M1 8 Q3 10 6 10 Q9 10 10.5 8" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function PostgresLogo({ size, color }: { size: number; color: string }) {
  // Database cylinder — recognisable for any RDBMS, used here for Postgres.
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <ellipse cx="6" cy="2.5" rx="4" ry="1.3" fill="none" stroke={color} strokeWidth="1.2" />
      <path d="M2 2.5 L2 9.5 Q2 10.8 6 10.8 Q10 10.8 10 9.5 L10 2.5" fill="none" stroke={color} strokeWidth="1.2" />
      <path d="M2 5.5 Q2 6.8 6 6.8 Q10 6.8 10 5.5" fill="none" stroke={color} strokeWidth="1" />
    </svg>
  )
}

function RedisLogo({ size, color }: { size: number; color: string }) {
  // Three stacked discs — Redis' tower mark, simplified.
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <ellipse cx="6" cy="3"   rx="4.5" ry="1.4" fill="none" stroke={color} strokeWidth="1.1" />
      <ellipse cx="6" cy="6"   rx="4.5" ry="1.4" fill="none" stroke={color} strokeWidth="1.1" />
      <ellipse cx="6" cy="9"   rx="4.5" ry="1.4" fill="none" stroke={color} strokeWidth="1.1" />
    </svg>
  )
}

function MongoLogo({ size, color }: { size: number; color: string }) {
  // Leaf shape — Mongo's signature.
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1 Q3 4 3 7 Q3 9.5 6 11 Q9 9.5 9 7 Q9 4 6 1 Z" fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6 2.5 L6 10.5" stroke={color} strokeWidth="1" />
    </svg>
  )
}

function MysqlLogo({ size, color }: { size: number; color: string }) {
  // Dolphin-curve fin — MySQL's mark, very minimal.
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1 9 Q4 2 11 3 Q6 4 4 10 Z" fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="8.5" cy="3.5" r="0.5" fill={color} />
    </svg>
  )
}

function JavaLogo({ size, color }: { size: number; color: string }) {
  // Coffee cup with steam.
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 5 L9 5 L8.5 10 Q8.3 11 7 11 L5 11 Q3.7 11 3.5 10 Z" fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9 6 Q10.5 6 10.5 7.5 Q10.5 9 9 9" fill="none" stroke={color} strokeWidth="1.1" />
      <path d="M5 3 Q5 1.5 6 1.5 M7 3 Q7 1.5 8 1.5" fill="none" stroke={color} strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}

function RubyLogo({ size, color }: { size: number; color: string }) {
  // Diamond/gem facets.
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 4 L6 1 L10 4 L6 11 Z" fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M2 4 L10 4 M6 1 L6 11 M2 4 L6 4 M10 4 L6 4" stroke={color} strokeWidth="0.9" />
    </svg>
  )
}

function PhpLogo({ size, color }: { size: number; color: string }) {
  // Oval with "P" letter — PHP's elephant logo doesn't read at 11px, the
  // elongated oval is its other recognisable trait.
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <ellipse cx="6" cy="6" rx="5.3" ry="3.3" fill="none" stroke={color} strokeWidth="1.2" />
      <text x="6" y="8.2" textAnchor="middle" fontFamily="sans-serif" fontSize="4.5" fontWeight="700" fill={color}>php</text>
    </svg>
  )
}

function GoLogo({ size, color }: { size: number; color: string }) {
  // Gopher silhouette doesn't read; use the "GO" wordmark with the gopher's
  // signature blue (caller-color) tone.
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="4" cy="6" r="1.4" fill="none" stroke={color} strokeWidth="1.1" />
      <path d="M5.5 6 L8.5 6 M7 6 L7 8 L9.5 8 L9.5 5 L7 5" fill="none" stroke={color} strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  )
}

function RustLogo({ size, color }: { size: number; color: string }) {
  // Gear with letter — Rust's iconic cog.
  const teeth = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI * 2) / 8
    const x1 = 6 + Math.cos(a) * 4.6
    const y1 = 6 + Math.sin(a) * 4.6
    const x2 = 6 + Math.cos(a) * 5.6
    const y2 = 6 + Math.sin(a) * 5.6
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.1" strokeLinecap="round" />
  })
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      {teeth}
      <circle cx="6" cy="6" r="3.6" fill="none" stroke={color} strokeWidth="1.2" />
      <path d="M4.5 4 L4.5 8 M4.5 4 L6.5 4 Q7.5 4 7.5 5 Q7.5 6 6.5 6 L4.5 6 M6 6 L7.6 8" fill="none" stroke={color} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ShellLogo({ size, color }: { size: number; color: string }) {
  // Mini terminal box — generic "uncategorised process" mark.
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <rect x="0.75" y="2" width="10.5" height="8" rx="1.5" fill="none" stroke={color} strokeWidth="1.2" />
      <path d="M3 5.2 L5 6.5 L3 7.8 M6 8 L8.5 8" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
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
  const [hover, setHover] = useState(false)
  const [btnHover, setBtnHover] = useState(false)
  return (
    <div
      className="rb-row rb-row--grandchild rb-row--has-kill"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', paddingRight: 24 }}
    >
      <span className="rb-row-label">
        {renderPaneLabel(pane)}
      </span>
      <span className="rb-row-metric">
        {formatPct(pane.cpuPercent)} / {formatBytes(pane.memBytes)}
      </span>
      {killable && hover && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onKill(pane) }}
          disabled={killing || killDisabled}
          title={killing ? 'Killing…' : `Kill ${pane.label} (PID ${pane.pid})`}
          aria-label={`Kill ${pane.label}`}
          onMouseEnter={() => setBtnHover(true)}
          onMouseLeave={() => setBtnHover(false)}
          style={{
            position: 'absolute',
            right: 4,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            padding: 0,
            margin: 0,
            border: 0,
            outline: 0,
            boxShadow: 'none',
            background: btnHover ? 'rgba(255, 77, 77, 0.16)' : 'transparent',
            color: btnHover ? '#ff5f5f' : 'rgba(255, 255, 255, 0.55)',
            borderRadius: 5,
            cursor: killing || killDisabled ? 'default' : 'pointer',
            opacity: killing || killDisabled ? 0.4 : 1,
            font: 'inherit',
            WebkitAppearance: 'none',
            appearance: 'none',
            transition: 'background 120ms ease, color 120ms ease',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" style={{ display: 'block', pointerEvents: 'none' }}>
            <path d="M2 2L8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M8 2L2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}
