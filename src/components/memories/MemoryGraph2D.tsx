// El grafo de Memories en 2D, como el de Obsidian: puntos chicos, líneas finas, etiquetas que
// aparecen con el zoom y hover que deja a pleno sólo al nodo y sus vecinos. El mismo
// componente dibuja el grafo global (pestaña Graph) y el local (panel derecho).
//
// Presentación pura: no conoce `window.memory`.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphData, GraphLinkDatum, GraphNodeDatum } from '../../lib/memory-graph-visuals'
import { claveDeDibujo, conPosicionesDe, encuadreLocal, esInferida, idDe, muestraEtiqueta, opacidadDeNodo, ticksDelMotor, vecinos } from '../../lib/memory-graph-2d'
import type { EtiquetasDelGrafo } from '../../lib/memory-prefs'

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
  /** «Labels» (sólo global). */
  etiquetas?: EtiquetasDelGrafo
  /** «Animate graph» (sólo global). */
  animar?: boolean
  onOpen: (syncId: string, opts: { background: boolean }) => void
}

type Nodo = GraphNodeDatum & { x?: number; y?: number; fx?: number; fy?: number }

function token(nombre: string, porDefecto: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()
  return v || porDefecto
}

/**
 * El color de un token con otra opacidad, para el canvas (que no entiende `var(--x)`). Sólo
 * sabe de `#rgb`, `#rrggbb` y `rgb()/rgba()`; cualquier otra forma vuelve tal cual (sin alfa
 * es más visible, nunca invisible).
 */
function conAlfa(color: string, alfa: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
    return `rgba(${r}, ${g}, ${b}, ${alfa})`
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color)
  if (rgb) {
    const partes = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3)
    if (partes.length === 3) return `rgba(${partes.join(', ')}, ${alfa})`
  }
  return color
}

/** El tamaño del punto en px de PANTALLA a zoom 1. Crece poco con el grado (spec §4). */
function tamanoBase(n: Nodo, escalaDeNodo: number): number {
  return (2 + Math.sqrt(n.degree + 1) * 0.9) * escalaDeNodo
}

/**
 * Radio en unidades del grafo (lo que espera el canvas) para el zoom `escala`.
 *
 * Global: en pantalla crece con la raíz del zoom — acercarse agranda los puntos, como en
 * Obsidian, pero no al mismo ritmo que las distancias, así que no se vuelven bolas. Local: fijo
 * en pantalla, porque ahí el zoom lo decide el encuadre de unos pocos nodos y no la persona.
 */
function radioDe(n: Nodo, escalaDeNodo: number, escala: number, modo: 'global' | 'local'): number {
  const base = tamanoBase(n, escalaDeNodo)
  return modo === 'local' ? base / escala : base / Math.sqrt(escala)
}

type InstanciaDelGrafo = {
  d3Force: (n: string) => { distance?: (d: number) => void; strength?: (s: number) => void } | undefined
  d3ReheatSimulation?: () => void
  zoomToFit?: (ms?: number, padding?: number) => void
  zoom?: (k?: number, ms?: number) => number | void
  centerAt?: (x?: number, y?: number, ms?: number) => unknown
}

/** Encuadrar un grafo de uno o dos nodos daría un zoom enorme: tope. */
const TOPE_DE_ZOOM_AL_ENCUADRAR = { global: 4, local: 3 }
const MAX_LETRAS = { global: 40, local: 24 }
/** Margen del encuadre local, en px de pantalla: media etiqueta a los costados, el punto
 *  arriba, punto + etiqueta abajo. */
const MARGEN_LOCAL = { x: 64, arriba: 12, abajo: 28 }

