// Del grafo del hilo de equipo a los nodos y líneas que sabe dibujar `Graph3D`.
//
// Está acá, separado del componente, por una razón concreta: desde que el grafo se dibuja en
// WebGL, el render deja de ser inspeccionable desde un test —un canvas no tiene nodos que
// buscar— así que lo que se puede verificar de verdad es esta traducción. Y es justo donde
// viven las decisiones: qué color le toca a cada rama, cuál se dibuja más grande, y qué dice
// la etiqueta.
import type { GraphNode, ThreadGraph } from './team-thread-graph'
import type { Link3D, Node3D } from '../components/Graph3D'

/** El nodo central sintético. No es una rama: es de donde cuelgan todas. */
export const ID_INDICE = '_index'

/**
 * Escala de frescura. Los valores viven en `:root` (global.css) y se leen de ahí; estos son
 * el respaldo para cuando no hay un DOM con estilos — los tests, y cualquier render previo a
 * que la hoja cargue.
 *
 * Hay que resolverlos a un color REAL antes de dibujar: three pinta sobre WebGL y no sabe
 * nada de variables CSS. Un `var(--tt-fresh-hoy)` le llega como color inválido y pinta
 * negro, que es exactamente el bug que el panel arrastraba por otro camino.
 */
export const FALLBACK_FRESCURA: Record<string, string> = {
  hoy: '#22c55e',
  semana: '#15803d',
  mes: '#6b7280',
  viejo: '#40474f',
}

const VAR_FRESCURA: Record<string, string> = {
  hoy: '--tt-fresh-hoy',
  semana: '--tt-fresh-semana',
  mes: '--tt-fresh-mes',
  viejo: '--tt-fresh-viejo',
}

/** Gris del nodo central. NO blanco: es de donde cuelgan las demás, no la más importante —
 *  en blanco puro se llevaba toda la atención de la pantalla. */
export const COLOR_INDICE = '#7a7a7a'

const NEUTRO = '#8a8a8a'

// El estado y la frescura son el punto entero del panel. Sin ellos, quien use un lector de
// pantalla puede abrir las notas pero se pierde justo lo que el panel viene a aportar — por
// eso van al TEXTO de la etiqueta (que es lo que el tooltip lee), no sólo al color.
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

export function colorDeFrescura(frescura: string): string {
  const respaldo = FALLBACK_FRESCURA[frescura] ?? NEUTRO
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return respaldo
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(VAR_FRESCURA[frescura] ?? '')
    .trim()
  return v || respaldo
}

export function etiquetaDeRama(n: GraphNode): string {
  const estado = ESTADO_LABEL[n.estado] ?? n.estado
  const frescura = FRESCURA_LABEL[n.frescura] ?? n.frescura
  return `${n.label} — ${estado}, ${frescura}`
}

export function nodosDelHilo(graph: ThreadGraph): Node3D[] {
  return graph.nodes.map((n) => n.id === ID_INDICE
    ? { id: n.id, label: 'All branches', color: COLOR_INDICE, val: 3 }
    : {
        id: n.id,
        label: etiquetaDeRama(n),
        color: colorDeFrescura(n.frescura),
        // La rama en foco se dibuja más grande: es "dónde estoy".
        val: n.foco ? 4 : 2,
      })
}

export function aristasDelHilo(graph: ThreadGraph): Link3D[] {
  return graph.edges.map((e) => ({
    source: e.from,
    target: e.to,
    width: 1,
    color: 'rgba(150, 150, 150, 0.35)',
    curvature: 0,
    // Sin flecha: la estrella `índice -> rama` no cuenta una dirección que signifique algo.
    arrowLength: 0,
  }))
}
