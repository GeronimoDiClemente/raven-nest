// El MCP del paquete portátil en una máquina sin Nest corriendo: lee Y escribe.
//
// Hasta el 2026-10-02 `npx nest-memory mcp` usaba `MemoryReadonlyClient`, que es el modo de
// Nest cerrado PARA QUIEN TIENE NEST: lee del disco y manda a abrir la app para escribir. En
// una máquina que nunca tuvo Nest eso dejaba al paquete inútil — no había base que leer,
// porque nadie la creaba, y `memory_save` respondía "abrí Nest".
//
// El spec del portátil (§5.2 y §6) dice qué hacer, y por qué es seguro:
//
// - **Se escribe con el MISMO despacho que el daemon** (`MemoryIpcServer.responder`): la clave
//   de proyecto sale del remote de git igual que en la app, `save()` aplica la redacción de
//   secretos, y cada escritura entra al `mutation_log`. Nada reimplementado.
// - **Dos escritores sobre la misma base no la rompen**: WAL serializa, el `seq` del log lo
//   asigna la base, y el lamport se lee de la base adentro de la transacción (§6.1).
// - **Sincronizar es otra cosa** (§6.2) y no vive acá: quien arma este cliente puede pasar
//   `alAbrir`, que recibe el store y devuelve qué hacer después de cada escritura. Sin eso,
//   lo escrito queda en la cola hasta que aparezca un daemon que la drene.
//
// Si Nest SÍ está corriendo, este cliente no se usa: el paquete delega en el servidor de la
// app (`comandoMcp` en cli-del-paquete.ts), que es el único que sincroniza en vivo.
import { MemoryStore } from '../memory-store'
import { MemoryIpcServer, type GitInfoResolver } from '../memory-ipc-server'
import type { MemoryMethod } from '../memory-protocol'

export class MemoryLocalClient {
  private store: MemoryStore | null = null
  private server: MemoryIpcServer | null = null

  constructor(
    private readonly dbPath: string,
    private readonly resolveGitInfo: GitInfoResolver,
    /** Se llama una vez, al abrir la base. Lo que devuelve corre después de cada escritura. */
    private readonly alAbrir?: (store: MemoryStore) => (() => void) | void,
  ) {}

  /**
   * La base se abre —y se crea, si es una máquina nueva— en la primera llamada y no al
   * arrancar: un editor lanza el servidor MCP apenas abre, y crear `~/.nest-memory` sólo por
   * haber abierto el editor sería dejar rastro sin que nadie haya usado la memoria todavía.
   */
  private servidor(): MemoryIpcServer {
    if (this.server) return this.server
    this.store = new MemoryStore(this.dbPath)
    const trasEscribir = this.alAbrir?.(this.store) ?? undefined
    // Nunca se llama a `start()`: no hay socket. El servidor se usa sólo por su despacho.
    this.server = new MemoryIpcServer({
      store: this.store,
      socketPath: '',
      authToken: '',
      resolveGitInfo: this.resolveGitInfo,
      ...(trasEscribir ? { onMutation: trasEscribir } : {}),
    })
    return this.server
  }

  async call<T = unknown>(method: MemoryMethod, params: unknown): Promise<T> {
    if (method === 'ping') return { ok: true } as T
    return (await this.servidor().responder(method, params)) as T
  }

  close(): void {
    try { this.store?.close() } catch { /* cerrar una base ya cerrada no es un problema */ }
    this.store = null
    this.server = null
  }
}
