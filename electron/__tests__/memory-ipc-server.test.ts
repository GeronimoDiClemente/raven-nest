// Uses a REAL `net` server/client (no native deps involved) with a mocked MemoryStore,
// so — unlike memory-store.test.ts — this file fully executes in this sandbox. Covers
// C2 (token validation) and M22 (message-size cap) from the review-round-1 findings.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { connect } from 'net'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { platform } from 'os'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryIpcServer } from '../memory-ipc-server'
import type { MemoryStore, SaveInput } from '../memory-store'
import type { MemoryRequest, MemoryResponse, ObservationSummary } from '../memory-protocol'

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

function fakeObservation(overrides: Partial<ObservationSummary> = {}): ObservationSummary {
  return {
    syncId: 'obs-1',
    title: 'a memory',
    content: '',
    type: 'discovery',
    topicKey: null,
    tags: [],
    updatedAt: 0,
    originAi: null,
    gitBranch: null,
    ...overrides,
  }
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
    const save = vi.fn((_input: SaveInput) => ({ syncId: 'obs-1', outcome: 'inserted' as const, redacted: false }))
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
    const save = vi.fn((_input: SaveInput) => ({ syncId: 'obs-1', outcome: 'inserted' as const, redacted: false }))
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

// M26: pull-through search fallback. `daemon` here is a plain fake satisfying
// MemoryIpcServerDaemon (`Pick<MemoryDaemon, 'pull' | 'isOnline'>`), not a real
// MemoryDaemon — this file already avoids native/`electron`-touching imports (see the
// file-header comment), and the fallback only ever calls these two methods.
describe('MemoryIpcServer — pull-through search fallback (M26)', () => {
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

  async function doSearch(): Promise<MemoryResponse> {
    const request: MemoryRequest = { id: '1', method: 'memory.search', params: { cwd: '/tmp', query: 'q' }, token: TOKEN }
    const raw = await sendRaw(socketPath, `${JSON.stringify(request)}\n`)
    return JSON.parse(raw.trim()) as MemoryResponse
  }

  it('(a) search miss + online daemon: pulls once, re-searches, and marks the response refreshed', async () => {
    const remoteObs = fakeObservation({ syncId: 'obs-2', title: 'from another device' })
    const search = vi.fn()
      .mockReturnValueOnce([]) // first local search: miss
      .mockReturnValueOnce([remoteObs]) // post-pull re-search: hit
    const store = fakeStore({ search })
    const pull = vi.fn(() => Promise.resolve())
    const daemon = { pull, isOnline: () => true }
    server = new MemoryIpcServer({ store, socketPath, authToken: TOKEN, daemon })
    server.start()
    await new Promise((r) => setTimeout(r, 20))

    const response = await doSearch()

    expect(pull).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledTimes(2)
    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error('unreachable')
    expect(response.result).toEqual({ items: [remoteObs], refreshed: true })
  })

  it('(b) search hit: never calls daemon.pull and never sets refreshed', async () => {
    const localObs = fakeObservation({ syncId: 'obs-1', title: 'already local' })
    const search = vi.fn(() => [localObs])
    const store = fakeStore({ search })
    const pull = vi.fn(() => Promise.resolve())
    const daemon = { pull, isOnline: () => true }
    server = new MemoryIpcServer({ store, socketPath, authToken: TOKEN, daemon })
    server.start()
    await new Promise((r) => setTimeout(r, 20))

    const response = await doSearch()

    expect(pull).not.toHaveBeenCalled()
    expect(search).toHaveBeenCalledTimes(1)
    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error('unreachable')
    expect(response.result).toEqual({ items: [localObs] })
  })

  it('(c) a pull that never resolves still returns (empty) within the bounded timeout', async () => {
    const search = vi.fn(() => []) // miss both times — pull "succeeded" but found nothing new
    const store = fakeStore({ search })
    const pull = vi.fn(() => new Promise<void>(() => { /* never resolves */ }))
    const daemon = { pull, isOnline: () => true }
    // Test-only override (see MemoryIpcServerDeps.searchPullTimeoutMs) so this test
    // doesn't have to wait out the real 8s production default to prove the bound works.
    server = new MemoryIpcServer({ store, socketPath, authToken: TOKEN, daemon, searchPullTimeoutMs: 50 })
    server.start()
    await new Promise((r) => setTimeout(r, 20))

    const start = Date.now()
    const response = await doSearch()
    const elapsed = Date.now() - start

    expect(pull).toHaveBeenCalledTimes(1)
    expect(elapsed).toBeLessThan(2000) // generous bound vs. the 50ms timeout, avoids flakiness
    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error('unreachable')
    expect(response.result).toEqual({ items: [], refreshed: true })
  })

  it('(d) daemon reports offline: no pull attempted, local (empty) result returned as-is', async () => {
    const search = vi.fn(() => [])
    const store = fakeStore({ search })
    const pull = vi.fn(() => Promise.resolve())
    const daemon = { pull, isOnline: () => false }
    server = new MemoryIpcServer({ store, socketPath, authToken: TOKEN, daemon })
    server.start()
    await new Promise((r) => setTimeout(r, 20))

    const response = await doSearch()

    expect(pull).not.toHaveBeenCalled()
    expect(search).toHaveBeenCalledTimes(1)
    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error('unreachable')
    expect(response.result).toEqual({ items: [] })
  })

  it('no daemon wired at all: behaves exactly as before M26 (no pull, no refreshed field)', async () => {
    const search = vi.fn(() => [])
    const store = fakeStore({ search })
    server = new MemoryIpcServer({ store, socketPath, authToken: TOKEN })
    server.start()
    await new Promise((r) => setTimeout(r, 20))

    const response = await doSearch()

    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error('unreachable')
    expect(response.result).toEqual({ items: [] })
  })
})

// Layer B: `Stop` cerraba la sesión y NO escribía nada, y `PreCompact` dejaba un
// placeholder que prometía un rollup "on session close" que nunca llegaba. La memoria no
// capturaba lo que decía capturar.
describe('MemoryIpcServer — el rollup de sesion (Layer B)', () => {
  let dir: string
  let socketPath: string
  let server: MemoryIpcServer

  const TRANSCRIPT = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'arreglá el 500 del login' } }),
    JSON.stringify({ type: 'ai-title', aiTitle: 'Arreglar el 500 del login', sessionId: 's1' }),
  ].join('\n')

  beforeEach(() => {
    dir = makeTmpDir('raven-ipc-rollup-')
    socketPath = uniqueSocketPath(dir)
  })

  afterEach(async () => {
    await server?.stop()
    cleanupTmp(dir)
  })

  async function llamar(store: MemoryStore, method: string, params: Record<string, unknown>) {
    server = new MemoryIpcServer({ store, socketPath, authToken: TOKEN })
    await server.start()
    const req: MemoryRequest = { id: '1', token: TOKEN, method, params } as unknown as MemoryRequest
    const raw = await sendRaw(socketPath, `${JSON.stringify(req)}\n`)
    return JSON.parse(raw.trim()) as MemoryResponse
  }

  it('al cerrar escribe el resumen de la sesion como memoria', async () => {
    const transcriptPath = join(dir, 'sesion.jsonl')
    writeFileSync(transcriptPath, TRANSCRIPT)
    const save = vi.fn((_input: SaveInput) => ({ syncId: 'obs-1', outcome: 'inserted' as const, redacted: false }))
    const store = fakeStore({
      save,
      getSession: vi.fn(() => ({ project_key: 'proj-a', ended_at: null })) as unknown as MemoryStore['getSession'],
    })

    await llamar(store, 'hook.stop', { cwd: dir, sessionId: 's1', transcriptPath })

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]![0]).toMatchObject({
      type: 'session',
      title: 'Arreglar el 500 del login',
      source: 'hook',
    })
  })

  it('la memoria de una sesion es idempotente: reintentar no duplica', async () => {
    const transcriptPath = join(dir, 'sesion.jsonl')
    writeFileSync(transcriptPath, TRANSCRIPT)
    const save = vi.fn((_input: SaveInput) => ({ syncId: 'obs-1', outcome: 'inserted' as const, redacted: false }))
    const store = fakeStore({
      save,
      getSession: vi.fn(() => ({ project_key: 'proj-a', ended_at: null })) as unknown as MemoryStore['getSession'],
    })

    await llamar(store, 'hook.stop', { cwd: dir, sessionId: 's1', transcriptPath })

    // El sourceRef lleva el sessionId, así que el índice UNIQUE(source, source_ref) del
    // store hace que un segundo Stop actualice en vez de insertar otra.
    expect(save.mock.calls[0]![0].sourceRef).toContain('s1')
  })

  it('cierra la sesion igual cuando no hay transcript, en vez de fallar', async () => {
    const closeSession = vi.fn()
    const save = vi.fn((_input: SaveInput) => ({ syncId: 'obs-1', outcome: 'inserted' as const, redacted: false }))
    const store = fakeStore({ closeSession, save })

    const res = await llamar(store, 'hook.stop', { cwd: dir, sessionId: 's1' }) as unknown as Record<string, unknown>

    expect(res.error).toBeUndefined()
    expect(closeSession).toHaveBeenCalledWith('s1')
    expect(save).not.toHaveBeenCalled()
  })

  it('una sesion sin prompts no deja memoria: el ruido es peor que el silencio', async () => {
    const transcriptPath = join(dir, 'vacia.jsonl')
    writeFileSync(transcriptPath, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hola' } }))
    const save = vi.fn((_input: SaveInput) => ({ syncId: 'obs-1', outcome: 'inserted' as const, redacted: false }))
    const store = fakeStore({
      save,
      getSession: vi.fn(() => ({ project_key: 'proj-a', ended_at: null })) as unknown as MemoryStore['getSession'],
    })

    await llamar(store, 'hook.stop', { cwd: dir, sessionId: 's1', transcriptPath })

    expect(save).not.toHaveBeenCalled()
  })

  it('preCompact deja el resumen de verdad, no un placeholder que promete otro', async () => {
    const transcriptPath = join(dir, 'sesion.jsonl')
    writeFileSync(transcriptPath, TRANSCRIPT)
    const save = vi.fn((_input: SaveInput) => ({ syncId: 'obs-1', outcome: 'inserted' as const, redacted: false }))
    const store = fakeStore({
      save,
      getSession: vi.fn(() => ({ project_key: 'proj-a', ended_at: null })) as unknown as MemoryStore['getSession'],
    })

    await llamar(store, 'hook.preCompact', { cwd: dir, sessionId: 's1', transcriptPath })

    const guardado = save.mock.calls[0]![0]
    expect(guardado.title).toBe('Arreglar el 500 del login')
    expect(guardado.content).not.toContain('Rollup pending')
  })
})
