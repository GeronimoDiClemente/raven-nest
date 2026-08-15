import { useEffect } from 'react'
import { useEmployeeFiles } from '../hooks/useEmployeeFiles'
import { openPrSignal, trendVsPrev } from '../lib/employee-analytics'
import type { OpenPr } from '../hooks/useTeamStats'

function sizeLabel(add: number, del: number): 'S' | 'M' | 'L' | 'XL' {
  const n = add + del
  return n <= 50 ? 'S' : n <= 200 ? 'M' : n <= 500 ? 'L' : 'XL'
}
function Delta({ cur, prev }: { cur: number; prev: number }) {
  const d = trendVsPrev(cur, prev)
  if (d === null) return <span className="ed-d up">▲ new</span>
  if (d === 0) return <span className="ed-d flat">— 0%</span>
  return <span className={`ed-d ${d > 0 ? 'up' : 'down'}`}>{d > 0 ? '▲' : '▼'} {Math.abs(d)}%</span>
}

export interface EmployeeCtx {
  login: string; name: string; avatarUrl: string; online: boolean
  commits: number; prevCommits: number; prsMerged: number; prevPrsMerged: number
  dailyCommits: number[]; openPrs: OpenPr[]
}

export default function EmployeeDetailPanel({
  emp, repos, githubToken, onClose,
}: {
  emp: EmployeeCtx
  repos: Array<{ repo_full_name: string }>
  githubToken: string | null
  onClose: () => void
}) {
  const { topAreas, mergedRecent, loading, error } = useEmployeeFiles(repos, githubToken, emp.login)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const maxArea = Math.max(1, ...topAreas.map(a => a.lines))
  const maxDay = Math.max(1, ...emp.dailyCommits)

  return (
    <>
      <div className="ed-scrim" onMouseDown={onClose} />
      <div className="ed-drawer" role="dialog" aria-label={`${emp.name} details`}>
        <div className="ed-head">
          <div className="ed-av">{emp.avatarUrl ? <img src={emp.avatarUrl} alt="" /> : emp.name.slice(0, 2)}</div>
          <div>
            <div className="ed-name">{emp.name}</div>
            <div className="ed-sub"><span className="ed-mdot" style={{ background: emp.online ? '#22C55E' : '#555' }} />{emp.online ? 'online' : 'offline'} · @{emp.login}</div>
          </div>
          <button className="ed-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="ed-sec">
          <h4>Trend — this week vs last</h4>
          <div className="ed-mini">
            <div className="ed-k"><div className="ed-v">{emp.commits}</div><div className="ed-l">commits <Delta cur={emp.commits} prev={emp.prevCommits} /></div></div>
            <div className="ed-k"><div className="ed-v">{emp.prsMerged}</div><div className="ed-l">PRs merged <Delta cur={emp.prsMerged} prev={emp.prevPrsMerged} /></div></div>
          </div>
          <div className="ed-spark">{emp.dailyCommits.map((v, i) => <i key={i} className={i === emp.dailyCommits.length - 1 ? 'today' : ''} style={{ height: `${Math.max(6, (v / maxDay) * 36)}px` }} />)}</div>
        </div>

        <div className="ed-sec">
          <h4>Working on now ({emp.openPrs.length} open PR{emp.openPrs.length === 1 ? '' : 's'})</h4>
          {emp.openPrs.length === 0 && <div className="ed-empty">No open PRs.</div>}
          {emp.openPrs.map(pr => {
            const s = openPrSignal({ createdAt: pr.createdAt, reviewCount: pr.reviewCount })
            return (
              <div className="ed-pr" key={`${pr.repo}#${pr.number}`}>
                <div className="ed-pr-t">{pr.title}</div>
                <div className="ed-pr-m">
                  <span>{pr.repo}</span>
                  <span className={`ed-flag ${s.stuck ? 'warn' : 'review'}`}>open {s.ageDays}d{s.awaitingReview ? ' · awaiting review' : ''}</span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="ed-sec">
          <h4>Recently merged</h4>
          {loading && <div className="ed-empty">Loading…</div>}
          {error && <div className="ed-empty">{error}</div>}
          {!loading && !error && mergedRecent.length === 0 && <div className="ed-empty">No merged PRs in this period.</div>}
          {mergedRecent.map(pr => (
            <div className="ed-pr" key={`${pr.repo}#${pr.number}`}>
              <div className="ed-pr-t">{pr.title}</div>
              <div className="ed-pr-m">
                <span className={`ed-size s-${sizeLabel(pr.additions, pr.deletions)}`}>{sizeLabel(pr.additions, pr.deletions)}</span>
                <span>+{pr.additions}/−{pr.deletions}</span><span>{pr.repo}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="ed-sec ed-last">
          <h4>Top areas touched</h4>
          {!loading && topAreas.length === 0 && <div className="ed-empty">No file data (PR-based).</div>}
          {topAreas.map(a => (
            <div className="ed-area" key={a.dir}>
              <span className="ed-area-p">{a.dir}</span>
              <span className="ed-area-track"><span className="ed-area-fill" style={{ width: `${(a.lines / maxArea) * 100}%` }} /></span>
              <span className="ed-area-n">{a.lines}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
