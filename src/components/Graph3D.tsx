// El render 3D, compartido por los dos grafos de la app: el de memorias y el de ramas.
//
// **Este archivo es el ÚNICO que importa `react-force-graph-3d`**, y por eso es el que hay
// que cargar con `import()` diferido. Medido el 2026-09-11: importarlo arriba suma 1379.8 KB
// crudos al arranque; detrás de un `import()` suma 1.4 KB (la tabla completa está en
// `docs/superpowers/specs/2026-09-11-memories-legible-design.md`). Si aparece un segundo
// import estático en cualquier lado, el chunk vuelve al arranque y nadie se entera.
//
// Es genérico a propósito: recibe nodos y aristas ya resueltos —color, tamaño y estilo de
// línea incluidos— y no sabe nada de memorias ni de ramas. Lo que aporta es lo difícil y lo
// que no conviene tener dos veces: medir el contenedor, encuadrar la cámara, los controles,
// el atenuado del vecindario y las etiquetas.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d'
import { CanvasTexture, Sprite, SpriteMaterial } from 'three'

export interface Node3D {
  id: string
  label: string
  color: string
  /** Área relativa del nodo. */
  val: number
}

export interface Link3D {
  source: string
  target: string
  width: number
  color: string
  /** 0 = recta. Curvar es cómo se distinguen dos relaciones distintas sin usar color. */
  curvature: number
  /** Largo de la punta de flecha; 0 = sin flecha, o sea no dirigida. */
  arrowLength: number
}

interface Props {
  nodes: Node3D[]
  links: Link3D[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /**
   * Dibujar la etiqueta al lado de cada nodo. Lo decide quien lo usa, normalmente por
   * CANTIDAD: con muchos nodos las etiquetas se pisan entre sí y dejan de ser información.
   * Es el equivalente del `text fade threshold` de Obsidian, que hace lo mismo pero por
   * distancia de cámara.
   */
  showLabels: boolean
  /** Para el aviso de consola cuando el ref no llega — así dice cuál de los dos grafos es. */
  nombre: string
}

/**
 * La etiqueta de un nodo, como sprite de canvas.
 *
 * Se dibuja a 2x y se escala a la mitad para que no se vea pixelada en pantallas retina, y
 * el texto se recorta: una etiqueta larga al lado de cada punto tapa el grafo. El texto
 * completo sigue estando en el tooltip.
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

const ATENUADO_NODO = 'rgba(120, 120, 120, 0.15)'
const ATENUADO_ARISTA = 'rgba(120, 120, 120, 0.06)'
const ETIQUETA = '#cfcfcf'
const ETIQUETA_ATENUADA = 'rgba(155,155,155,0.25)'

export default function Graph3D({ nodes, links, selectedId, onSelect, showLabels, nombre }: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const fgRef = useRef<ForceGraphMethods<Node3D, Link3D> | undefined>(undefined)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  /**
   * Si el usuario ya movió la cámara, el encuadre automático NO vuelve a tocarla.
   *
   * Sin esto el grafo se siente roto: la simulación se aquieta a los 4s (`cooldownTime`) y
   * ahí dispara `onEngineStop`, que reencuadra con una animación de 400ms. Si en ese momento
   * estabas arrastrando o haciendo zoom, la cámara te la sacaba de las manos.
   */
  const usuarioMovioLaCamara = useRef(false)

  // `graphData` tiene que ser un objeto estable: react-force-graph reinicia la simulación
  // cada vez que cambia su identidad, así que armarlo inline lo reiniciaría en cada render.
  const graphData = useMemo(() => ({ nodes, links }), [nodes, links])

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

  // Vecinos directos del seleccionado. Con algo seleccionado, todo lo demás se atenúa: es lo
  // que convierte al grafo en una vista de otra cosa en vez de un adorno.
  const vecinos = useMemo(() => {
    if (!selectedId) return null
    const s = new Set<string>([selectedId])
    for (const l of links) {
      const a = endId(l.source as never)
      const b = endId(l.target as never)
      if (a === selectedId && b) s.add(b)
      if (b === selectedId && a) s.add(a)
    }
    return s
  }, [selectedId, links])

  const nodeColor = useCallback((node: Node3D) => {
    if (!vecinos) return node.color
    return vecinos.has(node.id) ? node.color : ATENUADO_NODO
  }, [vecinos])

  const linkColor = useCallback((link: Link3D) => {
    if (!vecinos) return link.color
    const a = endId(link.source as never)
    const b = endId(link.target as never)
    return a === selectedId || b === selectedId ? link.color : ATENUADO_ARISTA
  }, [vecinos, selectedId])

