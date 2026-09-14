/**
 * En qué estado está un pane, para el que mira ocho a la vez.
 *
 * Hasta hoy el header sabía una sola cosa: que hubo salida (`onActivity`, con un debounce de
 * 500ms). Eso contesta "¿está vivo?". La pregunta real cuando tenés ocho agentes corriendo es
 * otra: **¿cuál me necesita?** — y son tres situaciones distintas que se veían todas igual.
 *
 * Medido contra Orca, que es el único de los productos del rubro que publica esto: sus
 * pestañas muestran "working, waiting for input, completed, o completed-but-unread". El
 * último es el más fino y el que no se me habría ocurrido: *terminó y todavía no lo viste*.
 * Es la diferencia entre un indicador que describe el proceso y uno que sabe algo sobre vos.
 */

export type EstadoDePane =
  /** Sale texto. No hay nada que hacer. */
  | 'working'
  /** Se frenó en algo que te pregunta. Es el único que te pide una acción. */
  | 'waiting'
  /** Terminó y todavía no lo miraste. Hay algo para leer, y se va a enfriar. */
  | 'unread'
  /** Quieto y ya visto. */
  | 'idle'

/**
 * Lo que hace pensar que un agente está esperando una respuesta.
 *
 * **Esto es una heurística y hay que tratarlo como tal.** No existe una señal del sistema que
 * diga "este proceso está bloqueado esperando que el humano escriba": habría que mirar el
 * estado del grupo de procesos en primer plano del tty, que es trabajo del proceso principal
 * y es distinto en cada sistema operativo. Lo que sí tenemos es lo último que el agente
 * imprimió, y los agentes que Nest soporta terminan sus preguntas de formas reconocibles.
 *
 * Por eso el estado `waiting` se muestra como una PISTA y no como un hecho, y por eso la
 * lista está acá arriba y comentada: cuando un agente cambie su forma de preguntar, esto se
 * corrige en un lugar.
 *
 * Los patrones se prueban contra el texto ya limpio de secuencias ANSI, sobre las últimas
 * líneas y no sobre todo el buffer: un "(y/n)" de hace veinte líneas no significa que esté
 * esperando ahora.
 */
const PREGUNTAS: RegExp[] = [
  // Confirmaciones de una letra: `(y/n)`, `[Y/n]`, `(yes/no)`.
  /\((?:y\/n|yes\/no)\)\s*$/i,
  /\[(?:y\/n|yes\/no)\]\s*$/i,
  // "Do you want to…", "Continue?", "Proceed?" — el agente pregunta y espera.
  /\b(?:do you want|are you sure|continue|proceed|overwrite|replace)\b[^?]*\?\s*$/i,
  // Menús numerados de eleccion: "1) … 2) …" y despues el cursor.
  /^\s*[>❯›]\s*$/m,
  // Un prompt de contraseña, que es el caso donde dejar al usuario esperando es peor.
  /\b(?:password|passphrase|token)\s*:\s*$/i,
  // Cualquier línea que termine en `?` seguida de nada: una pregunta abierta.
  /\?\s*$/,
]

/** Cuántas líneas del final se miran. Un `(y/n)` viejo no es una pregunta viva. */
const LINEAS_DE_COLA = 3

/**
 * Si la cola de la salida parece una pregunta esperando respuesta.
 *
 * `texto` tiene que venir ya sin secuencias ANSI: un `[?25h` pegado al final haría que
 * ningún patrón anclado en `$` matchee, y el detector no encontraría nunca nada.
 */
export function pareceEsperandoInput(texto: string): boolean {
  const cola = texto
    .split('\n')
    .slice(-LINEAS_DE_COLA)
    .join('\n')
    .trimEnd()
  if (cola === '') return false
  return PREGUNTAS.some((p) => p.test(cola))
}

export interface EntradaDeEstado {
  /** Está saliendo texto ahora (el `isBusy` que ya existía). */
  ocupado: boolean
  /** La cola de la salida, sin ANSI. Se ignora si `ocupado`. */
  colaDeSalida: string
  /** El pane tiene el foco ahora. */
  enfocado: boolean
  /** Si hubo salida sin leer desde la última vez que lo miraste. */
  sinLeer: boolean
}

/**
 * El estado, en un solo lugar y sin tocar el DOM ni el reloj — por eso se puede probar.
 *
 * El orden de las preguntas es la decisión de diseño: **`working` gana sobre todo** (si sale
 * texto, no está esperando aunque la última línea parezca una pregunta: lo que hay abajo del
 * scroll todavía se está escribiendo), y **`waiting` gana sobre `unread`**, porque pedirte
 * algo es más urgente que tener algo para leer.
 */
export function estadoDePane(e: EntradaDeEstado): EstadoDePane {
  if (e.ocupado) return 'working'
  if (pareceEsperandoInput(e.colaDeSalida)) return 'waiting'
  // Enfocado = lo estás mirando: no puede haber nada "sin leer" en el pane que tenés adelante.
  if (e.sinLeer && !e.enfocado) return 'unread'
  return 'idle'
}

/** Lo que el header muestra. En inglés: la app entera lo está. */
export const ETIQUETA_DE_ESTADO: Record<EstadoDePane, string> = {
  working: 'working',
  waiting: 'needs you',
  unread: 'unread',
  idle: '',
}

/**
 * El título largo, para el `title` del chip.
 *
 * `waiting` dice que es una lectura de la salida y no un hecho del sistema: si el usuario ve
 * "needs you" y el agente en realidad estaba trabajando, tiene que poder entender por qué nos
 * equivocamos en vez de dejar de creerle al indicador para siempre.
 */
export const DETALLE_DE_ESTADO: Record<EstadoDePane, string> = {
  working: 'Output is still coming in.',
  waiting: 'The last thing printed looks like a question waiting for an answer.',
  unread: 'It finished and you have not looked at it yet.',
  idle: '',
}
