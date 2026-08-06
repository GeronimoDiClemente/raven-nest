import { useState, useMemo, memo, type CSSProperties } from 'react'
import { useTeamStats, type PrSizeBuckets } from '../hooks/useTeamStats'
import type { PresenceState } from '../hooks/useTeamPresence'

interface TeamStatsProps {
  repos: Array<{ repo_full_name: string }>
  githubToken: string | null
  presence: Record<string, PresenceState>
  members: Array<{ login: string | null; name: string; avatarUrl: string; online: boolean }>
  viewerLogin: string
}

export function onlineGithubLogins(presence: Record<string, PresenceState>): Set<string> {
  const set = new Set<string>()
  for (const p of Object.values(presence)) {
    if (p.githubLogin) set.add(p.githubLogin.toLowerCase())
  }
  return set
}

// ▲/▼ vs previous period. Semantic green/red, never color alone (carries arrow + %).
function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) {
    if (current === 0) return null
    return <span className="ts-delta up" title="No activity in the previous period">▲ new</span>
  }
  const pct = Math.round(((current - previous) / previous) * 100)
  if (pct === 0) return <span className="ts-delta flat">— 0%</span>
  const up = pct > 0
  return (
    <span className={`ts-delta ${up ? 'up' : 'down'}`} title={`${current} vs ${previous} in the previous period`}>
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  )
}

function dayLabel(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000)
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
}

// Aligns the tooltip to the column edge when it's near the extremes,
// so it doesn't get clipped against the panel edge (worst in Month view).
function tipStyle(i: number, n: number): CSSProperties {
  const Y = 'calc(-100% - 4px)'
  if (i <= 1) return { left: 0, transform: `translateY(${Y})` }
  if (i >= n - 2) return { right: 0, left: 'auto', transform: `translateY(${Y})` }
  return { left: '50%', transform: `translate(-50%, ${Y})` }
}

// "Round" ceiling (multiple of 4) so the ticks 0 / half / ceiling are integers.
function niceCeil(v: number): number {
  return Math.max(4, Math.ceil(v / 4) * 4)
}

