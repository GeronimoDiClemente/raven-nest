// El grafo de memorias, dibujado para una terminal.
//
// Existe porque si el grafo sólo vive en la ventana de Nest, entonces es una función de la
// app y no de la memoria. Alguien que se lleva el plugin y trabaja desde otro editor tiene
// que poder pedirle a su agente "¿qué sabés de auth?" y recibir la misma estructura que se
// ve en 3D — el mismo significado, traducido a lo que una terminal puede.
//
// Puro: recibe el grafo y devuelve texto. Sin fs, sin red, sin Electron.
import type { MemoryEdgeKind, MemoryGraph, MemoryGraphEdge, MemoryGraphNode } from './memory-graph'

/**
 * Qué dibuja cada relación.
 *
 * El criterio es el mismo que en 3D y por la misma razón: las relaciones NO se distinguen
 * por color sino por forma, porque una terminal puede no tener color y porque mezclarlas
 * todas en la misma línea hace que el grafo se vea rico y no signifique nada.
 *
 * `cross` es la única que cruza proyectos, y es la que más se nota a propósito: es lo que un
 * grafo de varios repos tiene para decir y uno de un solo repo no.
 */
const TRAZO: Record<MemoryEdgeKind, { rama: string; vertical: string; que: string }> = {
  // La mas marcada, y primera. Las otras seis las inferimos de un campo compartido; esta es
  // la unica que una persona AFIRMO. Mezclarlas dejaria lo unico que alguien se tomo el
  // trabajo de decir indistinguible de lo que dedujo una consulta.
  manual: { rama: '━━━', vertical: '┃', que: 'conectadas a mano' },
  // Afirmada como la manual —trazo grueso— pero dirigida: la escribió quien redactó la
  // memoria, apuntando a otra. Como `revision`, su texto depende del sentido (ver `queDice`).
  wikilink: { rama: '━━▶', vertical: '┃', que: 'linkeada en el texto' },
  // `revision` es la única dirigida, así que su texto depende de para qué lado se la esté
  // leyendo — ver `queDice`. Esto es el caso genérico, el que usa la leyenda del pie.
  revision: { rama: '──▶', vertical: '│', que: 'una reemplazó a la otra' },
  topic: { rama: '───', vertical: '│', que: 'mismo tema' },
  'cross-topic': { rama: '═══', vertical: '║', que: 'mismo tema, OTRO repo' },
  // Doble como cross-topic —las dos cruzan repos, que es lo que importa distinguir— pero con
  // el trazo fino: el tag dice que el trabajo es sobre lo mismo, el topic dice que la memoria
  // es sobre lo mismo. La segunda es una afirmación más fuerte.
  'cross-tag': { rama: '╌═╌', vertical: '╫', que: 'mismo tag, OTRO repo' },
  branch: { rama: '───', vertical: '│', que: 'misma rama' },
  source: { rama: '───', vertical: '│', que: 'mismo documento' },
  similar: { rama: '╌╌╌', vertical: '╎', que: 'parecidas (inferido)' },
}

/**
 * Qué dice la relación, leída DESDE el nodo padre HACIA el hijo.
 *
 * Lo necesitan las dirigidas —`revision` y `wikilink`—, porque una etiqueta fija dice lo
 * contrario de lo que pasa en la mitad de los casos.
 *
 * En `revision`, `from` es la memoria reemplazada y `to` la que la reemplazó (ver
 * buildMemoryGraph), así que si el hijo es el `from`, el padre es el que la reemplazó — y al
 * revés. En `wikilink`, `from` es la que MENCIONA y `to` la mencionada: leer la arista al
 * revés es justamente el backlink.
 */
function queDice(kind: MemoryEdgeKind, hijoEsElFrom: boolean): string {
  if (kind === 'revision') return hijoEsElFrom ? 'replaced by the one above' : 'replaces the one above'
  if (kind === 'wikilink') return hijoEsElFrom ? 'points at the one above' : 'is pointed at by the one above'
  return TRAZO[kind].que
}

/** Vigente o reemplazada. Un círculo hueco se lee como "esto ya no vale" sin leyenda. */
const VIGENTE = '●'
const REEMPLAZADA = '○'

export interface RenderOptions {
  /** Ancho total disponible. Los títulos se recortan para que una fila nunca envuelva: una
   *  fila que envuelve rompe el dibujo del árbol y lo vuelve ilegible. */
  ancho?: number
  /** Cuántas memorias listar como máximo. El resto se cuenta al pie. */
  limite?: number
  /** Título de arriba, normalmente el filtro que se pidió (`#auth`, un proyecto…). */
  encabezado?: string
}

const ANCHO_DEFAULT = 76
const LIMITE_DEFAULT = 20

function recortar(texto: string, max: number): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  if (max <= 1) return ''
  return limpio.length <= max ? limpio : `${limpio.slice(0, max - 1)}…`
}

