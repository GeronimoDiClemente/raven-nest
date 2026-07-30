import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TicketLoop } from '../ticket-loop'
import type { Ticket, TicketProvider } from '../integrations/ticket-types'
import { EventBus } from '../integrations/event-bus'
import { defaultRecipes } from '../integrations/recipes'
import type { Command, DomainEvent } from '../integrations/bus-types'

const ticket: Ticket = {
  key: 'PROJ-1', providerId: 'p1', title: 'Fix', url: 'u', state: 'todo', context: 'ctx',
}

function makeProvider(): TicketProvider {
  return { listMyTickets: vi.fn(async () => [ticket]), transition: vi.fn(async () => {}) }
}

describe('TicketLoop', () => {
  let provider: TicketProvider
  let loop: TicketLoop

  beforeEach(() => {
    provider = makeProvider()
    loop = new TicketLoop()
    loop.register('jira', () => provider)
  })

  it('list delega en el provider registrado', async () => {
    expect(await loop.list('jira', {} as never)).toEqual([ticket])
  })

  it('list con provider desconocido devuelve error tipado, no throw', async () => {
    await expect(loop.list('nope', {} as never)).resolves.toEqual([])
  })

  it('startWork transiciona a in_progress y registra el tracking branch→ticket', async () => {
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never)
    expect(provider.transition).toHaveBeenCalledWith('p1', 'in_progress')
    expect(loop.trackedTicket('gero/PROJ-1-fix')).toMatchObject({ providerId: 'p1', pluginId: 'jira' })
  })

  it('onPrStateChanged transiciona según el evento', async () => {
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never)
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'open', {} as never)
    expect(provider.transition).toHaveBeenLastCalledWith('p1', 'in_review')
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'merged', {} as never)
    expect(provider.transition).toHaveBeenLastCalledWith('p1', 'done')
  })

  it('onPrStateChanged con branch no trackeado es no-op', async () => {
    await expect(loop.onPrStateChanged('otra/rama', 'merged', {} as never)).resolves.toBeUndefined()
  })

  it('onPrStateChanged NO re-dispara in_review mientras el PR sigue open', async () => {
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never)
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'open', {} as never)
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'open', {} as never)
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'open', {} as never)
    const calls = (provider.transition as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.filter(c => c[1] === 'in_review')).toHaveLength(1)
    // a real state change still transitions
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'merged', {} as never)
    expect(provider.transition).toHaveBeenLastCalledWith('p1', 'done')
  })

  it('onPrStateChanged reintenta in_review si la transición falló', async () => {
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never)
    ;(provider.transition as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('jira 500'))
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'open', {} as never) // fails
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'open', {} as never) // retries
    const calls = (provider.transition as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.filter(c => c[1] === 'in_review')).toHaveLength(2)
  })

  it('pollOnce consulta PRs por branch trackeado en ESE repo y dispara transiciones', async () => {
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never, 'acme/app')
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('state=all')) {
        return new Response(JSON.stringify([{ state: 'closed', merged_at: '2026-07-12T00:00:00Z' }]), { status: 200 })
      }
      return new Response('[]', { status: 200 })
    })
    const deps = { getToken: () => 'tok', getConfig: () => ({}), fetch: fetchMock as unknown as typeof fetch }
    await loop.pollOnce('acme/app', deps)
    expect(provider.transition).toHaveBeenLastCalledWith('p1', 'done')
  })

  it('pollOnce ignora branches trackeados contra OTRO repo (ni request ni transición)', async () => {
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never, 'acme/app')
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ state: 'closed', merged_at: '2026-07-12T00:00:00Z' }]), { status: 200 }))
    const deps = { getToken: () => 'tok', getConfig: () => ({}), fetch: fetchMock as unknown as typeof fetch }
    await loop.pollOnce('other/repo', deps)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(provider.transition).not.toHaveBeenCalledWith('p1', 'done')
  })

  it('trackedRepos devuelve los repos únicos de los branches trackeados', async () => {
    await loop.startWork('jira', ticket, 'rama-1', {} as never, 'acme/app')
    await loop.startWork('jira', { ...ticket, providerId: 'p2', key: 'PROJ-2' }, 'rama-2', {} as never, 'acme/app')
    await loop.startWork('jira', { ...ticket, providerId: 'p3', key: 'PROJ-3' }, 'rama-3', {} as never, null)
    expect(loop.trackedRepos()).toEqual(['acme/app'])
  })

  it('attachStorage persiste el tracking y lo restaura en otra instancia (restart)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ticket-loop-'))
    const file = join(dir, 'ticket-loop.json')
    try {
      loop.attachStorage(file)
      await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never, 'acme/app')

      const loop2 = new TicketLoop()
      loop2.register('jira', () => provider)
      loop2.attachStorage(file)
      expect(loop2.trackedTicket('gero/PROJ-1-fix')).toMatchObject({
        pluginId: 'jira', providerId: 'p1', repoFullName: 'acme/app',
      })
      expect(loop2.trackedRepos()).toEqual(['acme/app'])

      // merged after the "restart" still resolves to done and untracks
      await loop2.onPrStateChanged('gero/PROJ-1-fix', 'merged', {} as never)
      expect(provider.transition).toHaveBeenLastCalledWith('p1', 'done')
      expect(loop2.trackedTicket('gero/PROJ-1-fix')).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('retainBranches descarta el tracking de worktrees que ya no existen', async () => {
    await loop.startWork('jira', ticket, 'rama-viva', {} as never, 'acme/app')
    await loop.startWork('jira', { ...ticket, providerId: 'p2', key: 'PROJ-2' }, 'rama-muerta', {} as never, 'acme/app')
    loop.retainBranches(['rama-viva'])
    expect(loop.trackedTicket('rama-viva')).toBeDefined()
    expect(loop.trackedTicket('rama-muerta')).toBeUndefined()
  })
})

