// Estado de los filtros del grafo de Memories y el `GraphData` que sale de aplicarlos.
// Reemplaza la lógica que vivía dentro de `MemoryGraphPanel` (que se borra más adelante).
import { useCallback, useMemo, useState } from 'react'
import { toGraphData, type ColorBy, type Foco, type GraphData } from '../lib/memory-graph-visuals'
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

export function useGraphFilters(graph: MemoryGraph | null, ansi?: readonly string[]) {
  const [colorBy, setColorBy] = useState<ColorBy>('type')
  const [foco, setFoco] = useState<Foco>(null)
  const [hideOrphans, setHideOrphans] = useState(true)
  const [tiposOcultos, setTiposOcultos] = useState<ReadonlySet<string>>(() => new Set())
  const [escalaDeNodo, setEscalaDeNodo] = useState(1)
  const [distanciaDeLinks, setDistanciaDeLinks] = useState(50)

  const toggleTipo = useCallback((tipo: string) => {
    setTiposOcultos((prev) => {
      const next = new Set(prev)
      if (next.has(tipo)) next.delete(tipo)
      else next.add(tipo)
      return next
    })
  }, [])

  const data = useMemo<GraphData>(() => {
    if (!graph) return VACIO
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
    const colorEfectivo: ColorBy = foco?.tipo === 'project'
      ? 'type'
      : colorBy === 'type' && tiposPresentes.size <= 1 ? 'project' : colorBy
    return toGraphData(graph, { colorBy: colorEfectivo, hideOrphans, foco, ansi, tiposOcultos })
  }, [graph, colorBy, foco, hideOrphans, ansi, tiposOcultos])

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

  return {
    filtros, setColorBy, setFoco, setHideOrphans, toggleTipo, setEscalaDeNodo, setDistanciaDeLinks,
    data, conteoPorTipo,
  }
}
