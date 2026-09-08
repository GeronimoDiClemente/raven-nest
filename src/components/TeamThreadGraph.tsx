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

// Los tokens los define `.team-thread-graph` en global.css. NO se usan --accent/--muted:
// en el tema de Nest esos dos existen y valen #111111 (shadcn los usa como SUPERFICIE, no
// como matiz), asi que el fallback del `var(x, y)` nunca entraba y los nodos salian negro
// sobre negro — el color por frescura es el punto entero de este panel.
const COLOR_FRESCURA: Record<string, string> = {
  hoy: 'var(--tt-fresh-hoy)',
  semana: 'var(--tt-fresh-semana)',
  mes: 'var(--tt-fresh-mes)',
  viejo: 'var(--tt-fresh-viejo)',
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
  // GLOBAL por default, a contramano de la spec §7.3 ("grafo local por default") y a
  // sabiendas. Motivo (I5 de la review final de rama): el grafo NO lee las notas — sintetiza
  // una estrella `_index -> rama` desde el store y git en vivo (team-thread-index-query.ts +
  // buildThreadGraph), y los `[[wikilinks]]` que renderBranchNote si escribe no se usan
  // nunca. Con esa topologia "local = foco y sus vecinos" colapsa a "foco solo", y el
  // usuario abre el panel y ve UN nodo (ninguno, si su rama todavia no tiene entradas).
  //
  // DISPARADOR PARA REVERTIR: el dia que el grafo lea los wikilinks de las notas en vez de
  // sintetizar la estrella, el local vuelve a tener vecinos y este default vuelve a `false`.
  const [showGlobal, setShowGlobal] = useState(true)
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
          return <line key={`${e.from}-${e.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="var(--border)" />
        })}

        {graph.nodes.map((n) =>
          n.id === '_index' ? (
            <circle key={n.id} cx={n.x} cy={n.y} r={14} fill="var(--text-primary)" />
          ) : (
            <g key={n.id}>
              <circle
                cx={n.x}
                cy={n.y}
                r={n.foco ? 16 : 10}
                fill={COLOR_FRESCURA[n.frescura]}
                stroke={n.estado === 'cerrada' ? 'var(--text-muted)' : 'none'}
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
              <text x={n.x} y={n.y + 26} textAnchor="middle" fontSize={11} fill="var(--text-primary)">
                {n.label}
              </text>
              <text x={n.x} y={n.y + 39} textAnchor="middle" fontSize={9} fill="var(--text-secondary)">
                {n.autor}
              </text>
            </g>
          ),
        )}
      </svg>
    </div>
  )
}