// Team activity per day — a single series (brand blue). Thin bars with
// rounded top, dotted gridlines with scale, and TODAY highlighted in full blue
// (the other days at 55% of the same blue). Team-level: no per-person breakdown.
const TeamBarChart = memo(function TeamBarChart({ daily }: { daily: number[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const n = daily.length
  const top = niceCeil(Math.max(...daily))
  const ticks = [top, top / 2, 0]
  const total = daily.reduce((a, b) => a + b, 0)
  return (
    <div className="ts-chart">
      <div className="ts-chart-plot">
        <div className="ts-chart-axis">
          {ticks.map(t => <span key={t}>{t}</span>)}
        </div>
        <div className="ts-chart-grid" onMouseLeave={() => setHover(null)}>
          {ticks.map(t => <span key={t} className="ts-grid-line" style={{ bottom: `${(t / top) * 100}%` }} />)}
          <div className="ts-chart-bars">
            {daily.map((v, i) => {
              const daysAgo = n - 1 - i
              const isToday = daysAgo === 0
              return (
                <div
                  key={i}
                  className={`ts-bar-col${hover === i ? ' hover' : ''}`}
                  onMouseEnter={() => setHover(i)}
                >
                  {hover === i && (
                    <div className="ts-bar-tip" style={tipStyle(i, n)}>
                      <strong>{v}</strong> commit{v === 1 ? '' : 's'}
                      <span>{isToday ? 'today' : dayLabel(daysAgo)}</span>
                    </div>
                  )}
                  <div
                    className={`ts-bar${isToday ? ' today' : ''}`}
                    style={{ height: `${(v / top) * 100}%` }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="ts-chart-foot">
        <span>{dayLabel(n - 1)}</span>
        <span className="ts-chart-total">{total} commits in the period</span>
        <span>today</span>
      </div>
    </div>
  )
})

// Formats hours to a legible unit: 40m / 6h / 2.3d.
function fmtDuration(hours: number | null): string {
  if (hours == null) return '—'
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${Math.round(hours)}h`
  return `${(hours / 24).toFixed(1)}d`
}

// Distribution of merged PRs by size. Small PRs review faster and safer, so this
// is the counter-metric to raw throughput — "many PRs" read against "how big".
const PR_SIZE_ROWS: { key: string; hint: string; field: keyof PrSizeBuckets; color: string }[] = [
  { key: 'S', hint: '≤50 lines', field: 's', color: '#22C55E' },
  { key: 'M', hint: '51–200', field: 'm', color: '#0066FF' },
  { key: 'L', hint: '201–500', field: 'l', color: '#FFB800' },
  { key: 'XL', hint: '>500', field: 'xl', color: '#FF4500' },
]

const PrSizeBars = memo(function PrSizeBars({ sizes }: { sizes: PrSizeBuckets }) {
  const total = sizes.s + sizes.m + sizes.l + sizes.xl
  if (total === 0) return <div className="ts-empty">No merged PRs in this period</div>
  const max = Math.max(sizes.s, sizes.m, sizes.l, sizes.xl, 1)
  return (
    <div className="ts-prsize">
      {PR_SIZE_ROWS.map(r => {
        const n = sizes[r.field]
        return (
          <div className="ts-prsize-row" key={r.key} title={`${n} PR${n === 1 ? '' : 's'} · ${r.hint}`}>
            <span className="ts-prsize-key">{r.key}</span>
            <div className="ts-prsize-track">
              <div className="ts-prsize-fill" style={{ width: `${(n / max) * 100}%`, background: r.color }} />
            </div>
            <span className="ts-prsize-n">{n}</span>
            <span className="ts-prsize-hint">{r.hint}</span>
          </div>
        )
      })}
    </div>
  )
})

function StatsSkeleton() {
  return (
    <div className="ts-container" aria-busy="true" aria-label="Loading team stats">
      <div className="ts-overview-row">
        {[0, 1, 2, 3, 4, 5, 6].map(i => <div key={i} className="ts-skeleton ts-skel-card" />)}
      </div>
      <div>
        {[0, 1, 2, 3].map(i => <div key={i} className="ts-skeleton ts-skel-row" />)}
      </div>
    </div>
  )
}

export default function TeamStats({ repos, githubToken, presence }: TeamStatsProps) {
  const [windowDays, setWindowDays] = useState<7 | 30>(7)
  const { stats, loading, error, warning } = useTeamStats(repos, githubToken, windowDays)
  const onlineCount = Object.keys(presence).length

  // Team commits per day = sum of each dev's dailyCommits (aggregate, not per-dev).
  const teamDaily = useMemo(() => {
    const n = stats.developers[0]?.dailyCommits.length ?? windowDays
    const out = Array<number>(n).fill(0)
    for (const d of stats.developers) d.dailyCommits.forEach((c, i) => { out[i] += c })
    return out
  }, [stats.developers, windowDays])

  if (!githubToken) {
    return (
      <div className="ts-container">
        <div className="ts-empty">
          <svg className="ts-empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" />
            <path d="M8 12h8M12 8v8" strokeLinecap="round" />
          </svg>
          Connect your GitHub account to see team stats
        </div>
      </div>
    )
  }

  if (loading) {
    return <StatsSkeleton />
  }

  if (error) {
    return (
      <div className="ts-container">
        <div className="ts-empty">{error}</div>
      </div>
    )
  }

  const {
    developers, totalCommits, totalPrsMerged, totalReviews,
    mergeTimeHours, reviewLatencyHours, prSizes, reviewCov,
    prevCommits, prevPrsMerged,
  } = stats
  const coveragePct = reviewCov.mergedTotal ? `${Math.round(reviewCov.pct * 100)}%` : '—'

  return (
    <div className="ts-container">
      {warning && (
        <div className="ts-warning" role="status">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M8 1.5 15 14H1L8 1.5Z" strokeLinejoin="round" />
            <path d="M8 6.5v3.5M8 12v.4" strokeLinecap="round" />
          </svg>
          {warning}
        </div>
      )}

      {/* Team pulse + flow & health — aggregate metrics only, no per-person ranking.
          Raw counts (commits/PRs) are throughput; the flow cards (cycle time,
          review latency, coverage) and PR size are the quality counter-metrics. */}
      <div>
        <div className="ts-cards-header">
          <div className="ts-section-title">{windowDays === 7 ? 'This week' : 'This month'}</div>
          <div className="ts-toggle" role="tablist" aria-label="Time period">
            <button
              role="tab"
              aria-selected={windowDays === 7}
              className={`ts-toggle-btn${windowDays === 7 ? ' active' : ''}`}
              onClick={() => setWindowDays(7)}
            >Week</button>
            <button
              role="tab"
              aria-selected={windowDays === 30}
              className={`ts-toggle-btn${windowDays === 30 ? ' active' : ''}`}
              onClick={() => setWindowDays(30)}
            >Month</button>
          </div>
        </div>
        <div className="ts-overview-row">
          <div className="ts-card">
            <span className="ts-card-label">Online now</span>
            <span className="ts-card-value">{onlineCount}</span>
            <span className="ts-card-sub">developers active</span>
          </div>
          <div className="ts-card">
            <span className="ts-card-label">Commits</span>
            <span className="ts-card-value">{totalCommits}</span>
            <span className="ts-card-sub">across all repos <DeltaBadge current={totalCommits} previous={prevCommits} /></span>
          </div>
          <div className="ts-card">
            <span className="ts-card-label">PRs merged</span>
            <span className="ts-card-value">{totalPrsMerged}</span>
            <span className="ts-card-sub">{windowDays === 7 ? 'this week' : 'this month'} <DeltaBadge current={totalPrsMerged} previous={prevPrsMerged} /></span>
          </div>
          <div className="ts-card">
            <span className="ts-card-label">Reviews</span>
            <span className="ts-card-value">{totalReviews}</span>
            <span className="ts-card-sub">PRs reviewed by the team</span>
          </div>
          <div className="ts-card">
            <span className="ts-card-label">Cycle time</span>
            <span className="ts-card-value">{fmtDuration(mergeTimeHours)}</span>
            <span className="ts-card-sub">median, open → merge</span>
          </div>
          <div className="ts-card">
            <span className="ts-card-label">Review latency</span>
            <span className="ts-card-value">{fmtDuration(reviewLatencyHours)}</span>
            <span className="ts-card-sub">median, open → first review</span>
          </div>
          <div className="ts-card">
            <span className="ts-card-label">Review coverage</span>
            <span className="ts-card-value">{coveragePct}</span>
            <span className="ts-card-sub">{reviewCov.reviewed} / {reviewCov.mergedTotal} PRs reviewed</span>
          </div>
        </div>
      </div>

      {/* PR size distribution */}
      <div>
        <div className="ts-section-title">PR size distribution</div>
        <PrSizeBars sizes={prSizes} />
      </div>

      {/* Team activity chart — aggregate commits per day */}
      {developers.length > 0 && (
        <div>
          <div className="ts-section-title">Team activity — commits per day</div>
          <TeamBarChart daily={teamDaily} />
        </div>
      )}

    </div>
  )
}
