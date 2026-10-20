// El grafo de Memories en 2D, como el de Obsidian: puntos chicos, líneas finas, etiquetas que
// aparecen con el zoom y hover que deja a pleno sólo al nodo y sus vecinos. El mismo
// componente dibuja el grafo global (pestaña Graph) y el local (panel derecho).
//
// Presentación pura: no conoce `window.memory`.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphData, GraphLinkDatum, GraphNodeDatum } from '../../lib/memory-graph-visuals'
import { esInferida, idDe, opacidadDeNodo, vecinos } from '../../lib/memory-graph-2d'

const ForceGraph2D = lazy(() => import('react-force-graph-2d'))

export interface MemoryGraph2DProps {
  data: GraphData
  /** Nodo resaltado al centro (grafo local) o seleccionado (global). */
  foco?: string | null
  /** Ids que coinciden con la búsqueda; el resto se atenúa. null = sin búsqueda. */
  resaltados?: ReadonlySet<string> | null
  /** 'local' = etiquetas siempre, física lenta, sin zoom. */
  modo: 'global' | 'local'
  escalaDeNodo?: number
  distanciaDeLinks?: number
  onOpen: (syncId: string, opts: { background: boolean }) => void
}

type Nodo = GraphNodeDatum & { x?: number; y?: number; fx?: number; fy?: number }

function token(nombre: string, porDefecto: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()
  return v || porDefecto
}

/** Radio del punto: el mismo para dibujarlo y para el área de click. */
function radioDe(n: Nodo, escalaDeNodo: number): number {
  return (2.5 + Math.sqrt(n.degree + 1) * 1.6) * escalaDeNodo
}

type InstanciaDelGrafo = {
  d3Force: (n: string) => { distance?: (d: number) => void } | undefined
  d3ReheatSimulation?: () => void
}

/** Umbral de zoom a partir del cual el grafo global muestra todas las etiquetas. */
const ZOOM_DE_ETIQUETAS = 1.6

export default function MemoryGraph2D({ data, foco = null, resaltados = null, modo, escalaDeNodo = 1, distanciaDeLinks = 50, onOpen }: MemoryGraph2DProps) {
  const caja = useRef<HTMLDivElement>(null)
  const [tam, setTam] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    const el = caja.current
    if (!el) return
    // Lectura inicial: en jsdom da 0 y el stub de ResizeObserver no dispara; con `|| 1` monta igual.
    setTam({ w: el.clientWidth || 1, h: el.clientHeight || 1 })
    const ro = new ResizeObserver(([e]) => setTam({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Ref callback: el grafo es lazy y espera el tamaño, así que la instancia llega después del
  // montaje. Al cambiar `distanciaDeLinks` cambia la identidad del callback y React lo vuelve a
  // llamar con la instancia viva: se aplica la distancia (también la inicial) y se recalienta.
  const refDelGrafo = useCallback((g: InstanciaDelGrafo | null) => {
    if (!g) return
    g.d3Force('link')?.distance?.(distanciaDeLinks)
    g.d3ReheatSimulation?.()
  }, [distanciaDeLinks])

  const vecinosDelHover = useMemo(() => (hover ? vecinos(data.links, hover) : new Set<string>()), [hover, data.links])
  const colores = useMemo(() => ({
    texto: token('--muted-foreground', '#a3a3a3'),
    textoFuerte: token('--foreground', '#f0f0f0'),
    linea: token('--border', '#3a3a3a'),
  }), [])

  return (
    <div ref={caja} className="relative h-full w-full" aria-label={modo === 'global' ? 'Memory graph' : 'Local graph'} role="group">
      <Suspense fallback={null}>
        {tam.w > 0 && (
          <ForceGraph2D
            ref={refDelGrafo as never}
            width={tam.w}
            height={tam.h}
            graphData={data}
            backgroundColor="transparent"
            cooldownTicks={modo === 'local' ? 60 : 200}
            d3VelocityDecay={modo === 'local' ? 0.6 : 0.35}
            enableZoomInteraction={modo === 'global'}
            enablePanInteraction={modo === 'global'}
            onNodeHover={(n) => setHover(n ? (n as Nodo).id : null)}
            onNodeClick={(n, e) => {
              if ((n as Nodo).pending) return
              onOpen((n as Nodo).id, { background: e.ctrlKey || e.metaKey })
            }}
            onNodeDragEnd={(n) => { n.fx = n.x; n.fy = n.y }}
            linkColor={() => colores.linea}
            linkWidth={(l) => (esInferida((l as GraphLinkDatum).kind) ? 0.6 : 1.2)}
            linkLineDash={(l) => (esInferida((l as GraphLinkDatum).kind) ? [2, 3] : null)}
            linkVisibility={(l) => {
              if (!hover) return true
              return idDe(l.source) === hover || idDe(l.target) === hover
            }}
            nodeCanvasObject={(raw, ctx, escala) => {
              const n = raw as Nodo
              const r = radioDe(n, escalaDeNodo)
              ctx.globalAlpha = opacidadDeNodo(n.id, hover, vecinosDelHover, resaltados)
              ctx.beginPath()
              ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI)
              if (n.pending) { ctx.strokeStyle = colores.texto; ctx.lineWidth = 1 / escala; ctx.stroke() }
              else { ctx.fillStyle = n.color; ctx.fill() }
              if (n.id === foco || n.id === hover) {
                ctx.strokeStyle = colores.textoFuerte; ctx.lineWidth = 1.5 / escala; ctx.stroke()
              }
              const conEtiqueta = modo === 'local' || escala >= ZOOM_DE_ETIQUETAS || n.id === hover || n.id === foco
              if (conEtiqueta) {
                const fs = 11 / escala
                ctx.font = `${fs}px Inter, system-ui, sans-serif`
                ctx.textAlign = 'center'
                ctx.textBaseline = 'top'
                ctx.fillStyle = n.id === hover || n.id === foco ? colores.textoFuerte : colores.texto
                ctx.fillText(n.label.length > 40 ? `${n.label.slice(0, 39)}…` : n.label, n.x ?? 0, (n.y ?? 0) + r + 2 / escala)
              }
              ctx.globalAlpha = 1
            }}
            nodePointerAreaPaint={(raw, color, ctx) => {
              const n = raw as Nodo
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(n.x ?? 0, n.y ?? 0, Math.max(radioDe(n, escalaDeNodo), 6), 0, 2 * Math.PI)
              ctx.fill()
            }}
          />
        )}
      </Suspense>
    </div>
  )
}
