// Qué base de memoria está activa, escrito en disco.
//
// Existe por una razón puntual: **el shim del MCP tiene que poder encontrar la base con Nest
// cerrado**. Hoy el `userId` llega del renderer en tiempo de ejecución (la sesión de
// Supabase), así que un proceso que arranca sin la app no tiene forma de saber si mirar
// `_local/` o `<uuid-de-cuenta>/` — y con varias cuentas, adivinar por fecha de modificación
// es exactamente la clase de heurística que un día devuelve las memorias de otra persona.
//
// Es un puntero, no un dato: si se pierde o queda viejo, lo peor que pasa es que el modo sin
// daemon no encuentre nada y lo diga. La app nunca lo lee para decidir qué abrir — ella ya
// sabe quién está logueado.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export interface ActiveStorePointer {
  /** `null` = sesión sin cuenta (la partición `_local`). */
  userId: string | null
  /** Path absoluto del `.db`. Se guarda resuelto y no se recalcula: si mañana cambia el
   *  layout de carpetas, un puntero viejo sigue apuntando a donde el archivo está de verdad. */
  storePath: string
  updatedAt: number
}

/** `{ravenHome}/.raven-nest/memory/active.json` — al lado de las carpetas de cuenta. */
export function activePointerPath(ravenHomeDir: string): string {
  return join(ravenHomeDir, '.raven-nest', 'memory', 'active.json')
}

/**
 * Escribe el puntero de forma atómica (escribir a un temporal y renombrar).
 *
 * Nunca tira: esto es un accesorio del modo sin daemon, y un fallo al escribirlo no puede
 * tumbar un cambio de cuenta — que es una operación con datos reales del usuario.
 */
export function writeActivePointer(ravenHomeDir: string, userId: string | null, storePath: string): void {
  const destino = activePointerPath(ravenHomeDir)
  try {
    mkdirSync(dirname(destino), { recursive: true })
    const payload: ActiveStorePointer = { userId, storePath, updatedAt: Date.now() }
    const tmp = `${destino}.tmp`
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
    renameSync(tmp, destino)
  } catch (err) {
    console.warn('[memory-active-store] no se pudo escribir el puntero de cuenta activa', err)
  }
}

/**
 * Lee el puntero. `null` si no existe, si no parsea, o si el `.db` que nombra ya no está —
 * los tres casos son lo mismo para quien llama: no hay base que abrir sin la app.
 */
export function readActivePointer(ravenHomeDir: string): ActiveStorePointer | null {
  const origen = activePointerPath(ravenHomeDir)
  if (!existsSync(origen)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(origen, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const p = parsed as Partial<ActiveStorePointer>
    if (typeof p.storePath !== 'string' || !p.storePath) return null
    if (!existsSync(p.storePath)) return null
    return {
      userId: typeof p.userId === 'string' ? p.userId : null,
      storePath: p.storePath,
      updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : 0,
    }
  } catch {
    return null
  }
}