export default function MemoryGraph2D({ data, foco = null, resaltados = null, modo, escalaDeNodo = 1, distanciaDeLinks = 50, etiquetas = 'zoom', animar = true, onOpen }: MemoryGraph2DProps) {
  const caja = useRef<HTMLDivElement>(null)
  const [tam, setTam] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    const el = caja.current
    if (!el) return
    // Lectura inicial: en jsdom da 0 y el stub de ResizeObserver no dispara; con `|| 1` monta igual.
    setTam({ w: el.clientWidth || 1, h: el.clientHeight || 1 })
    // Con la columna colapsada (o la pestaña oculta) el tamaño pasa a 0: se queda el último
    // que no lo era, en vez de desmontar el grafo y perder su acomodo.
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      if (width > 0 && height > 0) setTam({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /**
   * Lo que recibe la librería. Si lo que se dibuja no cambió (el eco de un autoguardado trae el
   * mismo grafo en objetos nuevos), se le pasa EL MISMO objeto y la simulación no se recalienta;
   * si cambió, copias con las posiciones de antes (final review F6).
   */
  const previa = useRef<{ clave: string; data: GraphData } | null>(null)
  const datos = useMemo(() => {
    const clave = claveDeDibujo(data)
    if (previa.current?.clave === clave) return previa.current.data
    const d = conPosicionesDe(previa.current?.data ?? null, data)
    previa.current = { clave, data: d }
    return d
  }, [data])
  // Sin acomodo previo (la primera vez, o casi todos los nodos nuevos), la simulación corre
  // unos ticks antes de dibujar: así el primer cuadro no es una nube que se desarma.
  const sinAcomodo = useMemo(() => {
    const conPos = datos.nodes.filter((n) => typeof (n as Nodo).x === 'number').length
    return conPos < datos.nodes.length / 2
  }, [datos])
  const ticks = ticksDelMotor({ modo, sinAcomodo, animar })

  const instancia = useRef<InstanciaDelGrafo | null>(null)
  // Ref callback: el grafo es lazy y espera el tamaño, así que la instancia llega después del
  // montaje. Al cambiar `distanciaDeLinks` cambia la identidad del callback y React lo vuelve a
  // llamar con la instancia viva: se aplica la distancia (también la inicial) y se recalienta.
  const refDelGrafo = useCallback((g: InstanciaDelGrafo | null) => {
    instancia.current = g
    if (!g) return
    g.d3Force('link')?.distance?.(distanciaDeLinks)
    // La carga por defecto de d3 (-30) con links de 50 deja todo apiñado.
    g.d3Force('charge')?.strength?.(modo === 'local' ? -80 : -120)
    g.d3ReheatSimulation?.()
  }, [distanciaDeLinks, modo])

  /** La persona hizo zoom o arrastró: el encuadre automático ya no le mueve la vista. */
  const usuarioMovio = useRef(false)
  const arrastre = useRef<{ x: number; y: number } | null>(null)
  const encuadradoPara = useRef<GraphData | null>(null)
  /** El zoom al que quedó el último encuadre: las etiquetas se miden contra él. */
  const zoomDeEncuadre = useRef<number | null>(null)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current) }, [])

  /**
   * Encuadre propio del local: margen para las etiquetas, que van debajo del punto y se
   * cortaban contra los bordes de una caja de ~280 × 180 px con el margen parejo de
   * `zoomToFit`.
   */
  const encuadrarLocal = (g: InstanciaDelGrafo, ms: number) => {
    const e = encuadreLocal(datos.nodes as Nodo[], tam.w, tam.h, MARGEN_LOCAL, TOPE_DE_ZOOM_AL_ENCUADRAR.local)
    if (!e || !g.centerAt) return
    g.centerAt(e.x, e.y, ms)
    g.zoom?.(e.k, ms)
    zoomDeEncuadre.current = e.k
  }
  /** El local se encuadra ya en el primer tick (después del warmup las posiciones están casi
   *  quietas), y de nuevo, suave, cuando la simulación se detiene. */
  const encuadreInicialPara = useRef<GraphData | null>(null)
  const alAvanzar = () => {
    if (modo !== 'local' || encuadreInicialPara.current === datos) return
    const g = instancia.current
    if (!g) return
    encuadreInicialPara.current = datos
    encuadrarLocal(g, 0)
  }

  const alDetenerse = () => {
    const g = instancia.current
    if (!g?.zoomToFit || encuadradoPara.current === datos) return
    if (modo === 'global' && usuarioMovio.current) return
    encuadradoPara.current = datos
    const ms = 400
    if (modo === 'local') { encuadrarLocal(g, ms); return }
    g.zoomToFit(ms, 48)
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => {
      const k = g.zoom?.()
      if (typeof k !== 'number') return
      const tope = TOPE_DE_ZOOM_AL_ENCUADRAR[modo]
      if (k > tope) g.zoom?.(tope, 200)
      zoomDeEncuadre.current = Math.min(k, tope)
    }, ms + 20)
  }

  const vecinosDelHover = useMemo(() => (hover ? vecinos(datos.links, hover) : new Set<string>()), [hover, datos.links])
  const colores = useMemo(() => {
    const tenue = token('--muted-foreground', '#9b9b9b')
    return {
      texto: tenue,
      textoFuerte: token('--foreground', '#f0f0f0'),
      // Más claras que `--border` (casi invisible sobre el fondo) pero lejos del texto.
      linea: conAlfa(tenue, 0.5),
      lineaInferida: conAlfa(tenue, 0.35),
      lineaVecina: conAlfa(token('--foreground', '#f0f0f0'), 0.75),
      lineaAtenuada: conAlfa(tenue, 0.07),
      fuente: token('--font-ui', 'system-ui, sans-serif'),
    }
  }, [])

  const tocaAlHover = (l: GraphLinkDatum) => idDe(l.source) === hover || idDe(l.target) === hover

  return (
    <div
      ref={caja}
      className="relative h-full w-full"
      aria-label={modo === 'global' ? 'Memory graph' : 'Local graph'}
      role="group"
      onWheelCapture={() => { if (modo === 'global') usuarioMovio.current = true }}
      onPointerDownCapture={(e) => { arrastre.current = { x: e.clientX, y: e.clientY } }}
      onPointerMoveCapture={(e) => {
        const a = arrastre.current
        if (modo === 'global' && a && e.buttons && Math.hypot(e.clientX - a.x, e.clientY - a.y) > 4) usuarioMovio.current = true
      }}
      onPointerUpCapture={() => { arrastre.current = null }}
    >
      <Suspense fallback={null}>
        {tam.w > 0 && (
          <ForceGraph2D
            ref={refDelGrafo as never}
            width={tam.w}
            height={tam.h}
            graphData={datos}
            backgroundColor="transparent"
            warmupTicks={ticks.warmupTicks}
            cooldownTicks={ticks.cooldownTicks}
            d3VelocityDecay={modo === 'local' ? 0.6 : 0.35}
            enableZoomInteraction={modo === 'global'}
            enablePanInteraction={modo === 'global'}
            onEngineStop={alDetenerse}
            onEngineTick={alAvanzar}
            onNodeHover={(n) => setHover(n ? (n as Nodo).id : null)}
            onNodeClick={(n, e) => {
              if ((n as Nodo).pending) return
              onOpen((n as Nodo).id, { background: e.ctrlKey || e.metaKey })
            }}
            onNodeDragEnd={(n) => { n.fx = n.x; n.fy = n.y }}
            // Hover (spec §4): las aristas del nodo a pleno y las demás atenuadas, no ocultas.
            linkColor={(raw) => {
              const l = raw as GraphLinkDatum
              if (hover) return tocaAlHover(l) ? colores.lineaVecina : colores.lineaAtenuada
              return esInferida(l.kind) ? colores.lineaInferida : colores.linea
            }}
            linkWidth={(l) => (esInferida((l as GraphLinkDatum).kind) ? 0.6 : 1)}
            linkLineDash={(l) => (esInferida((l as GraphLinkDatum).kind) ? [2, 3] : null)}
            nodeCanvasObject={(raw, ctx, escala) => {
              const n = raw as Nodo
              const r = radioDe(n, escalaDeNodo, escala, modo)
              ctx.globalAlpha = opacidadDeNodo(n.id, hover, vecinosDelHover, resaltados)
              ctx.beginPath()
              ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI)
              if (n.pending) { ctx.strokeStyle = colores.texto; ctx.lineWidth = 1 / escala; ctx.stroke() }
              else { ctx.fillStyle = n.color; ctx.fill() }
              if (n.id === foco || n.id === hover) {
                ctx.strokeStyle = colores.textoFuerte; ctx.lineWidth = 1.5 / escala; ctx.stroke()
              }
              const conEtiqueta = muestraEtiqueta({
                modo, etiquetas, escala, zoomDeEncuadre: zoomDeEncuadre.current, destacado: n.id === hover || n.id === foco,
              })
              if (conEtiqueta) {
                const fs = 11 / escala
                const max = MAX_LETRAS[modo]
                ctx.font = `${fs}px ${colores.fuente}`
                ctx.textAlign = 'center'
                ctx.textBaseline = 'top'
                ctx.fillStyle = n.id === hover || n.id === foco ? colores.textoFuerte : colores.texto
                ctx.fillText(n.label.length > max ? `${n.label.slice(0, max - 1)}…` : n.label, n.x ?? 0, (n.y ?? 0) + r + 2 / escala)
              }
              ctx.globalAlpha = 1
            }}
            nodePointerAreaPaint={(raw, color, ctx, escala) => {
              const n = raw as Nodo
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(n.x ?? 0, n.y ?? 0, Math.max(radioDe(n, escalaDeNodo, escala, modo), 6 / escala), 0, 2 * Math.PI)
              ctx.fill()
            }}
          />
        )}
      </Suspense>
    </div>
  )
}
