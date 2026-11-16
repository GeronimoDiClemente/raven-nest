// Junta la salida del PTY de un pane SIN foco y se la pasa a xterm a ~10 Hz.
//
// xterm pinta una vez por frame en que le llegó algo. Un agente trabajando redibuja su TUI
// ~20 veces por segundo, así que cada pane a la vista con un agente activo son ~20 pintadas
// por segundo de renderer y GPU, lo mires o no. Medido el 2026-11-06 con un redibujo tipo
// Ink (40 líneas, un write por frame, 20 Hz): 16.6% de renderer+GPU con WebGL por pane.
//
// El pane enfocado escribe directo: ahí está el eco de lo que tipeás y cualquier demora se
// nota. Los demás juntan lo que llega y lo escriben de una vez cada `intervaloMs`; xterm
// procesa el lote entero y pinta UNA vez. El contenido es el mismo, en el mismo orden: sólo
// cambia cuándo se ve.
//
// Vive afuera de TerminalPane.tsx para poder testearlo con un reloj falso.

export interface EscrituraDiferidaDeps {
  escribir: (data: string) => void
  setTimer: (cb: () => void, ms: number) => number
  clearTimer: (id: number) => void
  /** Cada cuánto vaciar con el pane sin foco. Default 100ms (~10 Hz). */
  intervaloMs?: number
}

export interface EscrituraDiferida {
  escribir(data: string): void
  /** `true` con el pane enfocado: vacía lo pendiente y de ahí en más escribe directo. */
  setInmediato(inmediato: boolean): void
  /** Descarta lo pendiente sin escribirlo. Para el desmontaje: el terminal ya no existe, y
   *  el buffer del PTY en el main lo vuelve a mandar si el pane se monta de nuevo. */
  stop(): void
}

export function crearEscrituraDiferida(deps: EscrituraDiferidaDeps, inmediatoInicial = true): EscrituraDiferida {
  const intervaloMs = deps.intervaloMs ?? 100
  let inmediato = inmediatoInicial
  let pendiente: string[] = []
  let timerId = 0
  let parado = false

  const vaciar = () => {
    if (timerId) { deps.clearTimer(timerId); timerId = 0 }
    if (pendiente.length === 0) return
    const lote = pendiente.join('')
    pendiente = []
    deps.escribir(lote)
  }

  return {
    escribir(data) {
      if (parado) return
      if (inmediato) {
        // Lo que quedó juntado va primero: el orden de la salida no se negocia.
        vaciar()
        deps.escribir(data)
        return
      }
      pendiente.push(data)
      // El timer se arma con el PRIMER trozo, no se re-arma con cada uno: con salida
      // continua, re-armarlo la postergaría para siempre.
      if (!timerId) timerId = deps.setTimer(() => { timerId = 0; vaciar() }, intervaloMs)
    },
    setInmediato(valor) {
      inmediato = valor
      if (valor && !parado) vaciar()
    },
    stop() {
      parado = true
      if (timerId) { deps.clearTimer(timerId); timerId = 0 }
      pendiente = []
    },
  }
}
