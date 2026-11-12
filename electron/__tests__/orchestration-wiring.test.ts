import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { connect } from 'net'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { wireOrchestration, type OrchestrationWiring, type WireOrchestrationDeps } from '../orchestration/wire-orchestration'
import type { PaneInfo } from '../orchestration/orchestration-service'
import type { PtyOrchestration } from '../pty-manager'
import { pointerLine } from '../orchestration/prompts'

const COORD: PaneInfo = { paneId: 'coord', cmd: 'claude', accountDir: '/acc/claude/main', aiType: 'claude', cwd: '/repo' }

class FakePty extends EventEmitter {
  orch: PtyOrchestration | null = null
  infos = new Map<string, PaneInfo>([['coord', COORD]])
  buffers = new Map<string, string>()
  writes: Array<[string, string]> = []
  killed: string[] = []
  setOrchestration(o: PtyOrchestration) { this.orch = o }
  paneInfo(id: string) { return this.infos.get(id) }
  writeInternal(id: string, data: string) { this.writes.push([id, data]) }
  getBuffer(id: string) { return this.buffers.get(id) ?? '' }
  kill(id: string) { this.killed.push(id); this.infos.delete(id) }
  exists(id: string) { return this.infos.has(id) }
}

let wiring: OrchestrationWiring | null = null
let dir: string | null = null

afterEach(() => {
  wiring?.stop()
  wiring = null
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
  vi.useRealTimers()
})

function mk(over: Partial<WireOrchestrationDeps> = {}) {
  dir = mkdtempSync(join(tmpdir(), 'orq-wire-'))
  const pty = new FakePty()
  const sent: Array<[string, any]> = []
  const runGit = vi.fn(async (args: string[]) => (args.includes('status') ? '' : 'feat/base'))
  const deps: WireOrchestrationDeps = {
    pty,
    socketPath: join(dir, 'o.sock'),
    launchArgs: () => ['--mcp-config', '/x.json'],
    createWorktree: vi.fn(async (_r: string, b: string) => ({ ok: true as const, worktreePath: `/wt/${b}` })),
    runGit,
    accounts: { list: (t: string) => (t === 'codex' ? ['work'] : []), getDir: (t: string, n: string) => `/acc/${t}/${n}` },
    send: (channel, payload) => { sent.push([channel, payload]); return true },
    ...over,
  }
  wiring = wireOrchestration(deps)
  return { pty, sent, deps, w: wiring, runGit }
}

// Contesta como el renderer: registra el pane del worker (como haría PtyManager) y responde ok.
function rendererAcepta(pty: FakePty, sent: Array<[string, any]>, w: OrchestrationWiring) {
  const req = sent.filter(([c]) => c === 'orchestration:launch-pane').pop()![1]
  pty.infos.set(req.paneId, { paneId: req.paneId, cmd: req.cmd, accountDir: req.accountDir, aiType: req.aiType, cwd: req.repoPath })
  w.replyLaunchPane({ requestId: req.requestId, ok: true, tabPaneCount: 2 })
  return req
}

