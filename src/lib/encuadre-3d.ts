// La matemática del encuadre y de la gravedad del grafo 3D, sin three ni React, para poder
// testearla sola. La usa `Graph3D.tsx`.

interface ConPosicion {
  x?: number
  y?: number
  z?: number
}

export interface Rango {
  min: number
  max: number
}

export interface Caja {
  x: Rango
  y: Rango
  z: Rango
}

/**
 * Qué fracción de nodos se deja afuera de CADA punta de cada eje al encuadrar.
 *
 * Medido el 2026-10-01 con las 110 memorias reales: los grupos sueltos y las cadenas de un
 * solo hilo quedaban a varias veces la distancia del cúmulo principal, y como la cámara
 * encuadraba la caja ENTERA, el grafo ocupaba un tercio del ancho y el resto era vacío. Un
 * nodo que queda fuera de cuadro se ve rotando o con un scroll; una caja vacía no se arregla.
 */
const RECORTE = 0.05

/**
 * La caja de los nodos sin sus extremos, eje por eje. `null` si ningún nodo tiene posición
 * todavía (la simulación no arrancó).
 *
 * Con pocos nodos no se recorta nada: con veinte o menos, el 5% redondea a cero, y cada nodo
 * es una parte demasiado grande del grafo para dejarlo afuera.
 */
export function cajaSinExtremos(nodos: readonly ConPosicion[]): Caja | null {
  const conPos = nodos.filter((n) => typeof n.x === 'number')
  if (conPos.length === 0) return null
  const descartar = Math.floor(conPos.length * RECORTE)
  const rango = (k: 'x' | 'y' | 'z'): Rango => {
    const v = conPos.map((n) => n[k] ?? 0).sort((a, b) => a - b)
    return { min: v[descartar], max: v[v.length - 1 - descartar] }
  }
  return { x: rango('x'), y: rango('y'), z: rango('z') }
}

interface NodoSimulado extends ConPosicion {
  vx?: number
  vy?: number
  vz?: number
  fx?: number | null
}

export interface FuerzaD3 {
  (alpha: number): void
  initialize?: (nodos: NodoSimulado[]) => void
}

/**
 * Una gravedad suave hacia el origen, la «center force» de Obsidian.
 *
 * La `center` que trae d3 sólo traslada el grafo entero para que su promedio quede en el
 * origen: no acerca nada. Sin una fuerza que tire de cada nodo, los grupos que no tienen
 * ninguna arista con el resto se van empujados por la repulsión hasta donde ella se apaga, y
 * son los que alejan la cámara. Esta tira proporcional a la distancia, así que al cúmulo
 * principal casi no lo toca y a los sueltos los trae.
 *
 * Un nodo fijado (`fx`, lo pone el arrastre) no se toca: lo está sosteniendo el usuario.
 */
export function fuerzaHaciaElCentro(intensidad: number): FuerzaD3 {
  let nodos: NodoSimulado[] = []
  const fuerza: FuerzaD3 = (alpha: number) => {
    const k = intensidad * alpha
    if (k === 0) return
    for (const n of nodos) {
      if (n.fx != null) continue
      n.vx = (n.vx ?? 0) - (n.x ?? 0) * k
      n.vy = (n.vy ?? 0) - (n.y ?? 0) * k
      n.vz = (n.vz ?? 0) - (n.z ?? 0) * k
    }
  }
  fuerza.initialize = (ns) => { nodos = ns }
  return fuerza
}
