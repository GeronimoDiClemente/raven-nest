// Lo puro del grafo 2D: qué arista es inferida, vecinos, el subgrafo local y el atenuado.
import type { MemoryEdgeKind } from '../types'
import type { GraphData, GraphLinkDatum } from './memory-graph-visuals'
import type { EtiquetasDelGrafo } from './memory-prefs'

export const ARISTAS_AFIRMADAS: ReadonlySet<MemoryEdgeKind> = new Set<MemoryEdgeKind>(['manual', 'wikilink', 'revision'])

export function esInferida(kind: MemoryEdgeKind): boolean { return !ARISTAS_AFIRMADAS.has(kind) }

/** react-force-graph muta `source`/`target` a objetos después del primer tick. */
export function idDe(x: unknown): string {
  return typeof x === 'string' ? x : String((x as { id: string }).id)
}

export function vecinos(links: GraphLinkDatum[], id: string): Set<string> {
  const out = new Set<string>()
  for (const l of links) {
    const s = idDe(l.source), t = idDe(l.target)
    if (s === id) out.add(t)
    if (t === id) out.add(s)
  }
  return out
}

export function subgrafoLocal(data: GraphData, foco: string, saltos: 1 | 2): GraphData {
  const dentro = new Set([foco])
  let frontera = new Set([foco])
  for (let i = 0; i < saltos; i++) {
    const nueva = new Set<string>()
    for (const id of frontera) for (const v of vecinos(data.links, id)) if (!dentro.has(v)) { dentro.add(v); nueva.add(v) }
    frontera = nueva
  }
  // Copias, no los mismos objetos del global (final review F6): react-force-graph escribe
  // x/y/fx/fy en el nodo y cambia source/target por objetos, así que compartirlos hacía que un
  // nodo fijado en el grafo local apareciera fijado en el global.
  return {
    nodes: data.nodes.filter((n) => dentro.has(n.id)).map(copiaDeNodo),
    links: data.links
      .filter((l) => dentro.has(idDe(l.source)) && dentro.has(idDe(l.target)))
      .map((l) => ({ ...l, source: idDe(l.source), target: idDe(l.target) })),
    orphansHidden: 0,
  }
}

/** Lo que la simulación escribe en un nodo. */
const CAMPOS_DE_POSICION = ['x', 'y', 'vx', 'vy', 'fx', 'fy'] as const
type ConPosicion = { id: string } & Partial<Record<(typeof CAMPOS_DE_POSICION)[number], number>>

function copiaDeNodo<T extends { id: string }>(n: T): T {
  const c = { ...n } as T & ConPosicion
  for (const k of CAMPOS_DE_POSICION) delete c[k]
  delete (c as { index?: number }).index
  delete (c as { __indexColor?: string }).__indexColor
  return c
}

/** Lo que identifica lo que se DIBUJA: si no cambió, el grafo no se le vuelve a dar a la
 *  librería (darle un objeto nuevo recalienta la simulación). */
export function claveDeDibujo(data: GraphData): string {
  const n = data.nodes.map((x) => `${x.id}|${x.label}|${x.color}|${x.degree}|${x.pending ? 1 : 0}|${x.superseded ? 1 : 0}`).join('\n')
  const l = data.links.map((x) => `${idDe(x.source)}>${idDe(x.target)}|${x.kind}`).join('\n')
  return `${n}\u0000${l}`
}

/**
 * Datos nuevos con las posiciones de los anteriores (final review F6). Cada `onChanged` —también
 * el eco del autoguardado— vuelve a pedir el grafo y `toGraphData` arma objetos nuevos: sin
 * esto, la simulación arrancaba de posiciones al azar cada 1,5 s mientras escribías. Devuelve
 * COPIAS (nodos y aristas con ids en texto): lo que la librería muta nunca es lo del caller.
 */
