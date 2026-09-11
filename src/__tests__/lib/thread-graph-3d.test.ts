// Lo que cada nodo del grafo de ramas SIGNIFICA.
//
// Vive acá y no en el test del componente porque desde que el grafo se dibuja en WebGL el
// render dejó de ser inspeccionable: un canvas no tiene nodos que buscar, y jsdom no lo
// ejecuta. Esta traducción es donde están las decisiones —qué color, qué tamaño, qué dice la
// etiqueta— y es pura, así que es lo que de verdad se puede verificar.
import { describe, it, expect } from 'vitest'
import {
  nodosDelHilo, aristasDelHilo, etiquetaDeRama, colorDeFrescura,
  ID_INDICE, COLOR_INDICE, FALLBACK_FRESCURA,
} from '../../lib/thread-graph-3d'
import type { GraphNode, ThreadGraph } from '../../lib/team-thread-graph'

function rama(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    label: id,
    estado: 'activa',
    frescura: 'hoy',
    autor: 'Gero',
    x: 0,
    y: 0,
    foco: false,
    ...extra,
  }
}

function grafo(nodes: GraphNode[], edges: ThreadGraph['edges'] = []): ThreadGraph {
  return { nodes, edges, recortados: 0 }
}

describe('nodosDelHilo', () => {
  it('hay un nodo por rama, mas el central', () => {
    const nodos = nodosDelHilo(grafo([rama(ID_INDICE), rama('a'), rama('b')]))
    expect(nodos.map((n) => n.id)).toEqual([ID_INDICE, 'a', 'b'])
  })

  // El nodo central era un circulo RELLENO de --text-primary: blanco puro, lo mas fuerte de
  // la paleta, para el nodo del que cuelgan las demas. Se llevaba toda la atencion.
  it('el nodo central es gris y se llama "All branches", no blanco puro', () => {
    const central = nodosDelHilo(grafo([rama(ID_INDICE)]))[0]
    expect(central.color).toBe(COLOR_INDICE)
    expect(central.label).toBe('All branches')
    expect(central.color).not.toBe('#ffffff')
  })

  it('la rama en foco se dibuja mas grande: es donde estas parado', () => {
    const nodos = nodosDelHilo(grafo([rama('foco', { foco: true }), rama('otra')]))
    const foco = nodos.find((n) => n.id === 'foco')!
    const otra = nodos.find((n) => n.id === 'otra')!
    expect(foco.val).toBeGreaterThan(otra.val)
  })

  it('cada frescura tiene su propio color, y ninguno se repite', () => {
    const nodos = nodosDelHilo(grafo([
      rama('a', { frescura: 'hoy' }),
      rama('b', { frescura: 'semana' }),
      rama('c', { frescura: 'mes' }),
      rama('d', { frescura: 'viejo' }),
    ]))
    expect(new Set(nodos.map((n) => n.color)).size).toBe(4)
  })

  // Los colores tienen que ser valores REALES. three pinta sobre WebGL y no sabe nada de
  // variables CSS: un `var(--tt-fresh-hoy)` le llega como color invalido y pinta negro — que
  // es el mismo bug que este panel ya habia tenido por otro camino.
  it('ningun color sale como var(--...): WebGL no sabe leer variables CSS', () => {
    const nodos = nodosDelHilo(grafo([rama('a'), rama('b', { frescura: 'viejo' })]))
    for (const n of nodos) expect(n.color).not.toMatch(/^var\(/)
  })

  it('una frescura desconocida cae a un gris, no a vacio', () => {
    const n = nodosDelHilo(grafo([rama('a', { frescura: 'inventada' as never })]))[0]
    expect(n.color).toMatch(/^#|^rgb/)
  })
})

describe('etiquetaDeRama', () => {
  // El color por estado y frescura es el punto entero del panel. Quien use un lector de
  // pantalla puede abrir las notas igual, pero se pierde justo eso — por eso va al TEXTO.
  it('dice el estado y la frescura, no solo el nombre', () => {
    expect(etiquetaDeRama(rama('feat/x', { label: 'feat/x', estado: 'activa', frescura: 'hoy' })))
      .toBe('feat/x — active, updated today')
    expect(etiquetaDeRama(rama('smoke/y', { label: 'smoke/y', estado: 'cerrada', frescura: 'viejo' })))
      .toBe('smoke/y — closed, stale')
  })

  it('una rama sin worktree local lo dice', () => {
    expect(etiquetaDeRama(rama('z', { label: 'z', estado: 'sin-worktree', frescura: 'mes' })))
      .toBe('z — no local worktree, updated this month')
  })
})

describe('aristasDelHilo', () => {
  it('ninguna lleva flecha: la estrella indice -> rama no cuenta una direccion', () => {
    const aristas = aristasDelHilo(grafo([rama(ID_INDICE), rama('a')], [{ from: ID_INDICE, to: 'a' }]))
    expect(aristas).toHaveLength(1)
    expect(aristas[0].arrowLength).toBe(0)
  })
})

describe('colorDeFrescura', () => {
  it('sin variables CSS puestas, usa el respaldo declarado', () => {
    // jsdom devuelve '' para una custom property que nadie declaro.
    expect(colorDeFrescura('hoy')).toBe(FALLBACK_FRESCURA.hoy)
  })
})
