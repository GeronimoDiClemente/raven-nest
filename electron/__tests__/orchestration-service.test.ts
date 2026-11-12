import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OrchestrationService, branchName, type OrchestrationDeps, type PaneInfo, type LaunchPaneRequest } from '../orchestration/orchestration-service'

const COORD: PaneInfo = {
  paneId: 'coord', cmd: 'claude --foo', accountDir: '/acc/claude-main', aiType: 'claude', cwd: '/repo'
}

function mk(over: Partial<OrchestrationDeps> = {}) {
  const panes = new Map<string, PaneInfo>([['coord', COORD]])
  const deps = {
    paneInfo: vi.fn((id: string) => panes.get(id)),
    defaultAccount: vi.fn((a: string) =>
      a === 'codex' ? { accountDir: '/acc/codex', cmd: 'codex', accountName: 'codex-def' } : null),
    createWorktree: vi.fn(async (_r: string, b: string) => ({ ok: true as const, worktreePath: `/wt/${b.replace('/', '_')}` })),
    currentBranch: vi.fn(async () => 'feat/x'),
    isClean: vi.fn(async (_p: string) => true),
    requestPane: vi.fn(async (_req: LaunchPaneRequest): Promise<Awaited<ReturnType<OrchestrationDeps['requestPane']>>> => ({ ok: true, tabPaneCount: 2 })),
    closePane: vi.fn(),
    killPane: vi.fn(),
    writePty: vi.fn(),
    bufferTail: vi.fn(() => 'x'.repeat(5000)),
    now: vi.fn(() => 1000),
    onChange: vi.fn(),
    notifyCoordinator: vi.fn()
  }
  Object.assign(deps, over)
  const svc = new OrchestrationService(deps)
  // Los panes de los workers los registra el PtyManager; acá se simula al pedirlos.
  deps.requestPane.mockImplementation(async (req) => {
    panes.set(req.paneId, { paneId: req.paneId, cmd: req.cmd, accountDir: req.accountDir, aiType: req.aiType, cwd: req.repoPath })
    return { ok: true as const, tabPaneCount: 2 }
  })
  return { svc, deps, panes }
}

const launch = (svc: OrchestrationService, label = 'api', extra: object = {}) =>
  svc.handle('coord', 'worker.launch', { task: 'do it', label, ...extra }) as Promise<{ workerId: string; branch: string; label: string }>

