// Con quién habla el MCP de Nest: el daemon de una Nest viva, o la base del disco en sólo
// lectura.
//
// **La búsqueda en el disco es la del paquete portátil** (`nest-vivo-del-paquete.ts`), no una
// copia: el `pipe-auth.json` que deja la app, y el candidato sólo cuenta si contesta un `ping`
// con su token, con tope corto. Hasta el 2026-11-02 este shim sólo miraba las variables del
// pane, así que una sesión lanzada fuera de un pane —Claude desktop, VS Code, Cursor— con Nest
// abierto no podía guardar nunca, mientras el paquete, en la misma máquina, sí encontraba a Nest.
//
// **Las variables del pane mandan, sin ping.** Las inyecta Nest en sus terminales y son la
// fuente autoritativa; el cliente del daemon ya reintenta lo transitorio (`store_swapping`
// durante un cambio de cuenta). Pingearlas al arrancar dejaba en sólo lectura TODA la sesión
// si el daemon justo no contestaba en ese instante.
//
// **Re-descubrimiento perezoso.** Si arrancó en sólo lectura, la primera escritura vuelve a
// buscar a Nest en el disco antes de contestar `SIN_APP`: cubre abrir Nest después de arrancar
// la sesión. Las lecturas no pingean —siguen en el disco hasta que una escritura encuentre a Nest.
import { MemoryDaemonClient } from './client'
import { MemoryReadonlyClient, esMetodoDeLectura } from './readonly'
import { buscarNestVivo, type DondeHablarle } from '../nest-vivo-del-paquete'
import type { MemoryMethod } from '../memory-protocol'
import type { ClienteDeMemoria } from './servidor'

export interface ClienteElegido {
  cliente: ClienteDeMemoria
  /** Si arrancó hablando con el daemon. Uno que arrancó sin él puede pasarse después. */
  conDaemon: boolean
  /** Dónde contestó (o a dónde apuntan las variables del pane), o `null`. */
  donde: DondeHablarle | null
}

/** Busca a Nest sólo en el disco: las variables ya se miraron antes. */
function buscarEnElDisco(ravenHomeDir: string, isWin: boolean, topeMs?: number): Promise<DondeHablarle | null> {
  return buscarNestVivo({}, ravenHomeDir, isWin, topeMs)
}

/**
 * Sólo lectura que se pasa al daemon en cuanto una escritura lo encuentra, y se queda con él el
 * resto de la sesión.
 */
class ClienteQueRedescubre implements ClienteDeMemoria {
  private daemon: MemoryDaemonClient | null = null

  constructor(
    private readonly lectura: MemoryReadonlyClient,
    private readonly ravenHomeDir: string,
    private readonly isWin: boolean,
    private readonly topeMs?: number,
  ) {}

  async call<T = unknown>(method: MemoryMethod, params: unknown): Promise<T> {
    if (this.daemon) return this.daemon.call<T>(method, params)
    if (!esMetodoDeLectura(method)) {
      const donde = await buscarEnElDisco(this.ravenHomeDir, this.isWin, this.topeMs)
      if (donde) {
        this.daemon = new MemoryDaemonClient(donde.socket, donde.token)
        this.lectura.close()
        console.error("[nest-memory] found Nest's memory service — leaving read-only mode")
        return this.daemon.call<T>(method, params)
      }
    }
    return this.lectura.call<T>(method, params)
  }
}

export async function elegirClienteDeMemoria(
  env: Record<string, string | undefined>,
  ravenHomeDir: string,
  isWin: boolean,
  topeMs?: number,
): Promise<ClienteElegido> {
  const socket = env.NEST_MEMORY_SOCKET
  const token = env.NEST_MEMORY_TOKEN
  if (socket && token) {
    return { cliente: new MemoryDaemonClient(socket, token), conDaemon: true, donde: { socket, token } }
  }
  const donde = await buscarEnElDisco(ravenHomeDir, isWin, topeMs)
  if (donde) {
    return { cliente: new MemoryDaemonClient(donde.socket, donde.token), conDaemon: true, donde }
  }
  const cliente = new ClienteQueRedescubre(new MemoryReadonlyClient(ravenHomeDir), ravenHomeDir, isWin, topeMs)
  return { cliente, conDaemon: false, donde: null }
}
