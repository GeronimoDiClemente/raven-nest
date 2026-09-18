// El token de dispositivo del paquete portátil, en reposo.
//
// Mismo trato que `credential.bin` de Nest y que `memory-key-store.ts`: cifrado encima, 0600
// abajo, defensa en profundidad. Lo que cambia es CON QUÉ se cifra — acá no hay
// `electron.safeStorage`, así que el cifrado viene del llavero del sistema
// (`llavero-del-sistema.ts`).
//
// **Vive en `~/.nest-memory/` y no junto al de Nest**, aunque el nombre del archivo sea el
// mismo. Los dos cifrados son distintos: si compartieran archivo, cada uno rompería el del
// otro y ninguno podría explicar por qué. Dos tokens en una máquina no es un problema — son
// dos filas en `devices`, y el servidor ya los trata como dispositivos separados.
import { join, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, chmodSync } from 'fs'
import type { SafeStorageLike } from './memory-key-store'

export interface CredencialDelPaquete {
  token: string
  deviceId: string
}

export function pathDeCredencial(home: string): string {
  return join(home, '.nest-memory', 'credential.bin')
}

/**
 * Escribir SÍ lanza cuando no hay cifrado del sistema.
 *
 * Es la misma regla que `memory-key-store.ts` y por el mismo motivo: un token guardado en
 * texto plano es peor que no tener token, porque el usuario cree que quedó a salvo. Sin
 * llavero, el paquete se queda sin nube y lo dice — que es el estado que el §7 del spec ya
 * describe como legítimo.
 */
export function guardarCredencial(
  home: string,
  safe: SafeStorageLike,
  credencial: CredencialDelPaquete,
): void {
  if (!safe.isEncryptionAvailable()) {
    throw new Error('No system keyring available — the device token is never written in the clear')
  }
  const path = pathDeCredencial(home)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, safe.encryptString(JSON.stringify(credencial)), { mode: 0o600 })
  // `mode` en `writeFileSync` queda sujeto al umask, así que se fuerza aparte. Mismo
  // cinturón-y-tiradores que usa `main.ts` para el `credential.bin` de Nest.
  chmodSync(path, 0o600)
}

/**
 * `null` en CUALQUIER falla: sin archivo, sin llavero, con bytes que no abren, o con un
 * contenido que no tiene la forma esperada.
 *
 * Los cuatro casos son lo mismo para quien llama —«no estás conectado, volvé a hacer
 * `login`»— y ése es un final recuperable. Lanzar desde acá apagaría el paquete entero por
 * una credencial ilegible.
 */
export function leerCredencial(home: string, safe: SafeStorageLike): CredencialDelPaquete | null {
  const path = pathDeCredencial(home)
  if (!existsSync(path)) return null
  try {
    if (!safe.isEncryptionAvailable()) return null
    const parsed = JSON.parse(safe.decryptString(readFileSync(path))) as Partial<CredencialDelPaquete>
    if (typeof parsed?.token !== 'string' || !parsed.token) return null
    if (typeof parsed?.deviceId !== 'string' || !parsed.deviceId) return null
    return { token: parsed.token, deviceId: parsed.deviceId }
  } catch {
    return null
  }
}

export function borrarCredencial(home: string): void {
  const path = pathDeCredencial(home)
  if (existsSync(path)) unlinkSync(path)
}
