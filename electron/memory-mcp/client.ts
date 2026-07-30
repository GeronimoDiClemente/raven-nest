// Thin client used by the stdio MCP shim to talk to the daemon's IPC server. No
// SQLite, no state beyond the socket connection — see
// docs/nest-memory-architecture.md §1.1 ("the shim holds no state and no database
// handle").
import { connect } from 'net'
import { randomUUID } from 'crypto'
import type { MemoryMethod, MemoryRequest, MemoryResponse } from '../memory-protocol'

const REQUEST_TIMEOUT_MS = 5000

export class MemoryDaemonClient {
  // C2: every request must carry the shared-secret token the daemon validates before
  // touching the store — see memory-local-auth.ts and memory-ipc-server.ts.
  constructor(private readonly socketPath: string, private readonly authToken: string) {}

  call<T = unknown>(method: MemoryMethod, params: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const socket = connect(this.socketPath)
      let buffer = ''
      let settled = false

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { socket.destroy() } catch { /* ignore */ }
        fn()
      }

      const timer = setTimeout(() => {
        finish(() => reject(new Error(`Nest Memory daemon timed out (method=${method})`)))
      }, REQUEST_TIMEOUT_MS)

      socket.on('connect', () => {
        const request: MemoryRequest = { id, method, params, token: this.authToken }
        socket.write(`${JSON.stringify(request)}\n`)
      })

      socket.setEncoding('utf8')
      socket.on('data', (chunk: string) => {
        buffer += chunk
        const newlineIdx = buffer.indexOf('\n')
        if (newlineIdx === -1) return
        const line = buffer.slice(0, newlineIdx)
        try {
          const response = JSON.parse(line) as MemoryResponse
          if (response.id !== id) return
          finish(() => {
            if (response.ok) resolve(response.result as T)
            else reject(new Error(response.error))
          })
        } catch (err) {
          finish(() => reject(err instanceof Error ? err : new Error(String(err))))
        }
      })

      socket.on('error', (err) => {
        finish(() => reject(err))
      })
    })
  }
}
