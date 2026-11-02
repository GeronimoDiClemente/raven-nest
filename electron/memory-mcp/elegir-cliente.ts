// Con quién habla el MCP de Nest: el daemon de una Nest viva, o la base del disco en sólo
// lectura.
//
// **La búsqueda es la del paquete portátil** (`nest-vivo-del-paquete.ts`), no una copia: las
// variables que Nest inyecta en sus panes primero, el `pipe-auth.json` del disco después, y un
// candidato sólo cuenta si contesta un `ping` con su token, con tope corto. Hasta el
// 2026-11-02 este shim sólo miraba las variables, así que una sesión lanzada fuera de un pane
// —Claude desktop, VS Code, Cursor— con Nest abierto no podía guardar nunca, mientras el
// paquete, en la misma máquina, sí encontraba a Nest.
import { MemoryDaemonClient } from './client'
import { MemoryReadonlyClient } from './readonly'
import { buscarNestVivo, type DondeHablarle } from '../nest-vivo-del-paquete'
import type { ClienteDeMemoria } from './servidor'

export interface ClienteElegido {
  cliente: ClienteDeMemoria
  conDaemon: boolean
  /** Dónde contestó Nest, o `null` si no contestó nadie. */
  donde: DondeHablarle | null
}

export async function elegirClienteDeMemoria(
  env: Record<string, string | undefined>,
  ravenHomeDir: string,
  isWin: boolean,
  topeMs?: number,
): Promise<ClienteElegido> {
  const donde = await buscarNestVivo(env, ravenHomeDir, isWin, topeMs)
  if (donde) {
    return { cliente: new MemoryDaemonClient(donde.socket, donde.token), conDaemon: true, donde }
  }
  return { cliente: new MemoryReadonlyClient(ravenHomeDir), conDaemon: false, donde: null }
}
