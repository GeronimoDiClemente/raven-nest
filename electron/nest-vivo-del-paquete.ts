// ¿Nest está abierto en esta máquina? Si sí, el paquete portátil le delega todo (§5.1 del
// spec): es el escritor único y el que sincroniza en vivo, y abrir la base por al lado sólo
// sumaría un segundo actor.
//
// **Dónde buscarlo.** Las variables `NEST_MEMORY_SOCKET` y `NEST_MEMORY_TOKEN` las inyecta
// Nest en las terminales que abre él — y nada más. Un editor que lanza `npx nest-memory mcp`
// por su cuenta (Cursor, VS Code, Codex, que es el caso para el que existe el paquete) no las
// tiene nunca. Por eso, además, se lee del disco lo mismo que lee el shim de Nest: el
// `pipe-auth.json` que la app deja bajo su carpeta, con el id del pipe y el token.
//
// **Que el archivo esté no quiere decir que Nest esté abierto**: lo deja una vez y no lo
// borra. Lo que decide es un `ping` real, con el token, y con un tope corto — el MCP de un
// editor no puede tardar en arrancar porque Nest esté cerrado. Un token que el daemon
// rechaza tampoco cuenta: no se le podría hablar.
import { MemoryDaemonClient } from './memory-mcp/client'
import { daemonSocketPath } from './memory-protocol'
import { leerLocalAuthMaterial } from './memory-local-auth'

export interface DondeHablarle {
  socket: string
  token: string
}

/**
 * Los candidatos, en orden. Las variables primero —son de la terminal de Nest que lanzó
 * esto—, el disco después: una variable puede haber quedado de un Nest que ya se cerró, y
 * la del disco es la del Nest que esté abierto ahora.
 */
export function dondeHablarleANest(
  env: Record<string, string | undefined>,
  ravenHomeDir: string,
  isWin: boolean,
): DondeHablarle[] {
  const candidatos: DondeHablarle[] = []
  const socket = env.NEST_MEMORY_SOCKET
  const token = env.NEST_MEMORY_TOKEN
  // Los dos o ninguno: con el socket y sin el token no hay forma de autenticarse.
  if (socket && token) candidatos.push({ socket, token })

  const material = leerLocalAuthMaterial(ravenHomeDir)
  if (material) {
    const delDisco = { socket: daemonSocketPath(ravenHomeDir, isWin, material.pipeId), token: material.token }
    if (!candidatos.some((c) => c.socket === delDisco.socket && c.token === delDisco.token)) {
      candidatos.push(delDisco)
    }
  }
  return candidatos
}

/** Cuánto esperar a un Nest que no contesta. Cerrado, el pipe falla al instante; esto es
 *  para el caso raro de uno colgado, que no puede demorar el arranque del MCP del editor. */
const TOPE_DEL_PING_MS = 800

async function responde(d: DondeHablarle, topeMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const tope = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), topeMs) })
  const ping = new MemoryDaemonClient(d.socket, d.token)
    .call('ping', {})
    .then(() => true)
    .catch(() => false)
  try {
    return await Promise.race([ping, tope])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** El primer candidato que contesta el `ping`, o `null` si Nest no está abierto. */
export async function buscarNestVivo(
  env: Record<string, string | undefined>,
  ravenHomeDir: string,
  isWin: boolean,
  topeMs = TOPE_DEL_PING_MS,
): Promise<DondeHablarle | null> {
  for (const c of dondeHablarleANest(env, ravenHomeDir, isWin)) {
    if (await responde(c, topeMs)) return c
  }
  return null
}
