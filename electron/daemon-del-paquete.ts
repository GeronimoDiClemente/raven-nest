// El `MemoryDaemon` del paquete portátil: las MISMAS dependencias que arma `main.ts`, salidas
// de lo que el paquete tiene en vez de lo que tiene la app.
//
// | dependencia | en Nest (`main.ts`) | en el paquete |
// |---|---|---|
// | token, deviceId | `loadMemoryToken`, estado de conexión | `leerCredencial` (lo guardó `login`) |
// | claves | `ensureKeyMaterial` con `safeStorage` | `loadKeyMaterial` con el llavero del sistema |
// | candado | `tomarCandadoDeSync` al lado de la base | igual |
// | gate de cifrado | `store.knownKeyEpoch() > 0` | igual |
//
// **El gate es la parte que no se negocia.** `isEncryptionExpected` es lo que impide subir en
// claro a una cuenta cifrada desde una máquina que todavía no tiene la maestra — que es
// EXACTAMENTE el estado de un paquete recién logueado y sin autorizar. Se lee de la base, no
// de la red, igual que en la app: el daemon lo actualiza con el `key_epoch` de cada status.
//
// Las claves se CARGAN, no se generan: generar el par de dispositivo es parte del
// enrolamiento (`login`), y hacerlo de rebote acá dejaría un par que nadie publicó.
import { MemoryDaemon, type MemoryDaemonDeps } from './memory-daemon'
import type { MemoryStore } from './memory-store'
import type { SafeStorageLike } from './memory-key-store'
import { loadKeyMaterial } from './memory-key-store'
import { leerCredencial } from './credencial-del-paquete'
import { deriveKeys, hmacTopicKey } from './memory-crypto'
import { tomarCandadoDeSync, lockPathParaBase, candadoDepsDelProceso } from './memory-sync-lock'

export interface EntradaDelDaemonDelPaquete {
  store: MemoryStore
  dbPath: string
  /** Donde viven la credencial y `keys.bin`: el home del usuario. */
  home: string
  /** `NEST_MEMORY_SYNC_URL`, o null si no está configurado. */
  baseUrl: string | null
  safe: SafeStorageLike
  fetchImpl?: typeof fetch
}

export interface DaemonDelPaquete {
  deps: MemoryDaemonDeps
  /** Hay servicio Y credencial: si no, no hay nube que tocar y el modo local anda igual. */
  hayCuenta: boolean
}

export function depsDelDaemonDelPaquete(e: EntradaDelDaemonDelPaquete): DaemonDelPaquete {
  // Sin llavero no hay credencial legible ni claves: es el modo local puro, que es la falla
  // segura (ver llavero-del-sistema.ts).
  const conLlavero = e.safe.isEncryptionAvailable()
  const credencial = conLlavero ? leerCredencial(e.home, e.safe) : null
  const claves = conLlavero ? loadKeyMaterial(e.home, null, e.safe) : null
  const envelope = claves?.master
    ? { keys: deriveKeys(Buffer.from(claves.master, 'base64')), keyEpoch: claves.keyEpoch }
    : null

  // Lo mismo que hace `recargarClavesDeMemoria` en main.ts: con la maestra, el store escribe
  // `topic_key_hmac` y las filas que suben no llevan el tema en claro.
  e.store.setTopicHasher(envelope ? (p, sc, t) => hmacTopicKey(envelope.keys, p, sc, t) : null)

  const deps: MemoryDaemonDeps = {
    store: e.store,
    getSyncBaseUrl: () => e.baseUrl,
    getToken: () => credencial?.token ?? null,
    getDeviceId: () => credencial?.deviceId ?? null,
    // Un `npx` no tiene a quién preguntarle si hay red: lo averigua el fetch, y el daemon ya
    // sabe tratar un fetch caído.
    isOnline: () => true,
    getEnvelopeContext: () => envelope,
    isEncryptionExpected: () => e.store.knownKeyEpoch() > 0,
    adquirirCandado: () => tomarCandadoDeSync(lockPathParaBase(e.dbPath), candadoDepsDelProceso()),
    ...(e.fetchImpl ? { fetchImpl: e.fetchImpl } : {}),
  }
  return { deps, hayCuenta: !!e.baseUrl && !!credencial }
}

export function armarDaemonDelPaquete(e: EntradaDelDaemonDelPaquete): { daemon: MemoryDaemon; hayCuenta: boolean } {
  const { deps, hayCuenta } = depsDelDaemonDelPaquete(e)
  // Nunca se llama a `start()`: el paquete no deja temporizadores ni procesos de fondo
  // (§6.2). Quien lo usa llama a `pull()` / `push()` y después a `stop()` para soltar el
  // candado.
  return { daemon: new MemoryDaemon(deps), hayCuenta }
}
