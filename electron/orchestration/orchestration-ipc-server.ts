// Servidor del socket de orquestación (named pipe en Windows / unix socket en el resto).
// Mismo framing que memory-ipc-server.ts, pero sin lógica de memoria. El pane que llama
// sale SÓLO del token; cualquier paneId dentro de params se ignora.

import { createServer, Server, Socket } from 'net'
import { existsSync, unlinkSync, mkdirSync, chmodSync } from 'fs'
import { dirname } from 'path'
import type { PaneTokenRegistry } from './pane-tokens'
import { ORCH_METHODS, type OrchMethod, type OrchRequest, type OrchResponse } from './protocol'

// Inline (no importar ./platform: arrastra `electron` y no carga bajo vitest en Node).
const isWin = process.platform === 'win32'

// Sin tope, un cliente local podría crecer la memoria sin límite no mandando nunca '\n'.
const MAX_LINE_BYTES = 1024 * 1024
const CONNECTION_IDLE_TIMEOUT_MS = 30_000

export interface OrchestrationIpcServerDeps {
  socketPath: string
  tokens: PaneTokenRegistry
  handle: (callerPaneId: string, method: OrchMethod, params: unknown) => Promise<unknown>
}

export class OrchestrationIpcServer {
  private server: Server | null = null

  constructor(private readonly deps: OrchestrationIpcServerDeps) {}

  start(): void {
    const { socketPath } = this.deps
    if (!isWin) {
      mkdirSync(dirname(socketPath), { recursive: true })
      if (existsSync(socketPath)) {
        try { unlinkSync(socketPath) } catch { /* socket viejo, ignorar */ }
      }
    }
    this.server = createServer((socket) => this.handleConnection(socket))
    this.server.listen(socketPath, () => {
      if (!isWin) {
        try { chmodSync(socketPath, 0o600) } catch { /* best effort */ }
      }
    })
    this.server.on('error', (err) => {
      console.error('[orchestration-ipc-server] listen error', err)
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
    if (!isWin && existsSync(this.deps.socketPath)) {
      try { unlinkSync(this.deps.socketPath) } catch { /* ignorar */ }
    }
  }

  private handleConnection(socket: Socket): void {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(CONNECTION_IDLE_TIMEOUT_MS, () => socket.destroy())
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (Buffer.byteLength(buffer, 'utf8') > MAX_LINE_BYTES) {
        console.warn('[orchestration-ipc-server] connection exceeded max line size, dropping')
        socket.destroy()
        return
      }
      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx)
        buffer = buffer.slice(newlineIdx + 1)
        if (!line.trim()) continue
        this.handleLine(socket, line)
      }
    })
    socket.on('error', () => { /* las desconexiones del cliente son rutina */ })
  }

  private reply(socket: Socket, response: OrchResponse): void {
    if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`)
  }

  private handleLine(socket: Socket, line: string): void {
    let request: Partial<OrchRequest> | null
    try {
      request = JSON.parse(line) as Partial<OrchRequest> | null
    } catch {
      return
    }
    // Sin id recuperable no hay a quién contestar: se descarta.
    if (!request || typeof request !== 'object' || typeof request.id !== 'string') return
    const id = request.id

    // El token se valida antes que el método: sin token válido no se revela nada.
    const callerPaneId = typeof request.token === 'string' ? this.deps.tokens.resolve(request.token) : null
    if (!callerPaneId) {
      this.reply(socket, { id, ok: false, error: 'unauthorized' })
      return
    }
    const method = request.method
    if (typeof method !== 'string' || !ORCH_METHODS.includes(method as OrchMethod)) {
      this.reply(socket, { id, ok: false, error: 'unknown_method' })
      return
    }
    this.deps.handle(callerPaneId, method as OrchMethod, request.params).then(
      (result) => this.reply(socket, { id, ok: true, result }),
      (err: unknown) => this.reply(socket, { id, ok: false, error: err instanceof Error ? err.message : String(err) })
    )
  }
}
