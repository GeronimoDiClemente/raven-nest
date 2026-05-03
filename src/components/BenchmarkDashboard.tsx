import { useEffect, useState } from 'react'

interface Sample {
  ts: number
  cpuPct: number | null
  rssMB: number | null
  mode: 'setup' | 'spotlight' | 'idle'
  processGone?: boolean
}

interface Session {
  cellId: string
  pid: number
  startedAt: number
  samples: Sample[]
  mode: string
}

function summarize(session: Session) {
  const s = session.samples
  if (s.length === 0) return { avgCpu: null, avgRss: null, peakRss: null, n: 0 }
  let cpuSum = 0, cpuN = 0, rssSum = 0, rssN = 0, peakRss = 0
  for (const x of s) {
    if (x.cpuPct !== null) { cpuSum += x.cpuPct; cpuN++ }
    if (x.rssMB !== null) {
      rssSum += x.rssMB; rssN++
      if (x.rssMB > peakRss) peakRss = x.rssMB
    }
  }
  return {
    avgCpu: cpuN ? Math.round((cpuSum / cpuN) * 10) / 10 : null,
    avgRss: rssN ? Math.round((rssSum / rssN) * 10) / 10 : null,
    peakRss: rssN ? peakRss : null,
    n: s.length,
  }
}

export function BenchmarkDashboard() {
  const [sessions, setSessions] = useState<Session[]>([])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const list = (await window.benchmark.list()) as Session[]
        if (!cancelled) setSessions(list)
      } catch (e) { console.error(e) }
    }
    void tick()
    const id = setInterval(tick, 2000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (sessions.length === 0) {
    return <div className="bench-empty">No benchmark sessions yet. Start one from a cell with an active PID.</div>
  }

  return (
    <div className="bench-dashboard">
      <div className="bench-row bench-header-row">
        <span>Cell</span>
        <span>PID</span>
        <span>Mode</span>
        <span>Samples</span>
        <span>Avg CPU%</span>
        <span>Avg RSS MB</span>
        <span>Peak RSS MB</span>
      </div>
      {sessions.map((s) => {
        const sum = summarize(s)
        return (
          <div key={s.cellId} className="bench-row">
            <span>{s.cellId}</span>
            <span>{s.pid}</span>
            <span className={`bench-mode bench-mode-${s.mode}`}>{s.mode}</span>
            <span>{sum.n}</span>
            <span>{sum.avgCpu ?? '—'}</span>
            <span>{sum.avgRss ?? '—'}</span>
            <span>{sum.peakRss ?? '—'}</span>
          </div>
        )
      })}
    </div>
  )
}