  const encuadrar = useCallback(() => {
    if (usuarioMovioLaCamara.current) return
    const fg = fgRef.current
    if (!fg) {
      // Si esto se ve, el ref no llegó — el mismo síntoma de la trampa de React 18 contra
      // los primitivos de React 19 que ya mordió en esta rama (ver RECETA-MIGRACION-UI.md).
      // react-kapsule, que es lo que envuelve a ForceGraph3D, SÍ usa forwardRef, así que
      // debería llegar; el aviso está para que un cambio de versión no lo rompa en silencio.
      console.warn(`[Graph3D:${nombre}] sin ref: el grafo no se va a encuadrar solo`)
      return
    }

    // Encuadre calculado a mano en vez de `zoomToFit()`.
    //
    // zoomToFit existe y el ref llega, pero con estos grafos deja la cámara demasiado lejos:
    // los nodos terminan ocupando como un cuarto de la caja y el resto es vacío. Calcular la
    // esfera que contiene a los nodos y ubicar la cámara a la distancia que la hace entrar
    // da un resultado predecible y ajustable.
    //
    // Las posiciones salen de los nodos porque la simulación los muta EN EL LUGAR: los
    // objetos que le pasamos son los mismos que recibe el motor.
    const conPos = (nodes as Array<Node3D & { x?: number; y?: number; z?: number }>)
      .filter((n) => typeof n.x === 'number')
    if (conPos.length === 0) return

    const cx = conPos.reduce((a, n) => a + (n.x ?? 0), 0) / conPos.length
    const cy = conPos.reduce((a, n) => a + (n.y ?? 0), 0) / conPos.length
    const cz = conPos.reduce((a, n) => a + (n.z ?? 0), 0) / conPos.length
    const radio = Math.max(
      ...conPos.map((n) => Math.hypot((n.x ?? 0) - cx, (n.y ?? 0) - cy, (n.z ?? 0) - cz)),
      1,
    )

    // fov 60° => la mitad del alto visible a distancia d es d * tan(30°). Se pide que el
    // radio entre con un margen, y se pone un piso para que un grafo de dos nodos no termine
    // con la cámara adentro de una esfera.
    const MARGEN = 1.2
    const distancia = Math.max((radio * MARGEN) / Math.tan((30 * Math.PI) / 180), 60)

    fg.cameraPosition({ x: cx, y: cy, z: cz + distancia }, { x: cx, y: cy, z: cz }, 400)
  }, [nodes, nombre])

  useEffect(() => {
    // Un conjunto de datos nuevo sí merece reencuadre: es otro grafo, y dejarlo con la cámara
    // del anterior lo deja fuera de cuadro. Lo que no se pisa es un encuadre que el usuario
    // hizo sobre ESTE grafo.
    usuarioMovioLaCamara.current = false
    const t = setTimeout(encuadrar, 900)
    return () => clearTimeout(t)
  }, [graphData, encuadrar])

  const handleNodeClick = useCallback((node: Node3D) => {
    // Click en el nodo ya seleccionado = deseleccionar. Sin esto no hay forma de volver a ver
    // el grafo entero sin ir a buscar el fondo del canvas.
    onSelect(node.id === selectedId ? null : node.id)
  }, [onSelect, selectedId])

  // Cualquiera de estos gestos es "me estoy moviendo yo": desde ahí el encuadre automático se
  // calla. Van en el contenedor y en fase de captura para que valgan aunque el canvas de
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
        <ForceGraph3D<Node3D, Link3D>
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={graphData}
          // Transparente: el fondo lo pone la card, así el cuadro pertenece a la pantalla en
          // vez de ser un recuadro negro pegado encima.
          backgroundColor="rgba(0,0,0,0)"
          // `orbit`, no el `trackball` que viene por default.
          //
          // TrackballControls es el que hace que el grafo se sienta roto con un trackpad: no
          // tiene arriba ni abajo (rota sin límite y te deja el grafo de costado), no
          // amortigua, y el scroll de dos dedos le llega como un zoom a saltos. Orbit es el
          // esquema que espera cualquiera: arrastrar rota manteniendo el horizonte, dos dedos
          // hacen zoom continuo, y el paneo no pierde el centro.
          //
          // Es una prop de INICIALIZACIÓN (react-kapsule's `initPropNames`): se lee una vez al
          // construir el grafo, así que cambiarla en caliente no haría nada.
          controlType="orbit"
          showNavInfo={false}
          // 6, no el 4 por defecto: con pocos nodos un grafo de puntos chiquitos en una caja
          // acotada se lee como ruido en vez de como una estructura.
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
                nodeThreeObject: (n: Node3D) =>
                  spriteDeEtiqueta(n.label, vecinos && !vecinos.has(n.id) ? ETIQUETA_ATENUADA : ETIQUETA),
              }
            : {})}
          linkColor={linkColor}
          linkWidth={(l) => l.width}
          linkCurvature={(l) => l.curvature}
          linkDirectionalArrowLength={(l) => l.arrowLength}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={(l) => l.color}
          onNodeClick={handleNodeClick}
          // Click en el vacío deselecciona.
          onBackgroundClick={() => onSelect(null)}
          // Menos repulsión que el default: en una caja acotada, la repulsión fuerte empuja
          // los nodos contra los bordes y deja el centro vacío.
          d3VelocityDecay={0.35}
          // La simulación se frena sola. Un grafo que nunca se aquieta parece vivo un rato y
          // después molesta, y encima deja la GPU al 100% en una app que ya corre terminales.
          cooldownTime={4000}
          onEngineStop={encuadrar}
          // Arrastrar un nodo lo mueve; arrastrar el fondo rota la cámara. Mismo reparto que
          // Obsidian, y es lo que hace que el grafo se sienta vivo en vez de una foto.
          enableNodeDrag
        />
      )}
    </div>
  )
}