describe('TicketLoop con bus adjunto', () => {
  let provider: TicketProvider
  let loop: TicketLoop
  let bus: EventBus
  let commands: Command[]

  beforeEach(() => {
    provider = makeProvider()
    loop = new TicketLoop()
    loop.register('jira', () => provider)
    bus = new EventBus()
    // Recetas por defecto (replican H3): resuelven branch→ticket via el tracking vivo del loop.
    bus.setRecipes(defaultRecipes((branch) => loop.trackedTicket(branch)))
    commands = []
    // Handler real de updateStatus: materializa el comando en el provider.
    bus.registerHandler('updateStatus', async (cmd) => {
      commands.push(cmd)
      if (cmd.cmd === 'updateStatus') await provider.transition(cmd.providerId, cmd.to)
    })
    loop.attachBus(bus)
  })

  it('startWork mantiene la transición directa a in_progress y ADEMÁS emite task.created + session.opened', async () => {
    const emitSpy = vi.spyOn(bus, 'emit')
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never, 'acme/app')
    expect(provider.transition).toHaveBeenCalledWith('p1', 'in_progress')
    const types = emitSpy.mock.calls.map((c) => (c[0] as DomainEvent).type)
    expect(types).toContain('task.created')
    expect(types).toContain('session.opened')
    // task.created es no-op en v1: NO debe re-disparar in_progress por el bus (doble transición).
    expect((provider.transition as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[1] === 'in_progress')).toHaveLength(1)
  })

  it('onPrStateChanged open enruta pr.opened→updateStatus in_review por el bus', async () => {
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never, 'acme/app')
    ;(provider.transition as ReturnType<typeof vi.fn>).mockClear()
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'open', {} as never)
    expect(commands).toContainEqual({ cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to: 'in_review' })
    expect(provider.transition).toHaveBeenCalledWith('p1', 'in_review')
  })

  it('onPrStateChanged merged enruta pr.merged→updateStatus done, destrackea, y el emit ve el branch vivo', async () => {
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never, 'acme/app')
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'merged', {} as never)
    // El comando se resolvió con los IDs del tracking → el emit corrió ANTES del delete.
    expect(commands).toContainEqual({ cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to: 'done' })
    expect(loop.trackedTicket('gero/PROJ-1-fix')).toBeUndefined()
  })

  it('con bus preserva el guard lastPr: no re-emite pr.opened mientras el PR sigue open', async () => {
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never, 'acme/app')
    const emitSpy = vi.spyOn(bus, 'emit')
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'open', {} as never)
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'open', {} as never)
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'open', {} as never)
    const prOpened = emitSpy.mock.calls.filter((c) => (c[0] as DomainEvent).type === 'pr.opened')
    expect(prOpened).toHaveLength(1)
    // un cambio real de estado sí enruta done
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'merged', {} as never)
    expect(commands.at(-1)).toEqual({ cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to: 'done' })
  })

  it('con bus, si la transición merged falla el tracking sobrevive y el próximo poll reintenta', async () => {
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never, 'acme/app')
    ;(provider.transition as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('jira 500'))
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'merged', {} as never) // transición falla dentro del handler
    // El ticket NUNCA llegó a done: el tracking debe seguir vivo para reintentar (no stuck).
    expect(loop.trackedTicket('gero/PROJ-1-fix')).toBeDefined()
    // Próximo poll: re-emite pr.merged → transición reintenta (ahora OK) → destrackea.
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'merged', {} as never)
    const done = (provider.transition as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[1] === 'done')
    expect(done).toHaveLength(2)
    expect(loop.trackedTicket('gero/PROJ-1-fix')).toBeUndefined()
  })

  it('con bus, si la transición in_review falla NO se marca lastPr y se reintenta (paridad con H3)', async () => {
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never, 'acme/app')
    ;(provider.transition as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('jira 500'))
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'open', {} as never) // falla
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'open', {} as never) // reintenta (lastPr no quedó marcado)
    const inReview = (provider.transition as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[1] === 'in_review')
    expect(inReview).toHaveLength(2)
  })

  it('sin bus adjunto el comportamiento es idéntico al H3 directo (transición sin emit)', async () => {
    const bare = new TicketLoop()
    bare.register('jira', () => provider)
    await bare.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never, 'acme/app')
    await bare.onPrStateChanged('gero/PROJ-1-fix', 'open', {} as never)
    expect(provider.transition).toHaveBeenLastCalledWith('p1', 'in_review')
    expect(commands).toHaveLength(0) // ningún comando pasó por el bus
  })
})
