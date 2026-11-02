// Spec 2026-11-02 §3: lo que hace el main de Nest con el resultado de `asegurarCifrado` —
// guardar la maestra, poner el hasher, y dejar el store al día con la época. Vive fuera de
// main.ts para poder probarlo: main.ts sólo le pasa sus variables por `deps`.
//
// Dos cosas que salieron de la review final y por las que esto existe aparte:
//
// - F9: si la cuenta cambia MIENTRAS `asegurarCifrado` espera la red, el resultado es de la
//   cuenta anterior. Escribirlo pondría la maestra de A en las claves de B y la guardaría en
//   la partición de B. Se descarta sin tocar nada.
// - F4: builds anteriores marcaron como terminales filas que el servidor rechazó con
//   `encryption_required`, y ésas nunca llegaron a la nube, así que `plaintext_pending` no las
//   ve y el re-upload automático por status no corre por ellas. Al conseguir la maestra se
//   re-encolan los borrados rechazados y corre UN re-upload (el mismo "una vez por sesión"
//   que dispara `onPlaintextPending`, así que no se duplican).
import type { ResultadoDeAsegurar } from './asegurar-cifrado'

export type CifradoAlConectar =
  | { estado: 'lista' }
  | { estado: 'activada'; recoveryCode: string; aviso: string | null }
  | { estado: 'esperando-autorizacion'; huella: string }
  | { estado: 'sin-estado'; detalle: string }

export interface DepsDeAsegurarEnElMain {
  /** La cuenta para la que están cargadas las claves AHORA (`cuentaDeLasClaves` de main.ts). */
  cuentaActual: () => string | null
  asegurar: () => Promise<ResultadoDeAsegurar>
  /** Pone la maestra nueva en las claves en memoria. */
  tomarMaestra: (master: string, keyEpoch: number) => void
  /** Persiste las claves. Puede tirar (safeStorage que no abre). */
  guardarClaves: () => void
  guardarCodigoPendiente: (recoveryCode: string) => void
  aplicarHasher: () => void
  store: {
    backfillTopicHmacs: () => void
    rememberKeyEpoch: (epoch: number) => void
    resetPullCursors: () => void
    clearUndecryptable: () => void
    reencolarRechazadosPorCifrado: () => number
  }
  /** El re-upload automático; el que llama respeta el "una vez por sesión". */
  reuploadUnaVez: () => void
}

export const CUENTA_CAMBIO_DURANTE_ASEGURAR =
  'The account changed while encryption was being set up. Try again.'

export async function asegurarEnElMain(d: DepsDeAsegurarEnElMain): Promise<CifradoAlConectar> {
  const cuentaAlEmpezar = d.cuentaActual()
  const r = await d.asegurar()
  if (r.estado === 'esperando-autorizacion' || r.estado === 'sin-estado') return r
  if (r.estado === 'lista' && !r.nueva) return { estado: 'lista' }

  // F9: lo de abajo escribe claves y las guarda en la partición de la cuenta ACTUAL. Si ya no
  // es la que pidió, esta maestra no es suya. Ni el código de recuperación se guarda: dárselo
  // a B haría que el usuario guarde el código de A como el de B. La maestra de A ya quedó
  // publicada en el servidor; al volver a A, `asegurar` la adopta como a cualquier otra.
  if (d.cuentaActual() !== cuentaAlEmpezar) {
    return { estado: 'sin-estado', detalle: CUENTA_CAMBIO_DURANTE_ASEGURAR }
  }

  d.tomarMaestra(r.master, r.keyEpoch)
  // Antes de cualquier paso que pueda lanzar: si algo de abajo falla y `memory:connect`
  // rechaza, el código sigue disponible por `memory:encryption:pendingRecoveryCode`.
  if (r.estado === 'activada') d.guardarCodigoPendiente(r.recoveryCode)
  let aviso: string | null = null
  try {
    d.guardarClaves()
  } catch (err) {
    aviso = 'Encryption is on, but the key could not be saved on this machine: ' +
      `${err instanceof Error ? err.message : String(err)}. Save the recovery code now — ` +
      'it is the only thing that will be able to recover your memories.'
  }
  d.aplicarHasher()
  d.store.backfillTopicHmacs()
  d.store.rememberKeyEpoch(r.keyEpoch)
  if (r.estado === 'lista') {
    d.store.resetPullCursors()
    d.store.clearUndecryptable()
  }
  // F4: con la maestra en la mano, lo que un build viejo dio por perdido vuelve a la cola y
  // se re-sube todo sellado. Después de resetear los cursores, no antes: es el mismo orden que
  // el re-upload por status, que corre con el store ya al día.
  d.store.reencolarRechazadosPorCifrado()
  d.reuploadUnaVez()
  return r.estado === 'lista' ? { estado: 'lista' } : { estado: 'activada', recoveryCode: r.recoveryCode, aviso }
}
