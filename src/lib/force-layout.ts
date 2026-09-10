// Layout force-directed, el mismo modelo que usa Obsidian (spec §5.1):
// repulsión tipo Coulomb entre TODOS los pares, atracción tipo Hooke en las
// aristas, y damping para que el sistema se frene en vez de vibrar.
//
// Puro y sin dependencias: un tick es una función que muta un array. Así la
// física se testea sin montar React ni pintar un SVG, que es donde este tipo
// de código se vuelve imposible de verificar.
//
// O(n²) por la repulsión de todos contra todos. Es lo correcto acá: el grafo
// del hilo se dibuja por proyecto y la spec de la fase 1 lo acota a ~200 nodos
// (40.000 pares por tick, nada para un requestAnimationFrame). Con más nodos
// habría que meter Barnes-Hut, y eso es otra tarea.

export interface ForceNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
}

export interface ForceEdge {
  from: string
  to: string
}

export interface ForceOpts {
  /** Fuerza de separación entre nodos. */
  repulsion?: number
  /** Rigidez del resorte de las aristas. */
  spring?: number
  /** Largo de reposo de una arista. */
  largo?: number
  /** Cuánta velocidad sobrevive a cada tick. <1 o no converge nunca. */
  damping?: number
}

/** Distancia mínima entre dos nodos para el cálculo de fuerzas.
 *  Sin esto, dos nodos exactamente encima dividen por cero y TODO el grafo se
 *  vuelve NaN — y un SVG con NaN no dibuja nada, sin ningún error. */
const MIN_DIST = 0.5

export function stepForceLayout(
  nodes: ForceNode[],
  edges: ForceEdge[],
  opts: ForceOpts = {}
): void {
  const repulsion = opts.repulsion ?? 3000
  const spring = opts.spring ?? 0.02
  const largo = opts.largo ?? 90
  const damping = opts.damping ?? 0.85

  const porId = new Map(nodes.map((n) => [n.id, n]))

  // Coulomb: todos contra todos, y simétrico (una pasada por par).
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      let d = Math.hypot(dx, dy)
      if (d < MIN_DIST) {
        // Superpuestos: se los separa en una dirección determinística en vez de
        // aleatoria, para que el layout sea reproducible entre corridas.
        dx = (i - j) || 1
        dy = 1
        d = Math.hypot(dx, dy)
      }
      const f = repulsion / (d * d)
      const ux = dx / d
      const uy = dy / d
      a.vx -= ux * f
      a.vy -= uy * f
      b.vx += ux * f
      b.vy += uy * f
    }
  }

  // Hooke: las aristas tiran hacia el largo de reposo.
  for (const e of edges) {
    const a = porId.get(e.from)
    const b = porId.get(e.to)
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.max(Math.hypot(dx, dy), MIN_DIST)
    const f = (d - largo) * spring
    const ux = dx / d
    const uy = dy / d
    a.vx += ux * f
    a.vy += uy * f
    b.vx -= ux * f
    b.vy -= uy * f
  }

  // Un empujón suave al origen: sin esto, un grafo sin aristas se expande para
  // siempre y se sale del viewBox.
  for (const n of nodes) {
    n.vx -= n.x * 0.0015
    n.vy -= n.y * 0.0015
    n.vx *= damping
    n.vy *= damping
    n.x += n.vx
    n.y += n.vy
  }
}

/** Energía cinética media. Sirve para saber cuándo parar de animar. */
export function energiaTotal(nodes: ForceNode[]): number {
  if (nodes.length === 0) return 0
  let e = 0
  for (const n of nodes) e += n.vx * n.vx + n.vy * n.vy
  return e / nodes.length
}
