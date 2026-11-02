// El MCP de Nest (`dist-electron/memory-mcp.js`) elige con quién hablar al arrancar.
//
// Hasta el 2026-11-02 sólo miraba `NEST_MEMORY_SOCKET` + `NEST_MEMORY_TOKEN`, que Nest inyecta
// en SUS terminales y en ningún otro lado. Una sesión lanzada fuera de un pane de Nest —Claude
// desktop, VS Code, Cursor— con Nest abierto caía siempre en sólo lectura y no podía guardar,
// mientras el paquete portátil, en la misma máquina, ya encontraba a Nest por el disco
// (`nest-vivo-del-paquete.ts`). Ahora los dos usan la misma búsqueda: variables primero, el
// `pipe-auth.json` después, y un candidato sólo cuenta si contesta un `ping` con su token.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryIpcServer } from '../memory-ipc-server'
import { MemoryStore } from '../memory-store'
import { daemonSocketPath } from '../memory-protocol'
import { ensureLocalAuthMaterial } from '../memory-local-auth'
import { MemoryDaemonClient } from '../memory-mcp/client'
import { MemoryReadonlyClient } from '../memory-mcp/readonly'
import { elegirClienteDeMemoria } from '../memory-mcp/elegir-cliente'

const isWin = process.platform === 'win32'
let raven: string
let store: MemoryStore
let server: MemoryIpcServer | null = null

beforeEach(() => {
  raven = makeTmpDir('nest-mcp-elegir-')
  store = new MemoryStore(join(raven, 'db', 'memory.db'))
})
afterEach(() => {
  server?.stop()
  server = null
  store.close()
  cleanupTmp(raven)
})

function levantarDaemon(socket: string, token: string): void {
  mkdirSync(join(raven, '.raven-nest', 'memory'), { recursive: true })
  server = new MemoryIpcServer({ store, socketPath: socket, authToken: token })
  server.start()
}

describe('elegirClienteDeMemoria', () => {
  it('con las variables de un pane de Nest y el daemon contestando, habla con el daemon', async () => {
    const socket = isWin
      ? `\\\\.\\pipe\\nest-memory-env-${randomUUID()}`
      : join(raven, 'env.sock')
    levantarDaemon(socket, 'token-del-pane')
    const r = await elegirClienteDeMemoria(
      { NEST_MEMORY_SOCKET: socket, NEST_MEMORY_TOKEN: 'token-del-pane' }, join(raven, 'sin-nest'), isWin, 300,
    )
    expect(r.conDaemon).toBe(true)
    expect(r.cliente).toBeInstanceOf(MemoryDaemonClient)
    expect(r.donde).toEqual({ socket, token: 'token-del-pane' })
  })

  it('sin variables, encuentra a Nest abierto por el pipe-auth.json del disco', async () => {
    const m = ensureLocalAuthMaterial(raven)
    const socket = daemonSocketPath(raven, isWin, m.pipeId)
    levantarDaemon(socket, m.token)
    const r = await elegirClienteDeMemoria({}, raven, isWin, 300)
    expect(r.conDaemon).toBe(true)
    expect(r.cliente).toBeInstanceOf(MemoryDaemonClient)
    expect(r.donde).toEqual({ socket, token: m.token })
  })

  it('con el pipe-auth.json pero sin nadie que conteste el ping, queda en sólo lectura', async () => {
    ensureLocalAuthMaterial(raven)
    const r = await elegirClienteDeMemoria({}, raven, isWin, 300)
    expect(r.conDaemon).toBe(false)
    expect(r.cliente).toBeInstanceOf(MemoryReadonlyClient)
    expect(r.donde).toBeNull()
  })

  it('sin variables ni rastro de Nest en el disco, queda en sólo lectura', async () => {
    const r = await elegirClienteDeMemoria({}, raven, isWin, 300)
    expect(r.conDaemon).toBe(false)
    expect(r.cliente).toBeInstanceOf(MemoryReadonlyClient)
    expect(r.donde).toBeNull()
  })
})
