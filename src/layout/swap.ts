// Intercambia (NO desplaza) dos posiciones de un array, devolviendo una copia.
// Para layouts 2D de slots fijos: soltar A sobre B los INTERCAMBIA y deja las
// demás quietas. `arrayMove` (ver reorder.ts) en cambio desplaza el rango y
// cascadea a las del medio — no es lo que uno espera al mover un pane a otro
// slot. Ver #2 del drag.
export function swap<T>(arr: T[], i: number, j: number): T[] {
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length || i === j) return arr
  const out = arr.slice()
  const tmp = out[i]
  out[i] = out[j]
  out[j] = tmp
  return out
}
