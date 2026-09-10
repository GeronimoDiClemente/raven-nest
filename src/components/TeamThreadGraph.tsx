// El grafo del hilo del equipo. SVG a mano, sin dependencias (spec §7.4).
//
// Lo que este panel ES: un navegador donde se ve de un vistazo que rama esta viva, de
// quien y que tan fresca. Lo que NO es: la via de ponerse al dia — para eso esta la nota,
// que se abre al hacer click (spec §7.6). El color por estado y frescura es el punto
// entero de este componente, no la topologia.
//
// La posicion de cada nodo viene de una simulacion de fisica (force-layout.ts, spec
// §5.1: repulsion + resortes, como Obsidian), NO de las coordenadas precalculadas de
// buildThreadGraph — esas solo sirven de semilla determinística para el primer frame.
// graph.nodes sigue siendo la fuente de la metadata (label, estado, frescura, autor,
// foco): la topologia de force-layout no sabe nada de eso, ForceNode es solo {id,x,y,vx,vy}.
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildThreadGraph } from '../lib/team-thread-graph'
import { stepForceLayout, energiaTotal, type ForceNode, type ForceEdge } from '../lib/force-layout'
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

/** Umbral de energía cinética media bajo el cual se considera que el layout se
 *  asentó y se corta el rAF — un loop que corre para siempre mantiene la GPU
 *  despierta y le come batería a una app que la gente deja abierta todo el día. */
const ENERGIA_REPOSO = 0.05

/** Ticks que se corren de una (sin rAF) cuando prefers-reduced-motion está activo,
 *  para llegar a un layout asentado sin animar nada. */
const TICKS_SIN_ANIMAR = 300