function edad(updatedAt: number, ahora: number): string {
  const s = Math.max(0, Math.floor((ahora - updatedAt) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** Vecinos de cada nodo, con el tipo de relación. No dirigido salvo `revision`. */
function vecindario(
  edges: MemoryGraphEdge[]
): Map<string, Array<{ id: string; kind: MemoryEdgeKind; esElFrom: boolean }>> {
  const out = new Map<string, Array<{ id: string; kind: MemoryEdgeKind; esElFrom: boolean }>>()
  const push = (de: string, a: string, kind: MemoryEdgeKind, esElFrom: boolean) => {
    const lista = out.get(de) ?? []
    lista.push({ id: a, kind, esElFrom })
    out.set(de, lista)
  }
  for (const e of edges) {
    // `esElFrom` dice si el VECINO es el extremo `from` de la arista, que es lo único que
    // permite escribir bien una relación dirigida desde cualquiera de sus dos puntas.
    push(e.from, e.to, e.kind, false)
    push(e.to, e.from, e.kind, true)
  }
  return out
}

/**
 * Dibuja el grafo como un árbol de una raíz por componente conexa.
 *
 * Un árbol y no un diagrama: una terminal no tiene dos dimensiones libres, y un grafo con
 * ciclos dibujado a la fuerza en ASCII es ilegible. La raíz de cada componente es su nodo
 * más conectado — el que más explica lo que hay alrededor — y cada vecino se lista una sola
 * vez, con el trazo de la relación por la que entró.
 */
export function renderMemoryGraphText(
  graph: MemoryGraph,
  opts: RenderOptions = {},
  ahora: number = Date.now()
): string {
  const ancho = opts.ancho ?? ANCHO_DEFAULT
  const limite = opts.limite ?? LIMITE_DEFAULT

  if (graph.nodes.length === 0) {
    return opts.encabezado
      ? `${opts.encabezado}\n\nNo hay memorias que coincidan.`
      : 'No memories yet.'
  }

  const porId = new Map<string, MemoryGraphNode>(graph.nodes.map((n) => [n.syncId, n]))
  const vecinos = vecindario(graph.edges)
  const proyectos = new Set(graph.nodes.map((n) => n.projectKey))

  const lineas: string[] = []
  if (opts.encabezado) {
    const n = graph.nodes.length
    const p = proyectos.size
    lineas.push(
      `${opts.encabezado} · ${n} ${n === 1 ? 'memoria' : 'memorias'} · ` +
      `${p} ${p === 1 ? 'proyecto' : 'proyectos'}`
    )
    lineas.push('')
  }

  // Grado de cada nodo, para elegir la raíz de cada componente.
  const grado = new Map<string, number>()
  for (const n of graph.nodes) grado.set(n.syncId, vecinos.get(n.syncId)?.length ?? 0)

  const vistos = new Set<string>()
  let dibujados = 0
  let sueltas = 0

  // Los más conectados primero: la primera pantalla tiene que ser la que más explica.
  const orden = [...graph.nodes].sort(
    (a, b) => (grado.get(b.syncId)! - grado.get(a.syncId)!) || (b.updatedAt - a.updatedAt)
  )

  for (const raiz of orden) {
    if (vistos.has(raiz.syncId)) continue
    if (dibujados >= limite) break

    const misVecinos = (vecinos.get(raiz.syncId) ?? []).filter((v) => !vistos.has(v.id) && porId.has(v.id))
    if (misVecinos.length === 0 && (grado.get(raiz.syncId) ?? 0) === 0) {
      // Suelta: se cuenta y se lista al final, no se le dedica un bloque.
      sueltas += 1
      vistos.add(raiz.syncId)
      continue
    }

    if (dibujados > 0) lineas.push('')
    lineas.push(filaDeNodo(raiz, '  ', ancho, ahora))
    vistos.add(raiz.syncId)
    dibujados += 1

    misVecinos.forEach((v, i) => {
      if (dibujados >= limite) return
      const hijo = porId.get(v.id)!
      if (vistos.has(hijo.syncId)) return
      const ultimo = i === misVecinos.length - 1
      const trazo = TRAZO[v.kind]
      lineas.push(`  ${ultimo ? '└' : '├'}${trazo.rama} ${filaDeNodo(hijo, '', ancho - 6, ahora)}`)
      lineas.push(`  ${ultimo ? ' ' : trazo.vertical}    ${queDice(v.kind, v.esElFrom)}`)
      vistos.add(hijo.syncId)
      dibujados += 1
    })
  }

  const restantes = graph.nodes.length - vistos.size
  const pie: string[] = []
  if (sueltas > 0) {
    pie.push(`${sueltas} sin conectar con ninguna otra`)
  }
  if (restantes > 0) {
    pie.push(`${restantes} more not shown`)
  }
  if (graph.truncated > 0) {
    pie.push(`${graph.truncated} beyond the query limit`)
  }
  if (pie.length > 0) {
    lineas.push('')
    lineas.push(pie.join(' · '))
  }

  // La leyenda va al pie y sólo nombra los trazos que de verdad se usaron: una leyenda que
  // nombra cosas que no están en pantalla enseña mal.
  const usados = new Set(graph.edges.map((e) => e.kind))
  if (usados.size > 0) {
    lineas.push('')
    lineas.push(
      [...usados].map((k) => `${TRAZO[k].rama} ${TRAZO[k].que}`).join('   ') +
      `   ${REEMPLAZADA} ya no vigente`
    )
  }

  return lineas.join('\n')
}

function filaDeNodo(n: MemoryGraphNode, sangria: string, ancho: number, ahora: number): string {
  const marca = n.superseded ? REEMPLAZADA : VIGENTE
  const cola = `${n.projectDisplayName ?? n.projectKey} · ${edad(n.updatedAt, ahora)}`
  // El título se lleva lo que sobra después de la marca, la sangría y la cola.
  const espacioTitulo = Math.max(12, ancho - sangria.length - cola.length - 5)
  const titulo = recortar(n.title, espacioTitulo)
  const relleno = ' '.repeat(Math.max(1, espacioTitulo - titulo.length + 2))
  return `${sangria}${marca} ${titulo}${relleno}${cola}`
}
