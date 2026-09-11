// El grafo de memorias sobre el render 3D compartido.
//
// Acá vive sólo la traducción: de `GraphData` (memorias y sus cuatro clases de arista) a los
// nodos y líneas genéricas que `Graph3D` sabe dibujar. El render —medir la caja, encuadrar,
// los controles, el atenuado del vecindario, las etiquetas— es compartido con el grafo de
// ramas, y `Graph3D` es el único que importa react-force-graph-3d.
import { useMemo } from 'react'
import Graph3D, { type Link3D, type Node3D } from './Graph3D'
import { EDGE_STYLES, type GraphData } from '../lib/memory-graph-visuals'

interface Props {
  data: GraphData
  /** syncId de la memoria seleccionada en la lista, o null. */
  selectedId: string | null
  onSelect: (syncId: string | null) => void
  showLabels: boolean
}

export default function MemoryGraph3D({ data, selectedId, onSelect, showLabels }: Props) {
  // Los nodos se pasan TAL CUAL (`data.nodes` ya tiene id/label/color/val) y no como copias:
  // la simulación muta las posiciones en el lugar, y el encuadre de Graph3D las lee de estos
  // mismos objetos. Copiarlos dejaría el encuadre mirando nodos sin posición.
  const nodes: Node3D[] = data.nodes

  // Las aristas SÍ se traducen: `kind` es nuestro, y el estilo —ancho, curvatura, flecha—
  // es lo que hace que las cuatro relaciones se distingan por forma y no por color.
  const links = useMemo<Link3D[]>(
    () => data.links.map((l) => {
      const s = EDGE_STYLES[l.kind]
      return {
        source: l.source,
        target: l.target,
        width: s.width,
        color: s.color,
        curvature: s.curvature,
        arrowLength: s.arrowLength,
      }
    }),
    [data.links],
  )

  return (
    <Graph3D
      nombre="memorias"
      nodes={nodes}
      links={links}
      selectedId={selectedId}
      onSelect={onSelect}
      showLabels={showLabels}
    />
  )
}
