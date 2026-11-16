// Estado de los filtros del grafo de Memories y el `GraphData` que sale de aplicarlos.
import { useCallback, useMemo, useState } from 'react'
import { toGraphData, type ColorBy, type Foco, type GraphData } from '../lib/memory-graph-visuals'
import { esInferida } from '../lib/memory-graph-2d'
import { FILTROS_POR_DEFECTO, type FiltrosGuardados } from '../lib/memory-prefs'
import type { MemoryGraph } from '../types'

export interface GraphFilters {
  colorBy: ColorBy
  foco: Foco
  hideOrphans: boolean
  tiposOcultos: ReadonlySet<string>
  escalaDeNodo: number
  distanciaDeLinks: number
}

const VACIO: GraphData = { nodes: [], links: [], orphansHidden: 0 }

/**
 * `conInferidas: false` saca TODAS las aristas inferidas —same branch, same
 * topic y similar—, no sólo `similar`: el tour dice "las punteadas son suposiciones" y el
 * botón las apaga a todas. `similar` además deja de pedirse a main (lo decide el workspace).
 */
export function useGraphFilters(
  graph: MemoryGraph | null, ansi?: readonly string[], conInferidas = true, inicial?: FiltrosGuardados | null,
) {
  // `inicial` (lo recordado) se lee sólo al montar.
  const ini = inicial ?? FILTROS_POR_DEFECTO
  const [colorBy, setColorBy] = useState<ColorBy>(ini.colorBy)
  const [foco, setFoco] = useState<Foco>(null)
  const [hideOrphans, setHideOrphans] = useState(ini.hideOrphans)
  const [tiposOcultos, setTiposOcultos] = useState<ReadonlySet<string>>(() => new Set(ini.tiposOcultos))
  const [escalaDeNodo, setEscalaDeNodo] = useState(ini.escalaDeNodo)
  const [distanciaDeLinks, setDistanciaDeLinks] = useState(ini.distanciaDeLinks)

  const toggleTipo = useCallback((tipo: string) => {
    setTiposOcultos((prev) => {
      const next = new Set(prev)
      if (next.has(tipo)) next.delete(tipo)
      else next.add(tipo)
      return next
    })
  }, [])

  const visible = useMemo<MemoryGraph | null>(() => {
    if (!graph || conInferidas) return graph
    return { ...graph, edges: graph.edges.filter((e) => !esInferida(e.kind)) }
  }, [graph, conInferidas])

  const colorEfectivo = useMemo<ColorBy>(() => {
    if (!graph) return colorBy
    // Los tipos presentes salen del grafo CRUDO (dentro del foco), no de `data`: así no hay
    // ciclo data -> color efectivo -> tipos presentes -> data.
    const enFoco = !foco
      ? graph.nodes
      : foco.tipo === 'project'
        ? graph.nodes.filter((n) => n.projectKey === foco.valor)
        : graph.nodes.filter((n) => n.tags.includes(foco.valor))
    const tiposPresentes = new Set(enFoco.filter((n) => !n.pending).map((n) => n.type))
    // Dentro de un proyecto colorear por proyecto no distingue nada: manda el tipo. Con un
    // solo tipo, colorear por tipo tampoco: cae a proyecto.
    return foco?.tipo === 'project'
      ? 'type'
      : colorBy === 'type' && tiposPresentes.size <= 1 ? 'project' : colorBy
  }, [graph, colorBy, foco])

  const data = useMemo<GraphData>(() => {
    if (!visible) return VACIO
    return toGraphData(visible, { colorBy: colorEfectivo, hideOrphans, foco, ansi, tiposOcultos })
  }, [visible, colorEfectivo, hideOrphans, foco, ansi, tiposOcultos])

  /**
   * El grafo de donde sale el LOCAL de cada nota: sin huérfanas ocultas, sin foco y sin tipos
   * apagados — esos filtros son de la pestaña Graph. Con ellos, una memoria recién escrita
   * (siempre suelta) o una de otro proyecto no tendría grafo local. Mismo color
   * y mismas aristas que el global.
   */
  const dataCompleta = useMemo<GraphData>(() => {
    if (!visible) return VACIO
    return toGraphData(visible, { colorBy: colorEfectivo, hideOrphans: false, foco: null, ansi })
  }, [visible, colorEfectivo, ansi])

  // Cuenta sobre el grafo completo y SIN el filtro de tipos: un tipo apagado sigue en el
  // panel, con su número, para poder prenderlo otra vez.
  const conteoPorTipo = useMemo(() => {
    const out = new Map<string, number>()
    if (!graph) return out
    for (const n of graph.nodes) if (!n.pending) out.set(n.type, (out.get(n.type) ?? 0) + 1)
    return out
  }, [graph])

  const filtros = useMemo<GraphFilters>(
    () => ({ colorBy, foco, hideOrphans, tiposOcultos, escalaDeNodo, distanciaDeLinks }),
    [colorBy, foco, hideOrphans, tiposOcultos, escalaDeNodo, distanciaDeLinks],
  )

  /** «Reset graph to defaults»: filtros y fuerzas al arranque, y sin foco. */
  const restablecer = useCallback(() => {
    setColorBy(FILTROS_POR_DEFECTO.colorBy)
    setFoco(null)
    setHideOrphans(FILTROS_POR_DEFECTO.hideOrphans)
    setTiposOcultos(new Set())
    setEscalaDeNodo(FILTROS_POR_DEFECTO.escalaDeNodo)
    setDistanciaDeLinks(FILTROS_POR_DEFECTO.distanciaDeLinks)
  }, [])

  /** Lo recordado, cuando las prefs llegan después del primer render (primera apertura). Las
   *  inferidas no: ese interruptor es del workspace, que también decide qué pide a main. */
  const aplicar = useCallback((f: FiltrosGuardados) => {
    setColorBy(f.colorBy)
    setHideOrphans(f.hideOrphans)
    setTiposOcultos(new Set(f.tiposOcultos))
    setEscalaDeNodo(f.escalaDeNodo)
    setDistanciaDeLinks(f.distanciaDeLinks)
  }, [])

  return {
    filtros, setColorBy, setFoco, setHideOrphans, toggleTipo, setEscalaDeNodo, setDistanciaDeLinks,
    data, dataCompleta, conteoPorTipo, restablecer, aplicar,
  }
}
