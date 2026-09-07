// Task 1 (plan de memoria por cuenta multi-dispositivo) Step 4: MemoryDaemonClient.call()
// retries ONLY the `store_swapping` rejection the server (memory-ipc-server.ts's
// suspend()) sends back while a hot-swap is draining/re-pointing the store — see
// correction #8 in the Step 4 spec. Uses a REAL `net` server (no native deps), scripted
// per-test to answer each incoming request line however the test wants, mirroring the
// harness already used in memory-ipc-server.test.ts.
import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server, type Socket } from 'net'
import { join } from 'path'
import { platform } from 'os'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryDaemonClient } from '../memory-mcp/client'
import type { MemoryRequest, MemoryResponse } from '../memory-protocol'

const TOKEN = 'a'.repeat(64)
const isWin = platform() === 'win32'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function uniqueSocketPath(dir: string): string {
  if (isWin) return `\\\\.\\pipe\\nest-memory-client-test-${Math.random().toString(36).slice(2)}`
  return join(dir, 'daemon.sock')
}

/**
 * Starts a bare-bones fake daemon: for every request line it receives, it calls
 * `respond(request)` to get back either a response body to send, or `null` to send
 * nothing at all (used by "let it time out" scenarios, unused here).
 */
function startFakeDaemon(socketPath: string, respond: (req: MemoryRequest) => MemoryResponse): Server {
  const server = createServer((socket: Socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const newlineIdx = buffer.indexOf('\n')
      if (newlineIdx === -1) return
      const line = buffer.slice(0, newlineIdx)
      buffer = buffer.slice(newlineIdx + 1)
      const req = JSON.parse(line) as MemoryRequest
      const response = respond(req)
      socket.write(`${JSON.stringify(response)}\n`)
    })
  })
  server.listen(socketPath)
  return server
}

describe('MemoryDaemonClient.call() — retrying store_swapping (Task 1 Step 4)', () => {
  let dir: string
  let socketPath: string
  let server: Server | undefined

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve()
      server.close(() => resolve())
    })
    await sleep(20)
    if (dir) cleanupTmp(dir)
  })

  it('a first attempt with store_swapping followed by a successful second attempt resolves with the second result, hiding the intermediate error from the caller', async () => {
    dir = makeTmpDir('raven-client-')
    socketPath = uniqueSocketPath(dir)
    let calls = 0
    server = startFakeDaemon(socketPath, (req) => {
      calls += 1
      if (calls === 1) return { id: req.id, ok: false, error: 'store_swapping' }
      return { id: req.id, ok: true, result: { items: [] } }
    })
    await sleep(20)

    const client = new MemoryDaemonClient(socketPath, TOKEN)
    const result = await client.call('memory.search', { cwd: '/tmp', query: 'q' })

    expect(calls).toBe(2)
    expect(result).toEqual({ items: [] })
  })

  it('store_swapping on every attempt (all 8) rejects with that same error after exhausting the budget', async () => {
    dir = makeTmpDir('raven-client-')
    socketPath = uniqueSocketPath(dir)
    let calls = 0
    server = startFakeDaemon(socketPath, (req) => {
      calls += 1
      return { id: req.id, ok: false, error: 'store_swapping' }
    })
    await sleep(20)

    const client = new MemoryDaemonClient(socketPath, TOKEN)
    await expect(client.call('memory.search', { cwd: '/tmp', query: 'q' })).rejects.toThrow('store_swapping')

    expect(calls).toBe(8)
  }, 10_000)

  it('any other error (e.g. unauthorized) never retries — rejects on the very first attempt', async () => {
    dir = makeTmpDir('raven-client-')
    socketPath = uniqueSocketPath(dir)
    let calls = 0
    server = startFakeDaemon(socketPath, (req) => {
      calls += 1
      return { id: req.id, ok: false, error: 'unauthorized' }
    })
    await sleep(20)

    const client = new MemoryDaemonClient(socketPath, TOKEN)
    await expect(client.call('memory.save', {
      cwd: '/tmp', title: 't', content: 'c', type: 'discovery', source: 'mcp',
    })).rejects.toThrow('unauthorized')

    expect(calls).toBe(1)
  })
})
