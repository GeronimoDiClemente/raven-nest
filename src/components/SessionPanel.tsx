import { useState } from 'react'

interface Props {
  docked?: boolean
}

// NOTE: Representative session data for the design pass. CPU/mem/ports/worktrees
// and MCP server lists are already tracked in the app (window.metrics / MCP hooks)
// and will be wired in here next; token throughput + cost need new instrumentation
// (counting tokens per AI pane), which is a scoped follow-up.
const METRICS = [
  { label: 'TOKENS · 1H', value: '184.2', unit: 'k', delta: '▲ 22%', tone: 'up' },
  { label: 'PEAK', value: '3.1', unit: 'k/s', delta: '12:03', tone: 'flat' },
  { label: 'PANES', value: '4', unit: '', delta: 'Claude · Gemini', tone: 'flat' },
  { label: 'COST · 1H', value: '$2.41', unit: '', delta: '▲ opus', tone: 'warn' },
] as const

// sparkline heights (0–100) — throughput over the last few minutes
const SPARK = [30, 52, 41, 70, 58, 88, 64, 95, 72, 50, 80, 66, 92, 74]

const MCP = [
  { name: 'filesystem', scope: 'project', latency: '18ms', status: 'ok' },
  { name: 'github', scope: 'global', latency: '142ms', status: 'ok' },
  { name: 'postgres', scope: 'project', latency: '34ms', status: 'ok' },
  { name: 'puppeteer', scope: 'global', latency: '612ms', status: 'slow' },
  { name: 'playwright', scope: 'project', latency: '—', status: 'idle' },
] as const

const WORKTREES = [
  { name: 'feat/auth-rewrite', ahead: '↑2 ↓0', diff: '+42 −12', state: 'active' },
  { name: 'main', ahead: '↑0 ↓0', diff: 'clean', state: 'clean' },
  { name: 'fix/rate-limit', ahead: '↑2 ↓1', diff: '+8', state: 'behind' },
  { name: 'spike/edge-cache', ahead: '↑0 ↓4', diff: 'stash·2', state: 'stashed' },
] as const

const CAST = [
  { pane: 'Claude', model: 'opus', state: 'delivered' },
  { pane: 'Gemini', model: '2.0-pro', state: 'delivered' },
  { pane: 'zsh', model: 'shell', state: 'skipped' },
] as const

type Tab = 'mcp' | 'git' | 'cast'

export default function SessionPanel({ docked }: Props) {
  const [tab, setTab] = useState<Tab>('mcp')

  const body = (
    <>
      <div className="session-head">
        <span className="session-title">Session</span>
        <span className="session-live"><span className="session-live-dot" />live</span>
        <span className="session-uptime">1h 04m</span>
      </div>

      <div className="session-metrics">
        {METRICS.map((m) => (
          <div key={m.label} className="session-metric">
            <div className="session-metric-label">{m.label}</div>
            <div className="session-metric-value">{m.value}<small>{m.unit}</small></div>
            <div className={`session-metric-delta ${m.tone}`}>{m.delta}</div>
          </div>
        ))}
      </div>

      <div className="session-spark-head">THROUGHPUT · tok/s</div>
      <div className="session-spark">
        {SPARK.map((h, i) => (
          <i key={i} style={{ height: `${h}%` }} />
        ))}
      </div>

      <div className="session-tabs">
        <button className={`session-tab${tab === 'mcp' ? ' active' : ''}`} onClick={() => setTab('mcp')}>MCP · 5</button>
        <button className={`session-tab${tab === 'git' ? ' active' : ''}`} onClick={() => setTab('git')}>Worktrees · 4</button>
        <button className={`session-tab${tab === 'cast' ? ' active' : ''}`} onClick={() => setTab('cast')}>Broadcast</button>
      </div>

      <div className="session-list">
        {tab === 'mcp' && MCP.map((s) => (
          <div key={s.name} className="session-row">
            <span className={`session-pip ${s.status}`} />
            <span className="session-row-name">{s.name}</span>
            <span className="session-row-meta">{s.scope}</span>
            <span className="session-row-val">{s.latency}</span>
          </div>
        ))}
        {tab === 'git' && WORKTREES.map((w) => (
          <div key={w.name} className="session-row">
            <span className={`session-pip ${w.state === 'active' ? 'ok' : w.state === 'behind' ? 'slow' : 'idle'}`} />
            <span className="session-row-name">{w.name}</span>
            <span className="session-row-meta">{w.ahead}</span>
            <span className="session-row-val">{w.diff}</span>
          </div>
        ))}
        {tab === 'cast' && CAST.map((c) => (
          <div key={c.pane} className="session-row">
            <span className={`session-pip ${c.state === 'delivered' ? 'ok' : 'idle'}`} />
            <span className="session-row-name">{c.pane}</span>
            <span className="session-row-meta">{c.model}</span>
            <span className="session-row-val">{c.state}</span>
          </div>
        ))}
      </div>
    </>
  )

  if (docked) {
    return <div className="session-panel session-panel--docked">{body}</div>
  }
  return <div className="session-panel">{body}</div>
}
