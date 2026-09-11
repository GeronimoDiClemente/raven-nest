// El render del grafo 3D. Este archivo es el ÚNICO que importa `react-force-graph-3d`, y
// por eso es el que hay que cargar con `import()` diferido: medido el 2026-09-11, importarlo
// arriba suma 1379.8 KB crudos al arranque; detrás de un import() suma 1.4 KB, o sea 0.04%
// (la tabla completa está en docs/superpowers/specs/2026-09-11-memories-legible-design.md).
// Nadie más debe importarlo directo — si aparece un segundo import estático, el chunk vuelve
// al arranque y nadie se entera.
//
// La caja es ACOTADA (spec §3): el tamaño se lo da el contenedor y se mide con un
// ResizeObserver, porque ForceGraph3D necesita width/height numéricos y sin eso se planta en
// un default de 1500px que se come la pantalla — que es exactamente el problema que esta
// pantalla venía a resolver.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d'
import { EDGE_STYLES, type GraphData, type GraphLinkDatum, type GraphNodeDatum } from '../lib/memory-graph-visuals'

interface Props {
  data: GraphData
  /** syncId de la memoria seleccionada en la lista, o null. */
  selectedId: string | null
  onSelect: (syncId: string | null) => void
}

/** react-force-graph muta los links: después del primer tick, `source`/`target` dejan de ser
 *  strings y pasan a ser los objetos de nodo. Cualquier accessor que lea el id tiene que
 *  soportar las dos formas o rompe en el segundo frame. */
function endId(end: string | { id?: string } | undefined): string | undefined {
  return typeof end === 'string' ? end : end?.id
}