// Los defaults de force-layout.ts (largo=90, repulsion=3000) dejan el equilibrio
// demasiado apretado para este grafo en particular: medido, dos ramas activas
// conectadas solo al índice (nunca entre sí) convergen con apenas ~100-102 unidades
// de separación — del mismo orden que el ancho de dos etiquetas de rama largas a
// font-size 11 (~72-122 unidades cada una, medido con getBBox sobre nombres reales
// como "smoke/memory-bridge" o "feat/graph-orchestration"), así que las etiquetas
// llegan a tocarse. Con largo=260/repulsion=12000 el peor caso medido (un anillo
// lleno de 12 ramas, el máximo por anillo de buildThreadGraph) da ~147 unidades de
// separación mínima y un radio máximo de ~284 — separa las etiquetas largas con
// margen y sigue entrando en el viewBox de 800×800 (-400..400) sumando el overhang
// de una etiqueta (~60u). Con menos ramas el margen es mayor (p.ej. 7 ramas: ~220u).
//
// Grafos con más de un anillo (>12 ramas visibles) no se cubrieron en esta medición:
// buildThreadGraph ya multiplica el radio de semilla por anillo (RADIO_ANILLO * n),
// así que un grafo de varios anillos puede salirse del viewBox incluso con el layout
// ESTÁTICO original, antes de esta tarea — no es una regresión de la física, pero
// si el spec-cap de ~200 nodos se ejercita de verdad conviene revisar viewBox/fuerza
// al origen en esa instancia, no asumir que estos valores siguen alcanzando.
const GRAPH_FORCE_OPTS = { largo: 260, repulsion: 12000 }

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

  // Estado de la simulación: id -> posición/velocidad. Vive en un ref (no en React
  // state) porque un tick de física corre hasta 60 veces por segundo y no queremos
  // pasar por el reconciler en cada uno; `tick` de abajo es lo que dispara el re-render
  // que efectivamente pinta el frame nuevo.
  const simRef = useRef<Map<string, ForceNode> | null>(null)
  // Init perezosa: `useRef(new Map())` crea y tira un Map en cada render (siempre se
  // descarta salvo el primero). `getSim()` centraliza el chequeo-y-asigna y le devuelve
  // a cada lector un tipo no-nulleable, sin repetir el `!` en cada acceso.
  const getSim = () => {
    if (simRef.current === null) simRef.current = new Map()
    return simRef.current
  }
  const [, setTick] = useState(0)

  // Firma estable del set de nodos/aristas actual. El componente tiene un toggle
  // ("Show all branches" / "Show current branch") que cambia qué ramas entran al
  // grafo — el set de nodos NO es fijo — así que hay que resembrar cuando aparecen
  // nodos nuevos y no romper nada cuando desaparecen.
  const nodeIdsKey = graph.nodes.map((n) => n.id).join('|')
  const edgeKey = graph.edges.map((e) => `${e.from}>${e.to}`).join('|')

  // Resiembra la simulación cuando cambia el set de nodos: los que ya estaban
  // conservan su posición/velocidad (para que la animación no salte), los nuevos
  // arrancan del layout precalculado de buildThreadGraph (determinístico, así el
  // primer frame ya se ve razonable en vez de un desparramo aleatorio), y los que
  // desaparecieron simplemente se sueltan.
  useEffect(() => {
    const sim = getSim()
    const vivos = new Set(graph.nodes.map((n) => n.id))
    for (const id of sim.keys()) {
      if (!vivos.has(id)) sim.delete(id)
    }
    for (const n of graph.nodes) {
      if (!sim.has(n.id)) {
        sim.set(n.id, { id: n.id, x: n.x, y: n.y, vx: 0, vy: 0 })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIdsKey])

  // El loop de física en sí. Se frena solo (criterio de energía) y se cancela al
  // desmontar — el overlay de Memories se cierra y se vuelve a abrir, y un rAF
  // huérfano quedaría corriendo de fondo.
  useEffect(() => {
    const edges: ForceEdge[] = graph.edges

    // matchMedia no existe en jsdom (los 7 tests estructurales de este componente
    // corren sin polyfill), y en Electron siempre está presente — por eso el guard
    // en vez del `window.matchMedia(...)` a secas del brief. Fallback: animar.
    const quieto = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (quieto) {
      // Sin animar: se corren los ticks de una y se pinta el resultado ya asentado.
      const nodes = Array.from(getSim().values())
      for (let i = 0; i < TICKS_SIN_ANIMAR; i++) stepForceLayout(nodes, edges, GRAPH_FORCE_OPTS)
      setTick((t) => t + 1)
      return
    }

    let raf = 0
    const loop = () => {
      const nodes = Array.from(getSim().values())
      stepForceLayout(nodes, edges, GRAPH_FORCE_OPTS)
      setTick((t) => t + 1)
      if (energiaTotal(nodes) < ENERGIA_REPOSO) return
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nodeIdsKey/edgeKey ya
    // describen la topología completa (ids + aristas). `graph` cambia de referencia en
    // cada render de TeamThreadPanel (pasa `ahora={Date.now()}` inline), así que declarar
    // `graph.edges` acá reactivaba el loop en cualquier re-render ajeno a la topología —
    // justo lo que el corte por energía existía para evitar (review de Task 9, Important 1).
  }, [nodeIdsKey, edgeKey])

  if (!enabled) {
    return (
      <div className="team-thread-empty">
        <p>Share this project&apos;s thread with your team so everyone&apos;s context arrives on its own.</p>
        <button type="button" onClick={() => onToggle(true)}>Turn on</button>
      </div>
    )
  }

  const openNote = (slug: string) => onOpenNote(slug)

  const posDe = (id: string, fallbackX: number, fallbackY: number) => {
    const p = getSim().get(id)
    return p ? { x: p.x, y: p.y } : { x: fallbackX, y: fallbackY }
  }

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
          const pf = posDe(from.id, from.x, from.y)
          const pt = posDe(to.id, to.x, to.y)
          return <line key={`${e.from}-${e.to}`} x1={pf.x} y1={pf.y} x2={pt.x} y2={pt.y} stroke="var(--border)" />
        })}

        {graph.nodes.map((n) => {
          const p = posDe(n.id, n.x, n.y)
          return n.id === '_index' ? (
            <circle key={n.id} cx={p.x} cy={p.y} r={14} fill="var(--text-primary)" />
          ) : (
            <g key={n.id}>
              <circle
                cx={p.x}
                cy={p.y}
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
              <text x={p.x} y={p.y + 26} textAnchor="middle" fontSize={11} fill="var(--text-primary)">
                {n.label}
              </text>
              <text x={p.x} y={p.y + 39} textAnchor="middle" fontSize={9} fill="var(--text-secondary)">
                {n.autor}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
