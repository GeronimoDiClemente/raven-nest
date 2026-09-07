import { useEffect, useState } from 'react'
import type { GcalEventDTO } from '../types'

// H6 Motor 4 (entrada) — "Block → Session". Lista los bloques de HOY del calendario
// y ofrece "Start session" por bloque: crea un worktree e inyecta el título/descr
// del evento como prompt inicial del agente. JAMÁS automático — siempre requiere el
// click (spec madre). UI deliberadamente mínima (lista simple, clases del shell).
interface CalendarPanelProps {
  /** Crea el worktree, escribe el spec del bloque y abre la sesión (block→session). */
  onStartSession: (title: string, context: string) => void
  /** Deshabilita los botones mientras una sesión se está creando. */
  busy?: boolean
}

function dayBounds(): { start: string; end: string } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

function eventTimeLabel(ev: GcalEventDTO): string {
  const dt = ev.start?.dateTime
  if (!dt) return 'All day'
  return new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function CalendarPanel({ onStartSession, busy }: CalendarPanelProps) {
  const [events, setEvents] = useState<GcalEventDTO[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const { start, end } = dayBounds()
    setLoading(true)
    // main degrada a [] ante cualquier error (sin conexión / API), así que un
    // catch acá es redundante pero mantiene el panel vivo si el bridge falla.
    window.gcal.listEvents(start, end)
      .then((evs) => { if (alive) setEvents(evs) })
      .catch(() => { if (alive) setEvents([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  if (loading) return <p className="snippet-empty">Loading…</p>

  if (events.length === 0) {
    return (
      <div className="tw-placeholder">
        <p className="tw-placeholder-title">No blocks today</p>
        <p className="tw-placeholder-text">
          Connect Google Calendar to see today’s blocks, then start a session from one with a single click.
        </p>
      </div>
    )
  }

  return (
    <div className="snippet-list" style={{ maxHeight: 'none' }}>
      {events.map((ev) => (
        <div key={ev.id} className="snippet-item">
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="snippet-name">{ev.summary ?? 'Untitled'}</span>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{eventTimeLabel(ev)}</div>
          </div>
          <button
            className="repo-action-btn subtle-accent"
            disabled={busy}
            onClick={() => onStartSession(ev.summary ?? 'Untitled', ev.description ?? '')}
            title="Create a worktree and start a session from this block"
          >
            Start session
          </button>
        </div>
      ))}
    </div>
  )
}