export default function MemoryGraph3D({ data, selectedId, onSelect }: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const fgRef = useRef<ForceGraphMethods<GraphNodeDatum, GraphLinkDatum> | undefined>(undefined)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      // Redondeo a entero: un ancho fraccionario hace que el renderer se re-dimensione en
      // cada frame y el grafo tiemble.
      setSize({ w: Math.round(width), h: Math.round(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Vecinos directos del seleccionado. Con algo seleccionado, todo lo demás se atenúa: es
  // lo que convierte al grafo en una vista de la lista (spec §3) en vez de un adorno.
  const vecinos = useMemo(() => {
    if (!selectedId) return null
    const s = new Set<string>([selectedId])
    for (const l of data.links) {
      const a = endId(l.source as never)
      const b = endId(l.target as never)
      if (a === selectedId && b) s.add(b)
      if (b === selectedId && a) s.add(a)
    }
    return s
  }, [selectedId, data.links])

  const nodeColor = useCallback((node: GraphNodeDatum) => {
    if (!vecinos) return node.color
    return vecinos.has(node.id) ? node.color : 'rgba(120, 120, 120, 0.15)'
  }, [vecinos])

  const linkColor = useCallback((link: GraphLinkDatum) => {
    const base = EDGE_STYLES[link.kind].color
    if (!vecinos) return base
    const a = endId(link.source as never)
    const b = endId(link.target as never)
    const tocaAlSeleccionado = a === selectedId || b === selectedId
    return tocaAlSeleccionado ? base : 'rgba(120, 120, 120, 0.06)'
  }, [vecinos, selectedId])

  // Encuadrar cuando la simulación se aquieta. Sin esto la cámara se queda en su posición
  // inicial fija y el grafo aparece chiquito en una esquina de su propia caja, con todo el
  // resto vacío — que es exactamente la sensación de "no se entiende nada" que esta
  // pantalla venía a arreglar. El padding deja aire para que ningún nodo toque el borde.
  const encuadrar = useCallback(() => {
    const fg = fgRef.current
    if (!fg) {
      // Si esto se ve, el ref no llegó — el mismo sintoma de la trampa de React 18 contra
      // los primitivos de React 19 que ya mordió en esta rama (ver RECETA-MIGRACION-UI.md).
      // react-kapsule, que es lo que envuelve a ForceGraph3D, SI usa forwardRef, asi que
      // deberia llegar; el aviso esta para que un cambio de version no lo rompa en silencio.
      console.warn('[MemoryGraph3D] sin ref: el grafo no se va a encuadrar solo')
      return
    }

    // Encuadre calculado a mano en vez de `zoomToFit()`.
    //
    // zoomToFit existe y el ref llega, pero con estos grafos deja la camara demasiado
    // lejos: los nodos terminan ocupando como un cuarto de la caja y el resto es vacio —
    // exactamente lo que esta pantalla venia a arreglar. Calcular la esfera que contiene
    // a los nodos y ubicar la camara a la distancia que la hace entrar da un resultado
    // predecible y ajustable.
    //
    // Las posiciones salen de los nodos porque la simulacion los muta EN EL LUGAR: los
    // objetos de `data.nodes` son los mismos que recibe el motor.
    const pos = data.nodes as Array<GraphNodeDatum & { x?: number; y?: number; z?: number }>
    const conPos = pos.filter((n) => typeof n.x === 'number')
    if (conPos.length === 0) return

    const cx = conPos.reduce((a, n) => a + (n.x ?? 0), 0) / conPos.length
    const cy = conPos.reduce((a, n) => a + (n.y ?? 0), 0) / conPos.length
    const cz = conPos.reduce((a, n) => a + (n.z ?? 0), 0) / conPos.length
    const radio = Math.max(
      ...conPos.map((n) => Math.hypot((n.x ?? 0) - cx, (n.y ?? 0) - cy, (n.z ?? 0) - cz)),
      1,
    )

    // fov 60° => la mitad del alto visible a distancia d es d * tan(30°). Se pide que el
    // radio entre con un margen, y se pone un piso para que un grafo de dos nodos no
    // termine con la camara adentro de una esfera.
    const MARGEN = 1.45
    const distancia = Math.max((radio * MARGEN) / Math.tan((30 * Math.PI) / 180), 60)

    fg.cameraPosition({ x: cx, y: cy, z: cz + distancia }, { x: cx, y: cy, z: cz }, 400)
  }, [data])

  // Y también cuando cambia el conjunto de datos (prender las aristas inferidas agranda el
  // grafo): si sólo se encuadrara al frenar el motor, el grafo nuevo quedaría con el
  // encuadre del viejo.
  useEffect(() => {
    const t = setTimeout(encuadrar, 900)
    return () => clearTimeout(t)
  }, [data, encuadrar])

  const handleNodeClick = useCallback((node: GraphNodeDatum) => {
    // Click en el nodo ya seleccionado = deseleccionar. Sin esto no hay forma de volver a
    // ver el grafo entero sin tocar la lista.
    onSelect(node.id === selectedId ? null : node.id)
  }, [onSelect, selectedId])

  return (
    <div ref={boxRef} className="h-full w-full">
      {size && size.w > 0 && size.h > 0 && (
        <ForceGraph3D<GraphNodeDatum, GraphLinkDatum>
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={data}
          // Transparente: el fondo lo pone la card, así el cuadro pertenece a la pantalla en
          // vez de ser un recuadro negro pegado encima.
          backgroundColor="rgba(0,0,0,0)"
          showNavInfo={false}
          // 6, no el 4 por defecto: con pocos nodos un grafo de puntos chiquitos en una
          // caja de 320px se lee como ruido en vez de como una estructura.
          nodeRelSize={6}
          nodeVal={(n) => n.val}
          nodeColor={nodeColor}
          nodeLabel={(n) => n.label}
          nodeOpacity={0.95}
          linkColor={linkColor}
          linkWidth={(l) => EDGE_STYLES[l.kind].width}
          linkCurvature={(l) => EDGE_STYLES[l.kind].curvature}
          linkDirectionalArrowLength={(l) => EDGE_STYLES[l.kind].arrowLength}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={(l) => EDGE_STYLES[l.kind].color}
          onNodeClick={handleNodeClick}
          // Click en el vacío deselecciona, igual que en la lista.
          onBackgroundClick={() => onSelect(null)}
          // La simulación se frena sola. Un grafo que nunca se aquieta parece vivo un rato
          // y después molesta, y encima deja la GPU al 100% en una app que ya corre
          // terminales.
          // Menos repulsion que el default (-30): en una caja acotada, la repulsion fuerte
          // empuja los nodos contra los bordes y deja el centro vacio.
          d3VelocityDecay={0.35}
          cooldownTime={4000}
          onEngineStop={encuadrar}
          enableNodeDrag={false}
        />
      )}
    </div>
  )
}
