// El grafo de Memories en 2D, como el de Obsidian: líneas finas, etiquetas horizontales que
// aparecen con el zoom, nodos que se arrastran y vuelven a la física al soltarlos, y hover que
// deja a pleno sólo al nodo y sus vecinos. Los nodos son esferas con luz y sombra (el estilo B
// que eligió Gero el 2026-11-12 entre cuatro prototipos). El mismo componente dibuja el grafo
// global (pestaña Graph) y el local (panel derecho).
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
  const c = rgbDe(color)
  return c ? `rgba(${c.join(', ')}, ${alfa})` : color
}

/** `#rgb`, `#rrggbb` o `rgb()/rgba()` a sus tres canales; null para cualquier otra forma. */
function rgbDe(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
    return [r, g, b]
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color)
  if (rgb) {
    const partes = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number)
    if (partes.length === 3 && partes.every((p) => Number.isFinite(p))) return partes as [number, number, number]
  }
  return null
}

/** El color llevado hacia blanco (`k > 0`) o hacia negro (`k < 0`): la luz y la sombra de la esfera. */
function tono(c: [number, number, number], k: number, alfa = 1): string {
  const v = c.map((x) => Math.round(k >= 0 ? x + (255 - x) * k : x * (1 + k)))
  return `rgba(${v.join(', ')}, ${alfa})`
}

/** Debajo de este radio en pantalla el volumen no se distingue: se pinta plano, que es más barato. */
const RADIO_MINIMO_CON_VOLUMEN = 3

/**
 * Una esfera iluminada desde arriba a la izquierda: sombra en el piso, degradé del color del tipo
 * (luz → color → sombra) y un brillo especular. `r` y `escala` en unidades del grafo, como el
 * resto del canvas. Un color que no se sabe descomponer se pinta plano.
 */
function dibujarEsfera(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, escala: number): void {
  const c = rgbDe(color)
  if (!c || r * escala < RADIO_MINIMO_CON_VOLUMEN) {
    ctx.fillStyle = color
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill()
    return
  }
  // Sombra y brillo salen del mismo color llevado a negro y a blanco: sin literales.
  ctx.fillStyle = tono(c, -1, 0.32)
  ctx.beginPath(); ctx.ellipse(x + r * 0.15, y + r * 1.05, r * 0.85, r * 0.28, 0, 0, 2 * Math.PI); ctx.fill()
  const cuerpo = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r)
  cuerpo.addColorStop(0, tono(c, 0.55))
  cuerpo.addColorStop(0.45, tono(c, 0))
  cuerpo.addColorStop(1, tono(c, -0.45))
  ctx.fillStyle = cuerpo
  ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill()
  const brillo = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, 0, x - r * 0.38, y - r * 0.42, r * 0.45)
  brillo.addColorStop(0, tono(c, 1, 0.55))
  brillo.addColorStop(1, tono(c, 1, 0))
  ctx.fillStyle = brillo
  ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill()
}

/** El tamaño del nodo en px de PANTALLA a zoom 1. Crece poco con el grado. Más grande que un
 *  punto plano: con menos de ~5 px la esfera no se lee como esfera. */
function tamanoBase(n: Nodo, escalaDeNodo: number): number {
  return (3.5 + Math.sqrt(n.degree + 1) * 1.6) * escalaDeNodo
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

export default function MemoryGraph2D({ data, foco = null, resaltados = null, modo, escalaDeNodo = 1, distanciaDeLinks = 50, etiquetas = 'always', animar = true, onOpen }: MemoryGraph2DProps) {
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
   * si cambió, copias con las posiciones de antes.
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
  const marcarQueMovio = () => {
    usuarioMovio.current = true
    // Si se movió antes del primer encuadre, ese encuadre ya no llega y sin referencia las
    // etiquetas no saldrían nunca. La referencia pasa a ser la vista de la que partió: el zoom
    // que puso la librería, leído en captura, antes de que la rueda lo cambie.
    if (zoomDeEncuadre.current === null) {
      const k = instancia.current?.zoom?.()
      zoomDeEncuadre.current = typeof k === 'number' && k > 0 ? k : 1
    }
  }

  /**
   * Encuadre propio del local: margen para las etiquetas, que van debajo del punto y se
   * cortarían contra los bordes de una caja de ~280 × 180 px con el margen parejo de
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
      fondo: token('--background', '#0a0a0a'),
    }
  }, [])
  // El contorno de las etiquetas tiene que ser el color de lo que hay DETRÁS del canvas (que es
  // transparente): el primer ancestro con fondo propio. Se lee al montar, cuando ya hay caja.
  useEffect(() => {
    for (let el = caja.current?.parentElement; el; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor
      if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) { colores.fondo = bg; return }
    }
  }, [colores])

  const tocaAlHover = (l: GraphLinkDatum) => idDe(l.source) === hover || idDe(l.target) === hover

  return (
    <div
      ref={caja}
      className="relative h-full w-full"
      aria-label={modo === 'global' ? 'Memory graph' : 'Local graph'}
      role="group"
      onWheelCapture={() => { if (modo === 'global') marcarQueMovio() }}
      onPointerDownCapture={(e) => { arrastre.current = { x: e.clientX, y: e.clientY } }}
      onPointerMoveCapture={(e) => {
        const a = arrastre.current
        if (modo === 'global' && a && e.buttons && Math.hypot(e.clientX - a.x, e.clientY - a.y) > 4) marcarQueMovio()
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
            // Como en Obsidian: al soltarlo, el nodo vuelve a la física y se reacomoda con sus
            // vecinos. La librería lo deja fijo donde se soltó; acá se lo libera.
            onNodeDragEnd={(n) => { n.fx = undefined; n.fy = undefined }}
            // Hover: las aristas del nodo a pleno y las demás atenuadas, no ocultas.
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
              const [x, y] = [n.x ?? 0, n.y ?? 0]
              ctx.globalAlpha = opacidadDeNodo(n.id, hover, vecinosDelHover, resaltados)
              if (n.pending) {
                ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI)
                ctx.strokeStyle = colores.texto; ctx.lineWidth = 1 / escala; ctx.stroke()
              } else {
                dibujarEsfera(ctx, x, y, r, n.color, escala)
              }
              if (n.id === foco || n.id === hover) {
                // Un anillo separado de la esfera: pegado al borde se confunde con el sombreado.
                ctx.beginPath(); ctx.arc(x, y, r + 2.5 / escala, 0, 2 * Math.PI)
                ctx.strokeStyle = colores.textoFuerte; ctx.lineWidth = 1.5 / escala; ctx.stroke()
              }
              const conEtiqueta = muestraEtiqueta({
                modo, etiquetas, escala, zoomDeEncuadre: zoomDeEncuadre.current, destacado: n.id === hover || n.id === foco,
              })
              if (conEtiqueta) {
                const fs = 11 / escala
                const max = MAX_LETRAS[modo]
                const texto = n.label.length > max ? `${n.label.slice(0, max - 1)}…` : n.label
                // Debajo de la sombra de la esfera, no encima.
                const ty = y + r * 1.35 + 3 / escala
                ctx.font = `${fs}px ${colores.fuente}`
                ctx.textAlign = 'center'
                ctx.textBaseline = 'top'
                // Contorno del color del fondo: la etiqueta se lee aunque la cruce una línea.
                ctx.lineJoin = 'round'
                ctx.lineWidth = 3 / escala
                ctx.strokeStyle = colores.fondo
                ctx.strokeText(texto, x, ty)
                ctx.fillStyle = n.id === hover || n.id === foco ? colores.textoFuerte : colores.texto
                ctx.fillText(texto, x, ty)
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