describe('OrchestrationService', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('launch usa cmd y accountDir del coordinador sin cambios', async () => {
    const { svc, deps } = mk()
    const r = await launch(svc)
    const req = deps.requestPane.mock.calls[0][0]
    expect(req.cmd).toBe('claude --foo')
    expect(req.accountDir).toBe('/acc/claude-main')
    expect(req.accountName).toBe('claude-main')
    expect(req.repoPath).toBe(`/wt/${r.branch.replace('/', '_')}`)
    expect(req.initialInput).toContain(r.branch)
    expect(req.initialInput).toContain('feat/x')
    expect(deps.createWorktree).toHaveBeenCalledWith('/repo', r.branch)
    expect(svc.snapshot()[0].status).toBe('working')
  })

  it('launch con otro agente usa su cuenta por defecto', async () => {
    const { svc, deps } = mk()
    await launch(svc, 'x', { agent: 'codex' })
    const req = deps.requestPane.mock.calls[0][0]
    expect(req).toMatchObject({ cmd: 'codex', accountDir: '/acc/codex', accountName: 'codex-def', aiType: 'codex' })
  })

  it('launch con agente sin cuenta da no_account_for_agent', async () => {
    const { svc, deps } = mk({ defaultAccount: vi.fn(() => null) })
    await expect(launch(svc, 'x', { agent: 'codex' })).rejects.toThrow('no_account_for_agent')
    expect(deps.createWorktree).not.toHaveBeenCalled()
  })

  it('misma etiqueta da ramas distintas', async () => {
    const { svc } = mk()
    const a = await launch(svc, 'Same Label!')
    const b = await launch(svc, 'Same Label!')
    expect(a.branch).not.toBe(b.branch)
    for (const x of [a, b]) expect(x.branch).toMatch(/^nest\/same-label-[0-9a-f]{6}$/)
  })

  it('branchName: slug vacío, largo y regex', () => {
    expect(branchName('???', 'abcdef123')).toBe('nest/worker-abcdef')
    const b = branchName('a'.repeat(100), 'abcdef123')
    expect(b).toMatch(/^[a-zA-Z0-9._/\-]+$/)
    expect(b.length).toBeLessThan(55)
  })

  it('launch: quinto worker vivo da worker_limit; tab_full no deja registro', async () => {
    const { svc, deps } = mk()
    for (let i = 0; i < 4; i++) await launch(svc, `w${i}`)
    await expect(launch(svc, 'w5')).rejects.toThrow('worker_limit')
    const m2 = mk()
    m2.deps.requestPane.mockResolvedValueOnce({ ok: false, error: 'tab_full' })
    await expect(launch(m2.svc)).rejects.toThrow('tab_full')
    expect(m2.svc.snapshot()).toHaveLength(0)
    expect(deps.killPane).not.toHaveBeenCalled()
  })

  it('done con worktree sucio da worktree_dirty y no cambia status', async () => {
    const { svc, deps } = mk()
    const r = await launch(svc)
    const wp = deps.requestPane.mock.calls[0][0].paneId
    deps.isClean.mockResolvedValue(false)
    await expect(svc.handle(wp, 'worker.report', { kind: 'done', text: 't' })).rejects.toThrow('worktree_dirty')
    expect(svc.snapshot().find((w) => w.workerId === r.workerId)!.status).toBe('working')
    expect(deps.notifyCoordinator).not.toHaveBeenCalled()
  })

  it('done limpio deja status done y mensaje pendiente', async () => {
    const { svc, deps } = mk()
    await launch(svc)
    const wp = deps.requestPane.mock.calls[0][0].paneId
    await svc.handle(wp, 'worker.report', { kind: 'done', text: 'listo' })
    expect(svc.snapshot()[0].status).toBe('done')
    expect(deps.notifyCoordinator).toHaveBeenCalledWith('coord')
    const msgs = (await svc.handle('coord', 'inbox.read', {})) as Array<{ kind: string; text: string }>
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ kind: 'done', text: 'listo' })
  })

  it('question deja needs_input', async () => {
    const { svc, deps } = mk()
    await launch(svc)
    await svc.handle(deps.requestPane.mock.calls[0][0].paneId, 'worker.report', { kind: 'question', text: '?' })
    expect(svc.snapshot()[0].status).toBe('needs_input')
  })

  it('params.paneId ajeno se ignora (caller = token)', async () => {
    const { svc, deps } = mk()
    await launch(svc)
    const wp = deps.requestPane.mock.calls[0][0].paneId
    // el worker intenta pasarse por el coordinador: sigue siendo worker
    await expect(svc.handle(wp, 'inbox.read', { paneId: 'coord' })).rejects.toThrow('not_a_coordinator')
    await expect(svc.handle(wp, 'worker.list', { paneId: 'coord' })).rejects.toThrow('not_a_coordinator')
    await expect(svc.handle(wp, 'worker.launch', { task: 't', label: 'l', paneId: 'coord' })).rejects.toThrow('nesting_not_allowed')
  })

  it('roles: report de no-worker, worker ajeno y pane desconocido', async () => {
    const { svc, deps, panes } = mk()
    const r = await launch(svc)
    await expect(svc.handle('coord', 'worker.report', { kind: 'done', text: '' })).rejects.toThrow('not_a_coordinator')
    panes.set('otro', { ...COORD, paneId: 'otro' })
    await expect(svc.handle('otro', 'worker.read', { workerId: r.workerId })).rejects.toThrow('unknown_worker')
    await expect(svc.handle('otro', 'worker.send', { workerId: r.workerId, text: 'x' })).rejects.toThrow('unknown_worker')
    await expect(svc.handle('otro', 'worker.stop', { workerId: r.workerId })).rejects.toThrow('unknown_worker')
    await expect(svc.handle('nadie', 'worker.list', {})).rejects.toThrow('unauthorized')
    expect(deps.killPane).not.toHaveBeenCalled()
  })

  it('worker que muere sin done genera exited', async () => {
    const { svc, deps } = mk()
    await launch(svc)
    svc.onPaneExit(deps.requestPane.mock.calls[0][0].paneId, 3)
    expect(svc.snapshot()[0].status).toBe('exited')
    const msgs = (await svc.handle('coord', 'inbox.read', {})) as Array<{ kind: string; text: string }>
    expect(msgs[0]).toMatchObject({ kind: 'exited', text: 'exit code 3' })
  })

  it('worker done que sale no genera exited', async () => {
    const { svc, deps } = mk()
    await launch(svc)
    const wp = deps.requestPane.mock.calls[0][0].paneId
    await svc.handle(wp, 'worker.report', { kind: 'done', text: 'ok' })
    svc.onPaneExit(wp, 0)
    expect(svc.snapshot()[0].status).toBe('done')
    expect(await svc.handle('coord', 'inbox.read', {})).toHaveLength(1)
  })

  it('stopCoordinator mata workers y conserva ramas', async () => {
    const { svc, deps } = mk()
    await launch(svc, 'a')
    await launch(svc, 'b')
    svc.stopCoordinator('coord')
    expect(deps.killPane).toHaveBeenCalledTimes(2)
    expect(deps.closePane).toHaveBeenCalledTimes(2)
    expect(svc.snapshot()).toHaveLength(0)
    // la única API de worktrees del servicio es createWorktree: nada borra
    expect(deps.createWorktree).toHaveBeenCalledTimes(2)
  })

  it('cerrar el pane coordinador dispara stopCoordinator', async () => {
    const { svc, deps } = mk()
    await launch(svc)
    svc.onPaneExit('coord', 0)
    expect(deps.killPane).toHaveBeenCalledTimes(1)
    expect(svc.snapshot()).toHaveLength(0)
  })

  it('inbox.wait vence con timedOut', async () => {
    const { svc } = mk()
    const p = svc.handle('coord', 'inbox.wait', { timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await p).toEqual({ timedOut: true })
  })

  it('inbox.wait: clamp a 240 s y despierta con push', async () => {
    const { svc, deps } = mk()
    await launch(svc)
    const wp = deps.requestPane.mock.calls[0][0].paneId
    const p = svc.handle('coord', 'inbox.wait', { timeoutMs: 9_999_999 })
    await vi.advanceTimersByTimeAsync(1000)
    await svc.handle(wp, 'worker.report', { kind: 'blocked', text: 'b' })
    const r = (await p) as Array<{ kind: string }>
    expect(r[0].kind).toBe('blocked')
    // ya entregado: inbox.read no lo repite
    expect(await svc.handle('coord', 'inbox.read', {})).toEqual([])
    const p2 = svc.handle('coord', 'inbox.wait', { timeoutMs: 9_999_999 })
    await vi.advanceTimersByTimeAsync(239_999)
    let done = false
    void p2.then(() => (done = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p2).toEqual({ timedOut: true })
  })

  it('inbox.wait resuelve ya si hay pendientes', async () => {
    const { svc, deps } = mk()
    await launch(svc)
    svc.onPaneExit(deps.requestPane.mock.calls[0][0].paneId, 1)
    const r = (await svc.handle('coord', 'inbox.wait', {})) as unknown[]
    expect(r).toHaveLength(1)
  })

  it('worker.read devuelve los últimos 4000 chars; worker.send tipea y manda Enter', async () => {
    const { svc, deps } = mk()
    const l = await launch(svc)
    const wp = deps.requestPane.mock.calls[0][0].paneId
    const r = (await svc.handle('coord', 'worker.read', { workerId: l.workerId })) as { worker: { workerId: string }; output: string }
    expect(r.worker.workerId).toBe(l.workerId)
    expect(r.output).toHaveLength(4000)
    await svc.handle('coord', 'worker.send', { workerId: l.workerId, text: 'hola' })
    expect(deps.writePty).toHaveBeenLastCalledWith(wp, 'hola')
    vi.advanceTimersByTime(500)
    expect(deps.writePty).toHaveBeenLastCalledWith(wp, '\r')
  })

  it('worker.stop: uno o todos los vivos', async () => {
    const { svc, deps } = mk()
    const a = await launch(svc, 'a')
    await launch(svc, 'b')
    await svc.handle('coord', 'worker.stop', { workerId: a.workerId })
    expect(deps.killPane).toHaveBeenCalledTimes(1)
    expect(svc.snapshot().find((w) => w.workerId === a.workerId)!.status).toBe('stopped')
    await svc.handle('coord', 'worker.stop', {})
    expect(deps.killPane).toHaveBeenCalledTimes(2)
    expect(deps.closePane).toHaveBeenCalledTimes(2)
  })

  it('onAgentNeedsInput marca needs_input y avisa', async () => {
    const { svc, deps } = mk()
    await launch(svc)
    svc.onAgentNeedsInput(deps.requestPane.mock.calls[0][0].paneId)
    expect(svc.snapshot()[0].status).toBe('needs_input')
    expect(deps.notifyCoordinator).toHaveBeenCalled()
  })
})