export function conPosicionesDe(anterior: GraphData | null, nuevo: GraphData): GraphData {
  const previas = new Map<string, ConPosicion>()
  for (const n of (anterior?.nodes ?? []) as ConPosicion[]) previas.set(n.id, n)
  return {
    ...nuevo,
    nodes: nuevo.nodes.map((n) => {
      const c = copiaDeNodo(n) as typeof n & ConPosicion
      const p = previas.get(n.id)
      if (p) for (const k of CAMPOS_DE_POSICION) if (typeof p[k] === 'number') c[k] = p[k]
      return c
    }),
    links: nuevo.links.map((l) => ({ ...l, source: idDe(l.source), target: idDe(l.target) })),
  }
}

const ATENUADO = 0.15

export function opacidadDeNodo(id: string, hover: string | null, vecinosDelHover: ReadonlySet<string>, resaltados: ReadonlySet<string> | null): number {
  if (hover) return id === hover || vecinosDelHover.has(id) ? 1 : ATENUADO
  if (resaltados) return resaltados.has(id) ? 1 : ATENUADO
  return 1
}

/**
 * El encuadre del grafo LOCAL (final review V3): `zoomToFit` deja el mismo margen de los cuatro
 * lados y mide sólo los puntos, así que en una caja de ~280 × 180 px las etiquetas (debajo del
 * punto, hasta 24 letras) se cortaban contra los bordes. Acá el margen es en px de pantalla:
 * a los costados media etiqueta, arriba el punto y abajo punto + etiqueta. Devuelve el centro
 * (en unidades del grafo) y el zoom; `tope` evita que uno o dos nodos queden gigantes.
 */
export function encuadreLocal(
  nodos: ReadonlyArray<{ x?: number; y?: number }>,
  ancho: number,
  alto: number,
  margen: { x: number; arriba: number; abajo: number },
  tope: number,
): { x: number; y: number; k: number } | null {
  const conPos = nodos.filter((n) => typeof n.x === 'number' && typeof n.y === 'number') as Array<{ x: number; y: number }>
  if (conPos.length === 0 || ancho <= 0 || alto <= 0) return null
  const xs = conPos.map((n) => n.x)
  const ys = conPos.map((n) => n.y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const utilX = Math.max(ancho - 2 * margen.x, 1)
  const utilY = Math.max(alto - margen.arriba - margen.abajo, 1)
  const k = Math.min(tope, utilX / Math.max(x1 - x0, 1e-6), utilY / Math.max(y1 - y0, 1e-6))
  // El centro del área útil no es el del canvas cuando arriba y abajo difieren: se corre el
  // punto que va al centro del canvas para que la caja de los nodos caiga en el área útil.
  const corrimientoY = (margen.arriba + utilY / 2 - alto / 2) / k
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - corrimientoY, k }
}

/** Las etiquetas del global aparecen al acercarse esto respecto del encuadre (spec §4 del 20-10). */
export const ZOOM_RELATIVO_DE_ETIQUETAS = 1.5

/** ¿Se dibuja el nombre de este nodo? (preferencia «Labels», spec 2026-10-21 §5). El local
 *  siempre lleva nombres (D13); el nodo bajo el mouse o enfocado también. */
export function muestraEtiqueta(o: {
  modo: 'global' | 'local'; etiquetas: EtiquetasDelGrafo; escala: number; zoomDeEncuadre: number | null; destacado: boolean
}): boolean {
  if (o.modo === 'local' || o.destacado) return true
  if (o.etiquetas === 'always') return true
  if (o.etiquetas === 'hover') return false
  return o.zoomDeEncuadre !== null && o.escala >= o.zoomDeEncuadre * ZOOM_RELATIVO_DE_ETIQUETAS
}

/** «Animate graph» (D13): apagado, el global corre la simulación sin dibujar y aparece quieto. */
export function ticksDelMotor(o: { modo: 'global' | 'local'; sinAcomodo: boolean; animar: boolean }): { warmupTicks: number; cooldownTicks: number } {
  if (o.modo === 'global' && !o.animar) return { warmupTicks: o.sinAcomodo ? 300 : 120, cooldownTicks: 0 }
  return { warmupTicks: o.sinAcomodo ? (o.modo === 'local' ? 40 : 80) : 0, cooldownTicks: o.modo === 'local' ? 60 : 150 }
}
