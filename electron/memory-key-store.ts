// Las claves del cifrado en reposo. Mismo trato que `credential.bin` (spec §6.2):
// safeStorage encima, 0600 abajo, defensa en profundidad.
//
// Particionado por CUENTA DE NEST, con la misma regla que `resolveStorePath()` en
// memory-store.ts: dos cuentas en la misma maquina tienen bases distintas, asi que tienen
// maestras distintas. Sin cuenta logueada, `_local`.
import { join, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, chmodSync, renameSync } from 'fs'
import { generateDeviceKeyPair, type DeviceKeyPair } from './memory-key-wrap'

/** Lo que este modulo necesita de `electron.safeStorage`, para poder testearlo sin Electron. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plaintext: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface KeyMaterial {
  /** El par de ESTA maquina. Se genera una vez y no rota. */
  device: DeviceKeyPair
  /** La maestra desenvuelta, base64. `null` = el cifrado no esta activo en esta maquina. */
  master: string | null
  /** La epoca de clave que corresponde a esa maestra. `0` = ninguna. */
  keyEpoch: number
}

export function keyFilePath(ravenHomeDir: string, userId: string | null): string {
  const account = userId && userId.trim() ? userId : '_local'
  return join(ravenHomeDir, '.raven-nest', 'memory', account, 'keys.bin')
}

/**
 * Devuelve `null` en CUALQUIER falla de lectura, igual que memory-connection-state.ts y por
 * el mismo motivo: el peor caso es "esta maquina se tiene que volver a autorizar", que es
 * recuperable, y lanzar desde acá apagaria toda la memoria (main.ts atrapa y pone
 * `memory = null`).
 */
export function loadKeyMaterial(
  ravenHomeDir: string,
  userId: string | null,
  safe: SafeStorageLike
): KeyMaterial | null {
  const path = keyFilePath(ravenHomeDir, userId)
  if (!existsSync(path)) return null
  try {
    if (!safe.isEncryptionAvailable()) return null
    const parsed = JSON.parse(safe.decryptString(readFileSync(path))) as Partial<KeyMaterial>
    if (!parsed?.device?.publicKey || !parsed?.device?.privateKey) return null
    return {
      device: { publicKey: parsed.device.publicKey, privateKey: parsed.device.privateKey },
      master: typeof parsed.master === 'string' ? parsed.master : null,
      keyEpoch: typeof parsed.keyEpoch === 'number' ? parsed.keyEpoch : 0,
    }
  } catch {
    return null
  }
}

/**
 * Escribir SI lanza cuando no hay cifrado del SO: guardar una clave maestra en texto plano
 * seria peor que no cifrar nada, porque la promesa de la landing pasaria a ser falsa.
 */
export function saveKeyMaterial(
  ravenHomeDir: string,
  userId: string | null,
  safe: SafeStorageLike,
  material: KeyMaterial
): void {
  if (!safe.isEncryptionAvailable()) {
    throw new Error('safeStorage is not available on this system — keys are never written in the clear (§6.2)')
  }
  const path = keyFilePath(ravenHomeDir, userId)
  mkdirSync(dirname(path), { recursive: true })
  // Atomico: escribir a un temporal y renombrar. Directo sobre el archivo final, un corte de
  // luz o un crash a mitad de escritura dejaba un `keys.bin` TRUNCADO — y un archivo
  // truncado no se distingue de "todavia no hay claves", asi que el arranque siguiente
  // generaba un par nuevo y lo pisaba, destruyendo para siempre la unica privada capaz de
  // abrir la envoltura publicada en el servidor.
  const tmp = `${path}.tmp`
  writeFileSync(tmp, safe.encryptString(JSON.stringify(material)), { mode: 0o600 })
  // `mode` de writeFileSync queda sujeto a la umask; el chmod explicito es el que manda.
  // No-op en Windows (ACLs, no bits POSIX), donde DPAPI es la proteccion real.
  try { chmodSync(tmp, 0o600) } catch { /* best effort */ }
  renameSync(tmp, path)
}

/**
 * Lee lo que haya; si no hay par de dispositivo todavia, lo genera y lo persiste.
 *
 * **Nunca pisa un archivo que existe pero no se pudo leer.** `loadKeyMaterial` devuelve
 * `null` ante cualquier problema —JSON roto, safeStorage que dejo de abrir tras restaurar el
 * llavero, archivo truncado— y confundir eso con "primer arranque" destruia la maestra: se
 * generaba un par nuevo encima y la privada que era lo unico capaz de abrir la envoltura
 * publicada en el servidor desaparecia. El archivo se renombra a `.roto` y se deja: un
 * respaldo del llavero puede volver a abrirlo, un archivo pisado no vuelve nunca.
 */
export function ensureKeyMaterial(
  ravenHomeDir: string,
  userId: string | null,
  safe: SafeStorageLike
): KeyMaterial {
  const existente = loadKeyMaterial(ravenHomeDir, userId, safe)
  if (existente) return existente

  /**
   * Si `safeStorage` no esta disponible AHORA, no se toca nada.
   *
   * `loadKeyMaterial` devuelve `null` tanto por un archivo ilegible como porque el llavero
   * del sistema no abrio en este momento — y esos dos casos necesitan lo contrario. La
   * version anterior de esta funcion apartaba el archivo en los dos, asi que un llavero
   * caido un instante (la sesion todavia no desbloqueada, DPAPI que tarda) apartaba un
   * `keys.bin` SANO y generaba un par nuevo: exactamente la destruccion que este arreglo
   * existia para impedir, con un disparador mas facil que el original.
   */
  if (!safe.isEncryptionAvailable()) {
    throw new Error(
      'safeStorage is not available on this system — keys are neither read nor written. ' +
      'Local memory keeps working; cloud encryption stays disabled for this session.'
    )
  }

  const path = keyFilePath(ravenHomeDir, userId)
  if (existsSync(path)) {
    const roto = `${path}.roto-${Date.now()}`
    try {
      renameSync(path, roto)
      console.error(
        `[memory-key-store] ${path} existe y no se pudo leer. Se movio a ${roto} y se genera ` +
        'un par nuevo: esta maquina va a necesitar autorizacion. El archivo viejo NO se borro.'
      )
    } catch {
      // Si ni siquiera se puede mover, no se pisa: mejor fallar que destruir la clave.
      throw new Error(
        `${path} no se pudo leer ni mover. No se genera un par nuevo encima para no destruir ` +
        'the key: check the file permissions.'
      )
    }
  }

  const nuevo: KeyMaterial = { device: generateDeviceKeyPair(), master: null, keyEpoch: 0 }
  saveKeyMaterial(ravenHomeDir, userId, safe, nuevo)
  return nuevo
}

export function clearKeyMaterial(ravenHomeDir: string, userId: string | null): void {
  const path = keyFilePath(ravenHomeDir, userId)
  try { if (existsSync(path)) unlinkSync(path) } catch { /* best effort */ }
}
