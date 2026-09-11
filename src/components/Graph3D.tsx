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
function spriteDeEtiqueta(texto: string, color: string, radioDelNodo: number): Sprite {
  const recortado = texto.length > 24 ? `${texto.slice(0, 23)}…` : texto
  // `escala` es sólo resolución de la textura: se dibuja al doble y después se achica, para
  // que el texto no salga pixelado cuando la cámara se acerca.
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
  // El sprite vive en unidades de MUNDO, así que su tamaño se mide contra el grafo y no
  // contra la pantalla. Con el divisor anterior (2.2) un título de 24 caracteres medía ~75
  // unidades de ancho sobre un grafo que se extiende ~92: cada etiqueta era casi tan ancha
  // como el grafo entero. No se notaba mientras la cámara quedaba lejos —todo se veía chico
  // por igual— y saltó a la vista apenas el encuadre empezó a funcionar.
  const REDUCCION = 4.2
  const anchoMundo = canvas.width / escala / REDUCCION
  const altoMundo = canvas.height / escala / REDUCCION
  sprite.scale.set(anchoMundo, altoMundo, 1)
  // Arriba del nodo, no encima. `nodeThreeObjectExtend` deja el sprite centrado en el mismo
  // punto que la esfera, así que el texto se dibujaba ATRAVESANDO el nodo. El desplazamiento
  // sale del RADIO del nodo, que cambia con su grado: uno fijo alcanzaba para los nodos
  // chicos y dejaba el título adentro de los grandes, que son justamente los importantes.
  sprite.position.set(0, radioDelNodo + altoMundo, 0)
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
/** El radio de un nodo es `cbrt(val) * NODE_REL_SIZE`; la etiqueta lo necesita para saber
 *  cuánto correrse hacia arriba, así que vive acá y no inline. Era 6, que dejaba el diámetro
 *  en ~20% del ancho del grafo: con ocho memorias se veían ocho pelotas y el título no
 *  entraba en ningún lado. */
const NODE_REL_SIZE = 4.5

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
    // los nodos terminan ocupando como un cuarto de la caja y el resto es vacío.
    //
    // Las posiciones salen de los nodos porque la simulación los muta EN EL LUGAR: los
    // objetos que le pasamos son los mismos que recibe el motor.
    const conPos = (nodes as Array<Node3D & { x?: number; y?: number; z?: number }>)
      .filter((n) => typeof n.x === 'number')
    if (conPos.length === 0) return

    const ejes = (k: 'x' | 'y' | 'z') => {
      const v = conPos.map((n) => n[k] ?? 0)
      return { min: Math.min(...v), max: Math.max(...v) }
    }
    const ex = ejes('x'), ey = ejes('y'), ez = ejes('z')
    const cx = (ex.min + ex.max) / 2
    const cy = (ey.min + ey.max) / 2
    const cz = (ez.min + ez.max) / 2

    // El encuadre se calcula sobre la caja PROYECTADA, no sobre el radio de la esfera que
    // contiene a los nodos.
    //
    // Con la esfera, medido en la app: la simulación dispersa mucho más en profundidad que a
    // lo ancho —x=92, y=85, z=231 con ocho memorias— o sea que el grafo es una aguja apuntando
    // a la cámara. El radio quedaba dominado por la Z, que no se ve, y la cámara se alejaba
    // para encuadrar una esfera cuya sombra en pantalla medía 128×95 px dentro de una caja de
    // 1400×520. Se veía un puñado de puntos en el medio de un rectángulo vacío.
    //
    // El eje de la cámara es +Z (mira desde `cz + distancia` hacia `cz`), así que los ejes
    // del mundo y los de la cámara coinciden: el alto en pantalla lo da Y, el ancho X, y Z es
    // profundidad — que no se encuadra, se suma a la distancia para no meter la cámara adentro
    // del grafo.
    const semiAlto = Math.max((ey.max - ey.min) / 2, 1)
    const semiAncho = Math.max((ex.max - ex.min) / 2, 1)

    // El fov se lee de la cámara en vez de asumirse. Estaba escrito 60° y el real es 50°:
    // un encuadre calculado sobre un fov que no es el de la cámara está mal por un factor
    // fijo, y encima en silencio.
    const cam = (fg as unknown as { camera?: () => { fov?: number; aspect?: number } }).camera?.()
    const fov = cam?.fov ?? 50
    const aspect = cam?.aspect && cam.aspect > 0 ? cam.aspect : 1
    const tanMitad = Math.tan((fov * Math.PI) / 360)

    // El margen tiene que dar lugar al nodo Y a su etiqueta, que sobresalen de la caja que se
    // mide entre centros.
    const MARGEN = 1.35
    const porAlto = (semiAlto * MARGEN) / tanMitad
    const porAncho = (semiAncho * MARGEN) / (tanMitad * aspect)
    // El mayor de los dos: es el que hace entrar la caja entera. En un cuadro ancho manda el
    // alto, que es justo el caso de este panel.
    const profundidadFrontal = ez.max - cz
    const distancia = Math.max(porAlto, porAncho) + profundidadFrontal

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
          nodeRelSize={NODE_REL_SIZE}
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
                  spriteDeEtiqueta(
                    n.label,
                    vecinos && !vecinos.has(n.id) ? ETIQUETA_ATENUADA : ETIQUETA,
                    // Cómo three calcula el radio de la esfera de un nodo: la raíz cúbica del
                    // `val` por `nodeRelSize` (el área/volumen representa la magnitud).
                    Math.cbrt(n.val) * NODE_REL_SIZE,
                  ),
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
