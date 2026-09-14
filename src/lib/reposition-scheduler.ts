// Agenda las mediciones de posición del WebContentsView de un pane de browser.
//
// Vive afuera de BrowserCell.tsx por una razón concreta: la lógica de CUÁNDO medir
// es lo que decide el costo de batería de la app entera, y dentro del componente no
// se podía testear sin montar un DndContext y todo el IPC de window.browser.
//
// El WebContentsView es una capa nativa: no está en el DOM y no se mueve con él, así
// que alguien tiene que decirle dónde pararse. Un ResizeObserver no alcanza — no ve
// cambios de POSICIÓN, y reordenar panes o abrir un hermano mueve el browser sin
// redimensionarlo.
export interface RepositionSchedulerDeps {
  /** Mide el rect y emite el IPC si cambió. La dedupe es responsabilidad del caller. */
  check: () => void
  raf: (cb: (now: number) => void) => number
  cancelRaf: (id: number) => void
  setTimer: (cb: () => void, ms: number) => number
  clearTimer: (id: number) => void
  /** Cada cuánto medir con el pane quieto. Default 100ms (~10 Hz). */
  idleMs?: number
}

export interface RepositionScheduler {
  /**
   * `true` mientras algo esté MOVIENDO el pane sin redimensionarlo (drag en curso,
   * zoom). Ahí el view nativo tiene que seguir al DOM frame a frame o se ve corrido.
   */
  setMoving(moving: boolean): void
  stop(): void
}

export function startRepositionScheduler(deps: RepositionSchedulerDeps): RepositionScheduler {
  const idleMs = deps.idleMs ?? 100
  let rafId = 0
  let timerId = 0
  let moving = false
  let stopped = false

  const cancelarPendiente = () => {
    if (rafId) { deps.cancelRaf(rafId); rafId = 0 }
    if (timerId) { deps.clearTimer(timerId); timerId = 0 }
  }

  // El punto de todo este módulo: en reposo se agenda un TIMER, no un frame.
  //
  // Antes el tick se re-armaba con requestAnimationFrame en cada frame y sólo
  // throttleaba el TRABAJO a 10 Hz. Eso arregla la mitad del problema: el
  // getBoundingClientRect deja de correr 60 veces por segundo, pero el callback de
  // frame sigue vivo, y un rAF vivo le dice al compositor "esta página está
  // animando". El compositor entonces produce frames sin parar aunque no haya nada
  // que pintar, y eso despierta a la GPU y al WindowServer. Medido con un reloj
  // falso: 63 frames por segundo pedidos con el pane quieto.
  const agendar = () => {
    if (stopped) return
    if (moving) rafId = deps.raf(alFrame)
    else timerId = deps.setTimer(alTimer, idleMs)
  }

  const alFrame = () => { rafId = 0; deps.check(); agendar() }
  const alTimer = () => { timerId = 0; deps.check(); agendar() }

  agendar()

  return {
    setMoving(next: boolean) {
      if (next === moving) return
      moving = next
      // Se re-agenda en el acto en vez de esperar el vencimiento del timer: si el
      // cambio a `moving` tardara hasta `idleMs` en notarse, el arranque de un drag
      // se vería corrido los primeros ~6 frames.
      cancelarPendiente()
      agendar()
    },
    stop() {
      stopped = true
      cancelarPendiente()
    },
  }
}
