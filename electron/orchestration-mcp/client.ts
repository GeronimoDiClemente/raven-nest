// Cliente fino del shim: una conexión por request al socket de orquestación de main. Sin
// estado. Igual que memory-mcp/client.ts, sin el reintento de `store_swapping` (no aplica).
import { connect } from 'net'
import { randomUUID } from 'crypto'
import type { OrchMethod, OrchRequest, OrchResponse, WaitParams } from '../orchestration/protocol'

const REQUEST_TIMEOUT_MS = 5000
const WAIT_DEFAULT_MS = 60_000
const WAIT_MAX_MS = 240_000
const WAIT_MARGIN_MS = 5000

/** `inbox.wait` bloquea en el servidor hasta `timeoutMs`: el cliente espera eso más un margen. */
export function timeoutFor(method: OrchMethod, params: unknown): number {
  if (method !== 'inbox.wait') return REQUEST_TIMEOUT_MS
  const asked = (params as WaitParams | undefined)?.timeoutMs
  const wait = typeof asked === 'number' && asked > 0 ? Math.min(asked, WAIT_MAX_MS) : WAIT_DEFAULT_MS
  return wait + WAIT_MARGIN_MS
}

export class OrchestrationClient {
  constructor(private readonly socketPath: string, private readonly token: string) {}

  call<T = unknown>(method: OrchMethod, params: unknown): Promise<T> {
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
        finish(() => reject(new Error(`Nest orchestration timed out (method=${method})`)))
      }, timeoutFor(method, params))

      socket.on('connect', () => {
        const request: OrchRequest = { id, method, params, token: this.token }
        socket.write(`${JSON.stringify(request)}\n`)
      })

      socket.setEncoding('utf8')
      socket.on('data', (chunk: string) => {
        buffer += chunk
        const newlineIdx = buffer.indexOf('\n')
        if (newlineIdx === -1) return
        try {
          const response = JSON.parse(buffer.slice(0, newlineIdx)) as OrchResponse
          if (response.id !== id) return
          finish(() => {
            if (response.ok) resolve(response.result as T)
            else reject(new Error(response.error))
          })
        } catch (err) {
          finish(() => reject(err instanceof Error ? err : new Error(String(err))))
        }
      })

      socket.on('error', (err) => finish(() => reject(err)))
      // Cierre sin respuesta (main se fue): sin esto esperaría hasta el timeout.
      socket.on('close', () => finish(() => reject(new Error('Nest orchestration closed the connection'))))
    })
  }
}
