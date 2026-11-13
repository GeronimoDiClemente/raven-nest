// Un intervalo que sólo corre mientras la ventana se VE.
//
// El motivo es el número que macOS muestra en la pestaña Energía del Monitor de
// Actividad, que no es %CPU: pesa fuerte los DESPERTARES. Un timer que se dispara cada
// 5 segundos gasta casi nada de CPU y aun así saca al procesador del estado dormido 720
// veces por hora, toda la noche, para refrescar unos chips que nadie está mirando.
//
// Por eso el gate es visibilidad y no foco: si estás tipeando en otra app pero ves Nest
// al costado, los chips tienen que seguir vivos. Si la ventana está minimizada o tapada,
// no hay nadie del otro lado.
//
// **Esto es para lo cosmético solamente.** Un poll cuyo resultado el usuario tiene que
// enterarse igual —notificaciones de GitHub, mensajes del chat de equipo— NO va acá: ahí
// enterarse tarde es el bug, y ahorrar el despertar no lo justifica.
//
// Al volver a verse se tickea EN EL ACTO y no en el próximo vencimiento: lo que quedó en
// pantalla es de antes de ocultarse, y esperar el intervalo completo mostraría datos
// viejos justo en el momento en que el usuario vuelve a mirar. Eso también hace que el
// gate se auto-cure si Chromium se equivoca y marca oculta una ventana que se ve.
export interface IntervaloVisibleDeps {
  /** El trabajo periódico. */
  tick: () => void
  setTimer: (cb: () => void, ms: number) => number
  clearTimer: (id: number) => void
  /** Suscribe a los cambios de visibilidad. Devuelve el desuscriptor. */
  alCambiarVisibilidad: (cb: () => void) => () => void
  /** Si la ventana se ve AHORA. */
  seVe: () => boolean
  /** Cada cuánto tickear mientras se vea. */
  ms: number
}

export interface IntervaloVisible {
  stop(): void
}

export function startIntervaloVisible(deps: IntervaloVisibleDeps): IntervaloVisible {
  let timerId = 0
  let corriendo = false
  let detenido = false

  const cancelar = () => {
    if (timerId) { deps.clearTimer(timerId); timerId = 0 }
  }

  const agendar = () => {
    if (detenido || !corriendo) return
    timerId = deps.setTimer(alVencer, deps.ms)
  }

  const alVencer = () => {
    timerId = 0
    deps.tick()
    agendar()
  }

  const arrancar = () => {
    corriendo = true
    deps.tick()
    agendar()
  }

  const frenar = () => {
    corriendo = false
    cancelar()
  }

  const desuscribir = deps.alCambiarVisibilidad(() => {
    if (detenido) return
    const seVe = deps.seVe()
    // Sin este guard, un aviso que repite el estado actual volvería a tickear y a agendar
    // un timer más, y quedarían dos corriendo en paralelo.
    if (seVe === corriendo) return
    if (seVe) arrancar()
    else frenar()
  })

  if (deps.seVe()) arrancar()

  return {
    stop() {
      detenido = true
      corriendo = false
      cancelar()
      desuscribir()
    },
  }
}
