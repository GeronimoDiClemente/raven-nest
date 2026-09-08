// El grafo del hilo del equipo. SVG a mano, sin dependencias (spec §7.4).
//
// Lo que este panel ES: un navegador donde se ve de un vistazo que rama esta viva, de
// quien y que tan fresca. Lo que NO es: la via de ponerse al dia — para eso esta la nota,
// que se abre al hacer click (spec §7.6). El color por estado y frescura es el punto
// entero de este componente, no la topologia.
import { useMemo, useState } from 'react'
import { buildThreadGraph } from '../lib/team-thread-graph'
import type { TeamThreadBranch } from '../types'

interface Props {
  branches: TeamThreadBranch[]
  focus: string | null
  ahora: number
  enabled: boolean
  onToggle: (next: boolean) => void
  onOpenNote: (slug: string) => void
}

const COLOR_FRESCURA: Record<string, string> = {
  hoy: 'var(--accent, #22c55e)',
  semana: 'var(--accent-dim, #16a34a)',
  mes: 'var(--muted, #64748b)',
  viejo: 'var(--muted-dim, #334155)',
}

// Color y frescura son el punto entero del panel (spec §7.6) — sin estas dos, un lector de
// pantalla puede abrir las notas pero se pierde exactamente lo que el panel viene a
// aportar (review de Task 10, hallazgo 5). Van al aria-label, no solo al color/borde.
const ESTADO_LABEL: Record<string, string> = {
  activa: 'active',
  'sin-worktree': 'no local worktree',
  cerrada: 'closed',
}

const FRESCURA_LABEL: Record<string, string> = {
  hoy: 'updated today',
  semana: 'updated this week',
  mes: 'updated this month',
  viejo: 'stale',
}

export function TeamThreadGraph({ branches, focus, ahora, enabled, onToggle, onOpenNote }: Props) {
  // Local por default (constraint explicita + buildThreadGraph's doc-comment, spec §7.3):
  // arriba de cierto tamano el grafo global es ilegible, y la evidencia de esta clase de
  // vista dice que el local rinde mucho mejor. "Show all branches" pasa a global bajo
  // demanda.
  const [showGlobal, setShowGlobal] = useState(false)
  const graph = useMemo(
    () => buildThreadGraph({ branches, focus, ahora, global: showGlobal }),
    [branches, focus, ahora, showGlobal],
  )

  if (!enabled) {
    return (
      <div className="team-thread-empty">
        <p>Share this project&apos;s thread with your team so everyone&apos;s context arrives on its own.</p>
        <button type="button" onClick={() => onToggle(true)}>Turn on</button>
      </div>
    )
  }

  const openNote = (slug: string) => onOpenNote(slug)

  return (
    <div className="team-thread-graph">
      <header className="team-thread-graph-header">
        <button type="button" onClick={() => setShowGlobal((v) => !v)}>
          {showGlobal ? 'Show current branch' : 'Show all branches'}
        </button>
        <button type="button" onClick={() => onToggle(false)}>Turn off</button>
        {graph.recortados > 0 && <span>{graph.recortados} older branches hidden</span>}
      </header>

      <svg viewBox="-400 -400 800 800" role="img" aria-label="Team thread graph">
        {graph.edges.map((e) => {
          const from = graph.nodes.find((n) => n.id === e.from)
          const to = graph.nodes.find((n) => n.id === e.to)
          if (!from || !to) return null
          return <line key={`${e.from}-${e.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="var(--border, #334155)" />
        })}

        {graph.nodes.map((n) =>
          n.id === '_index' ? (
            <circle key={n.id} cx={n.x} cy={n.y} r={14} fill="var(--fg, #e2e8f0)" />
          ) : (
            <g key={n.id}>
              <circle
                cx={n.x}
                cy={n.y}
                r={n.foco ? 16 : 10}
                fill={COLOR_FRESCURA[n.frescura]}
                stroke={n.estado === 'cerrada' ? 'var(--border, #334155)' : 'none'}
                strokeDasharray={n.estado === 'sin-worktree' ? '3 3' : undefined}
                role="button"
                tabIndex={0}
                aria-label={`Open note for ${n.label} — ${ESTADO_LABEL[n.estado]}, ${FRESCURA_LABEL[n.frescura]}`}
                data-estado={n.estado}
                data-frescura={n.frescura}
                onClick={() => openNote(n.id)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    openNote(n.id)
                  }
                }}
              />
              <text x={n.x} y={n.y + 26} textAnchor="middle" fontSize={11} fill="var(--fg, #e2e8f0)">
                {n.label}
              </text>
              <text x={n.x} y={n.y + 39} textAnchor="middle" fontSize={9} fill="var(--muted, #64748b)">
                {n.autor}
              </text>
            </g>
          ),
        )}
      </svg>
    </div>
  )
}
