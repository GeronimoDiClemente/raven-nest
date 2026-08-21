/**
 * Compuerta de resizes del PTY mientras el layout está en movimiento.
 *
 * Arrastrar un pane o un divisor lo hace pasar por formas degeneradas (15
 * columnas, 4 filas) que no corresponden a ningún layout real. Aplicarlas hace
 * que la TUI repinte a cada ancho intermedio: el banner de arranque se
 * multiplica y queda texto envuelto a anchos que ya no existen.
 *
 * Mientras hay una supresión activa, el xterm local sigue reflowéandose (para
 * que se vea bien), pero NO se le manda el tamaño al proceso. Al cerrarse la
 * última supresión se avisa una sola vez para mandar el tamaño ya asentado.
 *
 * Es un contador, no un booleano: arrastrar un pane y soltar sobre un divisor
 * pueden solaparse, y el primero en terminar no debe destapar al otro.
 */
let suppressions = 0
const settledListeners = new Set<() => void>()

export function beginResizeSuppression(): void {
  suppressions++
}

export function endResizeSuppression(): void {
  if (suppressions === 0) return
  suppressions--
  if (suppressions === 0) {
    for (const fn of settledListeners) fn()
  }
}

export function isResizeSuppressed(): boolean {
  return suppressions > 0
}

/** Se llama cuando el layout se asienta, para mandar el tamaño final una vez. */
export function onResizeSettled(fn: () => void): () => void {
  settledListeners.add(fn)
  return () => settledListeners.delete(fn)
}

/** Solo para tests: vuelve al estado inicial. */
export function resetResizeGate(): void {
  suppressions = 0
  settledListeners.clear()
}