async function lanzar(pty: FakePty, sent: Array<[string, any]>, w: OrchestrationWiring) {
  const p = w.service.handle('coord', 'worker.launch', { task: 't', label: 'api' }) as Promise<{ workerId: string }>
  for (let i = 0; i < 20 && !sent.some(([c]) => c === 'orchestration:launch-pane'); i++) await Promise.resolve()
  const req = rendererAcepta(pty, sent, w)
  const r = await p
  return { req, r }
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

describe('wireOrchestration', () => {
  it('orquestación arranca con memory null', async () => {
    // El cableado no recibe nada de Memories: arranca el socket y se engancha al PtyManager solo.
    const { pty, deps } = mk()
    expect(pty.orch?.socketPath).toBe(deps.socketPath)
    expect(pty.orch?.launchArgs('claude')).toEqual(['--mcp-config', '/x.json'])
    for (let i = 0; i < 100 && !existsSync(deps.socketPath); i++) await new Promise((r) => setTimeout(r, 10))
    const token = pty.orch!.tokens.issue('coord')
    const res = await pedir(deps.socketPath, { id: '1', method: 'worker.list', params: {}, token })
    expect(res).toEqual({ id: '1', ok: true, result: [] })

    // Y en main.ts la llamada vive FUERA del try de Memories (que puede dejar memory === null).
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8')
    const ini = main.indexOf('let memory: MemorySubsystem | null = null')
    const fin = main.indexOf('memory = null\n}', ini)
    const llamada = main.indexOf('wireOrchestration({')
    expect(ini).toBeGreaterThan(-1)
    expect(fin).toBeGreaterThan(ini)
    expect(llamada).toBeGreaterThan(-1)
    expect(llamada > ini && llamada < fin).toBe(false)
  })

  it('launch-pane sin respuesta en 10 s da error al agente', async () => {
    vi.useFakeTimers()
    const { sent, w } = mk()
    let resultado: unknown = 'pendiente'
    const p = w.service.handle('coord', 'worker.launch', { task: 't', label: 'api' }).then(
      () => 'ok',
      (e: Error) => e.message
    ).then((x) => { resultado = x })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(sent.some(([c]) => c === 'orchestration:launch-pane')).toBe(true)
    expect(resultado).toBe('pendiente')
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(resultado).toBe('no_tab')
    // Sin registro colgado: el cupo de workers no se come.
    expect(w.service.snapshot()).toEqual([])
  })

  it('sin ventana, launch-pane falla enseguida con no_tab', async () => {
    const { w } = mk({ send: () => false })
    await expect(w.service.handle('coord', 'worker.launch', { task: 't', label: 'api' })).rejects.toThrow('no_tab')
  })

  it('respuesta del renderer: ok abre el worker, error inválido se normaliza, requestId ajeno se ignora', async () => {
    const { pty, sent, w } = mk()
    const { req, r } = await lanzar(pty, sent, w)
    expect(req).toMatchObject({ coordinatorPaneId: 'coord', label: 'api', repoPath: expect.stringMatching(/^\/wt\/nest\//), cmd: 'claude' })
    expect(typeof req.requestId).toBe('string')
    expect(w.service.snapshot()[0]).toMatchObject({ workerId: r.workerId, status: 'working', baseBranch: 'feat/base' })
    expect(sent.some(([c]) => c === 'orchestration:changed')).toBe(true)

    w.replyLaunchPane({ requestId: 'nadie', ok: true })
    const p2 = w.service.handle('coord', 'worker.launch', { task: 't', label: 'b' })
    for (let i = 0; i < 20 && sent.filter(([c]) => c === 'orchestration:launch-pane').length < 2; i++) await Promise.resolve()
    const req2 = sent.filter(([c]) => c === 'orchestration:launch-pane')[1][1]
    w.replyLaunchPane({ requestId: req2.requestId, ok: false, error: '<script>' })
    await expect(p2).rejects.toThrow('no_tab')
  })

  it('tab_full del renderer llega tal cual', async () => {
    const { sent, w } = mk()
    const p = w.service.handle('coord', 'worker.launch', { task: 't', label: 'api' })
    for (let i = 0; i < 20 && !sent.some(([c]) => c === 'orchestration:launch-pane'); i++) await Promise.resolve()
    const req = sent.find(([c]) => c === 'orchestration:launch-pane')![1]
    w.replyLaunchPane({ requestId: req.requestId, ok: false, error: 'tab_full' })
    await expect(p).rejects.toThrow('tab_full')
  })

  it('exit de un worker: el coordinador recibe el puntero por writeInternal', async () => {
    const { pty, sent, w } = mk()
    const { req } = await lanzar(pty, sent, w)
    pty.infos.delete(req.paneId)
    pty.emit('exit', req.paneId, 3)
    expect(w.service.snapshot()[0].status).toBe('exited')
    expect(pty.writes).toContainEqual(['coord', pointerLine(1)])
  })

  it('input del usuario en el coordinador (borrador) frena el puntero', async () => {
    const { pty, sent, w } = mk()
    const { req } = await lanzar(pty, sent, w)
    pty.emit('input', 'coord', 'half typed')
    pty.emit('exit', req.paneId, 0)
    expect(pty.writes.filter(([id]) => id === 'coord')).toEqual([])
  })

  it('data reciente en el coordinador (no quieto) frena el puntero', async () => {
    const { pty, sent, w } = mk()
    const { req } = await lanzar(pty, sent, w)
    pty.emit('data', 'coord', 'thinking...')
    pty.emit('exit', req.paneId, 0)
    expect(pty.writes.filter(([id]) => id === 'coord')).toEqual([])
  })

  it('el vigía del worker se arma con su primer output y marca needs_input', async () => {
    vi.useFakeTimers()
    const { pty, sent, w } = mk()
    const { req } = await lanzar(pty, sent, w)
    pty.buffers.set(req.paneId, 'Do you want to proceed?\n❯ 1. Yes')
    pty.emit('data', req.paneId, 'Do you want to proceed?')
    await vi.advanceTimersByTimeAsync(6_000)
    expect(w.service.snapshot()[0].status).toBe('needs_input')
  })

  it('closePane del servicio manda close-pane al renderer', async () => {
    const { pty, sent, w } = mk()
    const { r, req } = await lanzar(pty, sent, w)
    await w.service.handle('coord', 'worker.stop', { workerId: r.workerId })
    expect(pty.killed).toContain(req.paneId)
    expect(sent).toContainEqual(['orchestration:close-pane', { paneId: req.paneId }])
  })

  it('defaultAccount: primera cuenta guardada del agente, o no_account_for_agent', async () => {
    const { pty, sent, w } = mk()
    const p = w.service.handle('coord', 'worker.launch', { task: 't', label: 'x', agent: 'codex' })
    for (let i = 0; i < 20 && !sent.some(([c]) => c === 'orchestration:launch-pane'); i++) await Promise.resolve()
    const req = rendererAcepta(pty, sent, w)
    await p
    expect(req).toMatchObject({ aiType: 'codex', cmd: 'codex', accountDir: '/acc/codex/work', accountName: 'work' })

    const m2 = mk({ accounts: { list: () => [], getDir: () => '' } })
    m2.pty.infos.set('coord', { ...COORD, aiType: 'codex', cmd: 'codex' })
    await expect(m2.w.service.handle('coord', 'worker.launch', { task: 't', label: 'x', agent: 'claude' })).rejects.toThrow('no_account_for_agent')
    m2.w.stop()
  })

  it('currentBranch e isClean usan git con args en array y timeout', async () => {
    const { pty, sent, w, runGit } = mk()
    await lanzar(pty, sent, w)
    expect(runGit).toHaveBeenCalledWith(['-C', '/repo', 'rev-parse', '--abbrev-ref', 'HEAD'], expect.objectContaining({ timeout: expect.any(Number) }))
  })

  it('stop revoca tokens y libera los pedidos pendientes', async () => {
    const { pty, sent, w } = mk()
    const token = pty.orch!.tokens.issue('coord')
    const p = w.service.handle('coord', 'worker.launch', { task: 't', label: 'api' })
    for (let i = 0; i < 20 && !sent.some(([c]) => c === 'orchestration:launch-pane'); i++) await Promise.resolve()
    w.stop()
    wiring = null
    await expect(p).rejects.toThrow('no_tab')
    expect(pty.orch!.tokens.resolve(token)).toBeNull()
  })

  it('stop borra el socket del disco', async () => {
    const { w, deps } = mk()
    for (let i = 0; i < 100 && !existsSync(deps.socketPath); i++) await new Promise((r) => setTimeout(r, 10))
    expect(existsSync(deps.socketPath)).toBe(true)
    w.stop()
    wiring = null
    expect(existsSync(deps.socketPath)).toBe(false)
  })
})
