import { describe, it, expect, afterEach } from 'vitest'
import { connect } from 'net'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PaneTokenRegistry } from '../orchestration/pane-tokens'
import { OrchestrationIpcServer } from '../orchestration/orchestration-ipc-server'
import type { OrchMethod } from '../orchestration/protocol'

type Handle = (caller: string, method: OrchMethod, params: unknown) => Promise<unknown>

let server: OrchestrationIpcServer | null = null
let dir: string | null = null

afterEach(() => {
  server?.stop()
  server = null
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

async function levantar(handle: Handle) {
  dir = mkdtempSync(join(tmpdir(), 'orq-'))
  const socketPath = join(dir, 's.sock')
  const tokens = new PaneTokenRegistry()
  server = new OrchestrationIpcServer({ socketPath, tokens, handle })
  server.start()
  for (let i = 0; i < 100 && !existsSync(socketPath); i++) await new Promise((r) => setTimeout(r, 10))
  return { socketPath, tokens }
}

function pedir(socketPath: string, req: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const s = connect(socketPath)
    let buf = ''
    s.setEncoding('utf8')
    s.on('connect', () => s.write(`${JSON.stringify(req)}\n`))
    s.on('data', (c: string) => {
      buf += c
      if (buf.includes('\n')) { s.destroy(); resolve(JSON.parse(buf.split('\n')[0])) }
    })
    s.on('error', reject)
  })
}

describe('OrchestrationIpcServer', () => {
  it('rechaza sin token', async () => {
    const { socketPath } = await levantar(async () => 'x')
    const r = await pedir(socketPath, { id: '1', method: 'worker.list', params: {} })
    expect(r).toEqual({ id: '1', ok: false, error: 'unauthorized' })
  })

  it('rechaza token revocado', async () => {
    const { socketPath, tokens } = await levantar(async () => 'x')
    const token = tokens.issue('pane-1')
    tokens.revoke('pane-1')
    const r = await pedir(socketPath, { id: '2', method: 'worker.list', params: {}, token })
    expect(r).toEqual({ id: '2', ok: false, error: 'unauthorized' })
  })

  it('pasa el paneId resuelto a handle', async () => {
    const llamadas: Array<[string, OrchMethod, unknown]> = []
    const { socketPath, tokens } = await levantar(async (c, m, p) => { llamadas.push([c, m, p]); return { n: 1 } })
    const token = tokens.issue('pane-real')
    const r = await pedir(socketPath, { id: '3', method: 'worker.list', params: { paneId: 'otro' }, token })
    expect(r).toEqual({ id: '3', ok: true, result: { n: 1 } })
    expect(llamadas).toEqual([['pane-real', 'worker.list', { paneId: 'otro' }]])
  })

  it('error de handle vuelve como ok:false con el mensaje', async () => {
    const { socketPath, tokens } = await levantar(async () => { throw new Error('worker_limit') })
    const token = tokens.issue('p')
    const r = await pedir(socketPath, { id: '4', method: 'worker.launch', params: {}, token })
    expect(r).toEqual({ id: '4', ok: false, error: 'worker_limit' })
  })

  it('método desconocido vuelve unknown_method sin llamar a handle', async () => {
    let llamado = false
    const { socketPath, tokens } = await levantar(async () => { llamado = true; return 1 })
    const token = tokens.issue('p')
    const r = await pedir(socketPath, { id: '5', method: 'worker.nope', params: {}, token })
    expect(r).toEqual({ id: '5', ok: false, error: 'unknown_method' })
    expect(llamado).toBe(false)
  })

  it('línea de más de 1 MiB cierra la conexión', async () => {
    const { socketPath } = await levantar(async () => 'x')
    const cerrado = await new Promise<boolean>((resolve) => {
      const s = connect(socketPath)
      s.on('connect', () => s.write('a'.repeat(1024 * 1024 + 10)))
      s.on('close', () => resolve(true))
      s.on('error', () => { /* ECONNRESET/EPIPE esperado */ })
    })
    expect(cerrado).toBe(true)
  })
})
