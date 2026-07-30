// Uses a REAL `net` server/client (no native deps involved) with a mocked MemoryStore,
// so — unlike memory-store.test.ts — this file fully executes in this sandbox. Covers
// C2 (token validation) and M22 (message-size cap) from the review-round-1 findings.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { connect } from 'net'
import { join } from 'path'
import { platform } from 'os'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryIpcServer } from '../memory-ipc-server'
import type { MemoryStore } from '../memory-store'
import type { MemoryRequest, MemoryResponse } from '../memory-protocol'

const TOKEN = 'a'.repeat(64)
const isWin = platform() === 'win32'

function fakeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    ensureProject: vi.fn(),
    save: vi.fn(() => ({ syncId: 'obs-1', outcome: 'inserted' as const, redacted: false })),
    search: vi.fn(() => []),
    context: vi.fn(() => []),
    deleteObservation: vi.fn(() => true),
    openSession: vi.fn(),
    closeSession: vi.fn(),
    getSession: vi.fn(() => null),
    ...overrides,
  } as unknown as MemoryStore
}

function uniqueSocketPath(dir: string): string {
  if (isWin) return `\\\\.\\pipe\\nest-memory-test-${Math.random().toString(36).slice(2)}`
  return join(dir, 'daemon.sock')
}

function sendRaw(socketPath: string, raw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(raw))
    socket.on('data', (chunk) => {
      buffer += chunk
      if (buffer.includes('\n')) {
        socket.end()
        resolve(buffer)
      }
    })
    socket.on('error', reject)
    socket.on('close', () => resolve(buffer))
  })
}

describe('MemoryIpcServer — token validation (C2)', () => {
  let dir: string
  let server: MemoryIpcServer
  let socketPath: string

  beforeEach(() => {
    dir = makeTmpDir('raven-ipc-')
    socketPath = uniqueSocketPath(dir)
  })

  afterEach(async () => {
    server?.stop()
    await new Promise((r) => setTimeout(r, 20))
    cleanupTmp(dir)
  })

  it('rejects a request with the wrong token before it reaches the store', async () => {
    const save = vi.fn(() => ({ syncId: 'obs-1', outcome: 'inserted' as const, redacted: false }))
    const store = fakeStore({ save })
    server = new MemoryIpcServer({ store, socketPath, authToken: TOKEN })
    server.start()
    await new Promise((r) => setTimeout(r, 20))

    const request: MemoryRequest = { id: '1', method: 'memory.save', params: { cwd: '/tmp', title: 't', content: 'c', type: 'discovery', source: 'mcp' }, token: 'wrong-token' }
    const raw = await sendRaw(socketPath, `${JSON.stringify(request)}\n`)
    const response = JSON.parse(raw.trim()) as MemoryResponse

    expect(response.ok).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('rejects a request with no token field at all', async () => {
    server = new MemoryIpcServer({ store: fakeStore(), socketPath, authToken: TOKEN })
    server.start()
    await new Promise((r) => setTimeout(r, 20))

    const raw = await sendRaw(socketPath, `${JSON.stringify({ id: '1', method: 'ping', params: {} })}\n`)
    const response = JSON.parse(raw.trim()) as MemoryResponse
    expect(response.ok).toBe(false)
  })

  it('accepts a request with the correct token and dispatches it', async () => {
    const save = vi.fn(() => ({ syncId: 'obs-1', outcome: 'inserted' as const, redacted: false }))
    const store = fakeStore({ save })
    server = new MemoryIpcServer({ store, socketPath, authToken: TOKEN })
    server.start()
    await new Promise((r) => setTimeout(r, 20))

    const request: MemoryRequest = { id: '1', method: 'memory.save', params: { cwd: '/tmp', title: 't', content: 'c', type: 'discovery', source: 'mcp' }, token: TOKEN }
    const raw = await sendRaw(socketPath, `${JSON.stringify(request)}\n`)
    const response = JSON.parse(raw.trim()) as MemoryResponse

    expect(response.ok).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('MemoryIpcServer — message size cap (M22)', () => {
  let dir: string
  let server: MemoryIpcServer
  let socketPath: string

  beforeEach(() => {
    dir = makeTmpDir('raven-ipc-')
    socketPath = uniqueSocketPath(dir)
  })

  afterEach(async () => {
    server?.stop()
    await new Promise((r) => setTimeout(r, 20))
    cleanupTmp(dir)
  })

  it('destroys a connection that sends an oversized line without a newline', async () => {
    server = new MemoryIpcServer({ store: fakeStore(), socketPath, authToken: TOKEN })
    server.start()
    await new Promise((r) => setTimeout(r, 20))

    const oversized = 'x'.repeat(2 * 1024 * 1024) // 2 MiB, no trailing newline
    const closed = await new Promise<boolean>((resolve) => {
      const socket = connect(socketPath)
      socket.on('connect', () => socket.write(oversized))
      socket.on('close', () => resolve(true))
      socket.on('error', () => resolve(true))
      setTimeout(() => resolve(false), 2000)
    })

    expect(closed).toBe(true)
  })
})
