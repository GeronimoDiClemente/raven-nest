// Sincronizar una vez y morirse: lo que hace el paquete portátil, que no deja procesos vivos.
//
// El §6.2 del spec lo dice así: «Sin Nest, paquete con cuenta → el paquete, con un `push` al
// final de cada operación de escritura y un `pull` perezoso al arrancar. **No corre un daemon
// de fondo**: un `npx` no deja procesos vivos, y un agente de MCP tiene un ciclo de vida corto
// y conocido.»
//
// **No reimplementa nada.** `MemoryDaemon.pull()` y `.push()` ya son públicos, así que el
// paquete arma el daemon con las mismas dependencias y simplemente NO llama a `start()`: se
// queda con las dos operaciones y ninguno de los temporizadores. Todo lo caro y delicado que
// vive ahí adentro —el merge LWW, el sellado de los sobres, el gate fail-closed del cifrado,
// el candado— sigue siendo un solo camino para los dos actores.
//
// Por eso este archivo recibe una interfaz chica y no el daemon entero: lo que hay para
// decidir acá es el ORDEN y qué contar, y eso se prueba sin levantar nada.
import type { DaemonStatus } from './memory-daemon'

/** Lo que `sincronizarUnaVez` necesita. `MemoryDaemon` lo cumple tal cual. */
export interface Sincronizador {
  pull(): Promise<void>
  push(): Promise<void>
  getStatus(): DaemonStatus
  getStatusDetail(): string | undefined
}

export type EstadoDeSync =
  /** No hay cuenta conectada: el modo local anda igual, pero no hay nube que tocar. */
  | 'sin-cuenta'
  /** Otro proceso tiene el candado — típicamente Nest abierto en esta misma máquina. */
  | 'otro-sincroniza'
  /** El daemon quedó en pausa por otro motivo (falta la clave, plan, beta…). */
  | 'pausado'
  | 'error'
  | 'sincronizado'

export interface ResultadoDeSync {
  estado: EstadoDeSync
  /** El código que dio el daemon, si lo hay. Es un CÓDIGO, no una oración: la copia la
   *  decide quien muestra, igual que en la UI de Nest. */
  detalle?: string
  bajo: boolean
  subio: boolean
  bajoError?: string
  subioError?: string
}

function mensaje(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function sincronizarUnaVez(
  s: Sincronizador,
  opts: { hayCuenta: boolean },
): Promise<ResultadoDeSync> {
  if (!opts.hayCuenta) return { estado: 'sin-cuenta', bajo: false, subio: false }

  const r: ResultadoDeSync = { estado: 'sincronizado', bajo: false, subio: false }

  // **Bajar primero, subir después**, y el orden no es estético: este proceso se muere apenas
  // termina. Las mutaciones que genera el merge del pull tienen que salir en el mismo viaje;
  // al revés se quedarían encoladas hasta la próxima corrida, que puede ser dentro de días.
  try {
    await s.pull()
    r.bajo = true
  } catch (err) {
    r.bajoError = mensaje(err)
  }

  // Se sube aunque el pull haya fallado. Lo único que puede PERDERSE es el trabajo local —
  // lo remoto ya está guardado del otro lado— así que un pull caído no es razón para dejar
  // las mutaciones locales sin intentar salir.
  try {
    await s.push()
    r.subio = true
  } catch (err) {
    r.subioError = mensaje(err)
  }

  const estado = s.getStatus()
  const detalle = s.getStatusDetail()
  if (estado === 'paused') {
    // El candado no es un error: significa que otro —casi siempre Nest, abierto acá mismo—
    // es el que sincroniza. Lo local quedó encolado y lo empuja él. Distinguirlo de las otras
    // pausas es lo que separa «no hay nada que hacer» de «te falta algo».
    return { ...r, estado: detalle === 'lock_held' ? 'otro-sincroniza' : 'pausado', detalle }
  }
  if (estado === 'error' || estado === 'plan_required') return { ...r, estado: 'error', detalle }
  return { ...r, detalle }
}
