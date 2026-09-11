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
import { CanvasTexture, Sprite, SpriteMaterial } from 'three'
import { EDGE_STYLES, type GraphData, type GraphLinkDatum, type GraphNodeDatum } from '../lib/memory-graph-visuals'

interface Props {
  data: GraphData
  /** syncId de la memoria seleccionada en la lista, o null. */
  selectedId: string | null
  onSelect: (syncId: string | null) => void
  /**
   * Dibujar el título al lado de cada nodo. Lo decide el panel por CANTIDAD: con muchos
   * nodos las etiquetas se pisan entre sí y dejan de ser información. Es el equivalente del
   * `text fade threshold` de Obsidian, que hace lo mismo pero por distancia de cámara.
   */
  showLabels: boolean
}

/**
 * La etiqueta de un nodo, como sprite de canvas.
 *
 * Se dibuja a 2x y se escala a la mitad para que no se vea pixelada en pantallas retina, y
 * el texto se recorta a 28 caracteres: un título de memoria es una frase entera y pintarla
 * completa al lado de cada punto tapa el grafo. El título completo sigue estando en el
 * tooltip y en el panel de la derecha.
 */
function spriteDeEtiqueta(texto: string, color: string): Sprite {
  const recortado = texto.length > 28 ? `${texto.slice(0, 27)}…` : texto
  const escala = 2
  const fuente = 12 * escala
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.font = `${fuente}px sans-serif`
  const ancho = ctx.measureText(recortado).width
  canvas.width = Math.ceil(ancho) + 8
  canvas.height = fuente + 8
  // Medir cambia el tamaño del canvas, y eso RESETEA el contexto — la fuente hay que
  // volver a ponerla o el texto sale con el default de 10px serif.
  ctx.font = `${fuente}px sans-serif`
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(recortado, 4, canvas.height / 2)

  const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), depthWrite: false }))
  sprite.scale.set(canvas.width / escala / 2.2, canvas.height / escala / 2.2, 1)
  return sprite
}

/** react-force-graph muta los links: después del primer tick, `source`/`target` dejan de ser
 *  strings y pasan a ser los objetos de nodo. Cualquier accessor que lea el id tiene que
 *  soportar las dos formas o rompe en el segundo frame. */
function endId(end: string | { id?: string } | undefined): string | undefined {
  return typeof end === 'string' ? end : end?.id
}

export default function MemoryGraph3D({ data, selectedId, onSelect, showLabels }: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const fgRef = useRef<ForceGraphMethods<GraphNodeDatum, GraphLinkDatum> | undefined>(undefined)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  /**
   * Si el usuario ya movió la cámara, el encuadre automático NO vuelve a tocarla.
   *
   * Sin esto el grafo se sentía roto: la simulación se aquieta a los 4s (`cooldownTime`) y
   * ahí dispara `onEngineStop`, que reencuadraba con una animación de 400ms. Si en ese
   * momento estabas arrastrando o haciendo zoom, la cámara te la sacaba de las manos.
   */
  const usuarioMovioLaCamara = useRef(false)

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
    if (usuarioMovioLaCamara.current) return
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
    const MARGEN = 1.2
    const distancia = Math.max((radio * MARGEN) / Math.tan((30 * Math.PI) / 180), 60)

    fg.cameraPosition({ x: cx, y: cy, z: cz + distancia }, { x: cx, y: cy, z: cz }, 400)
  }, [data])

  // Y también cuando cambia el conjunto de datos (prender las aristas inferidas agranda el
  // grafo): si sólo se encuadrara al frenar el motor, el grafo nuevo quedaría con el
  // encuadre del viejo.
  useEffect(() => {
    // Un conjunto de datos nuevo (entrar a un proyecto, prender las aristas inferidas) sí
    // merece reencuadre: es otro grafo, y dejarlo con la cámara del anterior lo deja fuera
    // de cuadro. Lo que no se pisa es un encuadre que el usuario hizo sobre ESTE grafo.
    usuarioMovioLaCamara.current = false
    const t = setTimeout(encuadrar, 900)
    return () => clearTimeout(t)
  }, [data, encuadrar])

  const handleNodeClick = useCallback((node: GraphNodeDatum) => {
    // Click en el nodo ya seleccionado = deseleccionar. Sin esto no hay forma de volver a
    // ver el grafo entero sin tocar la lista.
    onSelect(node.id === selectedId ? null : node.id)
  }, [onSelect, selectedId])

  // Cualquiera de estos gestos es "me estoy moviendo yo": desde ahí el encuadre automático
  // se calla. Van en el contenedor y en fase de captura para que valgan aunque el canvas de
  // three se quede con el evento.
  const marcarInteraccion = useCallback(() => { usuarioMovioLaCamara.current = true }, [])

  return (
    <div
      ref={boxRef}
      className="h-full w-full"
      onPointerDownCapture={marcarInteraccion}
      onWheelCapture={marcarInteraccion}
    >
      {size && size.w > 0 && size.h > 0 && (
        <ForceGraph3D<GraphNodeDatum, GraphLinkDatum>
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={data}
          // Transparente: el fondo lo pone la card, así el cuadro pertenece a la pantalla en
          // vez de ser un recuadro negro pegado encima.
          backgroundColor="rgba(0,0,0,0)"
          // `orbit`, no el `trackball` que viene por default.
          //
          // TrackballControls es el que hace que el grafo se sienta roto con un trackpad:
          // no tiene arriba ni abajo (rota sin límite y te deja el grafo de costado), no
          // amortigua, y el scroll de dos dedos le llega como un zoom a saltos. Orbit es el
          // esquema que espera cualquiera: arrastrar rota manteniendo el horizonte, dos
          // dedos hacen zoom continuo, y el paneo no pierde el centro.
          //
          // Es una prop de INICIALIZACIÓN (react-kapsule's `initPropNames`): se lee una vez
          // al construir el grafo, así que cambiarla en caliente no haría nada.
          controlType="orbit"
          showNavInfo={false}
          // 6, no el 4 por defecto: con pocos nodos un grafo de puntos chiquitos en una
          // caja de 320px se lee como ruido en vez de como una estructura.
          nodeRelSize={6}
          nodeVal={(n) => n.val}
          nodeColor={nodeColor}
          nodeLabel={(n) => n.label}
          nodeOpacity={0.95}
          {...(showLabels
            ? {
                // `nodeThreeObjectExtend` deja el punto Y le suma la etiqueta; sin eso el
                // sprite REEMPLAZA al nodo y el grafo queda hecho de texto flotando.
                nodeThreeObjectExtend: true,
                nodeThreeObject: (n: GraphNodeDatum) =>
                  spriteDeEtiqueta(n.label, vecinos && !vecinos.has(n.id) ? 'rgba(155,155,155,0.25)' : '#cfcfcf'),
              }
            : {})}
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
          // Arrastrar un nodo lo mueve; arrastrar el fondo rota la cámara. Es exactamente
          // el reparto de Obsidian, y es lo que hace que el grafo se sienta vivo en vez de
          // una foto. Estaba apagado por precaución y lo que lograba era que todo gesto
          // sobre un nodo no hiciera nada.
          enableNodeDrag
        />
      )}
    </div>
  )
}
