// El grafo del hilo del equipo, en 3D — el mismo render que el de memorias.
//
// Lo que este panel ES: un navegador donde se ve de un vistazo qué rama está viva, de quién
// y qué tan fresca. Lo que NO es: la vía de ponerse al día — para eso está la nota, que se
// abre al hacer click. **El color por estado y frescura es el punto entero de este
// componente, no la topología.**
//
// 2026-09-11: era un SVG plano con su propia simulación de física en 2D. Dos problemas
// concretos que eso traía, los dos visibles en una captura del usuario:
//
// 1. Con el hilo recién prendido y sin notas todavía, el único nodo era `_index`, dibujado
//    como un círculo RELLENO de `--text-primary` —blanco puro, lo más fuerte de la paleta—
//    dentro de un `viewBox` fijo de 800×800. O sea: un cuadro enorme y vacío con un punto
//    blanco en el medio.
// 2. Convivía con el grafo de memorias, que es 3D, en la misma pantalla. Dos grafos con dos
//    lenguajes distintos a diez centímetros uno del otro.
//
// Ahora comparte `Graph3D` con el de memorias: mismo encuadre, mismos controles, mismo
// atenuado del vecindario. Con eso se fueron también el rAF de física 2D, el `Map` de
// posiciones y el corte por energía — el motor 3D ya hace todo eso.
import { Suspense, useMemo, useState } from 'react'
import { buildThreadGraph } from '../lib/team-thread-graph'
// DIFERIDO, no un import directo: este componente cuelga de una cadena de imports estáticos
// (MemoriesWorkspace → TeamThreadPanel → acá), así que traer `Graph3D` derecho devolvería
// 1.37 MB al chunk del arranque. Ver Graph3DLazy.tsx.
import { LazyGraph3D } from './Graph3DLazy'
// La traducción vive aparte y es pura, a propósito: desde que el grafo se dibuja en WebGL,
// el render deja de ser inspeccionable desde un test —un canvas no tiene nodos que buscar—
// así que lo verificable es esto, que además es donde están las decisiones.
import { ID_INDICE, nodosDelHilo, aristasDelHilo } from '../lib/thread-graph-3d'
import type { TeamThreadBranch } from '../types'
import { Button } from '@/components/ui/button'

interface Props {
  branches: TeamThreadBranch[]
  focus: string | null
  ahora: number
  enabled: boolean
  onToggle: (next: boolean) => void
  onOpenNote: (slug: string) => void
}

/** Arriba de esto las etiquetas se pisan entre sí. Mismo criterio que el grafo de memorias. */
const MAX_NODOS_CON_ETIQUETA = 40

export function TeamThreadGraph({ branches, focus, ahora, enabled, onToggle, onOpenNote }: Props) {
  // GLOBAL por default, a contramano de la spec §7.3 ("grafo local por default") y a
  // sabiendas. Motivo: el grafo NO lee las notas — sintetiza una estrella `_index -> rama`
  // desde el store y git en vivo, y los `[[wikilinks]]` que renderBranchNote sí escribe no se
  // usan nunca. Con esa topología "local = foco y sus vecinos" colapsa a "foco solo", y el
  // usuario abre el panel y ve UN nodo (ninguno, si su rama todavía no tiene entradas).
  //
  // DISPARADOR PARA REVERTIR: el día que el grafo lea los wikilinks de las notas en vez de
  // sintetizar la estrella, el local vuelve a tener vecinos y este default vuelve a `false`.
  const [showGlobal, setShowGlobal] = useState(true)
  const [seleccionada, setSeleccionada] = useState<string | null>(null)

  const graph = useMemo(
    () => buildThreadGraph({ branches, focus, ahora, global: showGlobal }),
    [branches, focus, ahora, showGlobal],
  )

  const nodes = useMemo(() => nodosDelHilo(graph), [graph])
  const links = useMemo(() => aristasDelHilo(graph), [graph])

  if (!enabled) {
    return (
      <div className="team-thread-empty">
        <p>Share this project&apos;s thread with your team so everyone&apos;s context arrives on its own.</p>
        <Button size="sm" onClick={() => onToggle(true)}>Turn on</Button>
      </div>
    )
  }

  // Con un solo nodo (el índice) no hay grafo que mostrar: dibujar un cuadro grande con un
  // punto solo en el medio es peor que decir que todavía no hay nada. Es la misma regla que
  // el grafo de memorias.
  const soloElIndice = graph.nodes.length <= 1

  return (
    <div className="team-thread-graph">
      {/* Botones del sistema, no <button> con reglas propias en global.css. Convivian con
          los <Button> de shadcn del grafo de memorias en la MISMA pantalla, cada juego con
          su altura, su radio y su padding — dos sistemas a diez centimetros uno del otro. */}
      <header className="team-thread-graph-header">
        <Button variant="outline" size="sm" onClick={() => setShowGlobal((v) => !v)}>
          {showGlobal ? 'Show current branch' : 'Show all branches'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onToggle(false)}>Turn off</Button>
        {graph.recortados > 0 && <span>{graph.recortados} older branches hidden</span>}
      </header>

      {soloElIndice ? (
        <p className="team-thread-graph-vacio">
          No branch notes yet — they show up here as your team works.
        </p>
      ) : (
        <div className="team-thread-graph-canvas">
          <Suspense fallback={<div className="h-full w-full" />}>
          <LazyGraph3D
            nombre="ramas"
            nodes={nodes}
            links={links}
            selectedId={seleccionada}
            onSelect={(id) => {
              setSeleccionada(id)
              // Click en una rama abre su nota, que es para lo que está el panel. El índice
              // no tiene nota: seleccionarlo sólo resalta su vecindario.
              if (id && id !== ID_INDICE) onOpenNote(id)
            }}
            showLabels={graph.nodes.length <= MAX_NODOS_CON_ETIQUETA}
          />
          </Suspense>
        </div>
      )}
    </div>
  )
}
