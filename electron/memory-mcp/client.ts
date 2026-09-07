// Thin client used by the stdio MCP shim to talk to the daemon's IPC server. No
// SQLite, no state beyond the socket connection — see
// docs/nest-memory-architecture.md §1.1 ("the shim holds no state and no database
// handle").
import { connect } from 'net'
import { randomUUID } from 'crypto'
import type { MemoryMethod, MemoryRequest, MemoryResponse } from '../memory-protocol'

const REQUEST_TIMEOUT_MS = 5000

// Task 1 Step 4 / correction #8: the server (memory-ipc-server.ts's suspend()) rejects
// in-flight requests with `store_swapping` for as long as a hot-swap (logout/login,
// account switch) is draining and re-pointing the store — see memory-account-switch.ts.
// That window is bounded by renameSync's own internal retry (2-3 attempts x ~50ms, for
// Windows EBUSY/EPERM transients) plus the suspend/resume dance around it, so it's a
// short LOCAL operation, not a network call — hence a fixed backoff, not exponential.
// The budget here must stay comfortably above that internal retry so real contention
// doesn't surface as a terminal error to the MCP caller.
const STORE_SWAPPING_MAX_ATTEMPTS = 8
const STORE_SWAPPING_RETRY_DELAY_MS = 150
const STORE_SWAPPING_ERROR = 'store_swapping'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class MemoryDaemonClient {
  // C2: every request must carry the shared-secret token the daemon validates before
  // touching the store — see memory-local-auth.ts and memory-ipc-server.ts.
  constructor(private readonly socketPath: string, private readonly authToken: string) {}

  async call<T = unknown>(method: MemoryMethod, params: unknown): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= STORE_SWAPPING_MAX_ATTEMPTS; attempt++) {
      try {
        return await this.callOnce<T>(method, params)
      } catch (err) {
        const isStoreSwapping = err instanceof Error && err.message === STORE_SWAPPING_ERROR
        if (!isStoreSwapping) throw err
        lastError = err
        if (attempt < STORE_SWAPPING_MAX_ATTEMPTS) {
          await sleep(STORE_SWAPPING_RETRY_DELAY_MS)
        }
      }
    }
    throw lastError
  }

  private callOnce<T = unknown>(method: MemoryMethod, params: unknown): Promise<T> {
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
