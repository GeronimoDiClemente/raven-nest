// T6 — Test de integración "todos los buses". A diferencia de los tests unitarios
// de cada pieza (bus-types / event-bus / recipes / bus-commands en aislamiento),
// acá se arma el sistema COMPLETO y real: un `EventBus`, las `DEFAULT_RECIPES` que
// replican H3, y los handlers de comandos reales (`registerBusCommands`) contra un
// provider espiado. Se emite la secuencia task.created → pr.opened → pr.merged y se
// verifica que los comandos disparados y las transiciones del provider ocurren en
// orden con los IDs del tracking resueltos. Este test ES la demostración del
// enrutamiento evento→comando de punta a punta.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventBus } from '../integrations/event-bus'
import { defaultRecipes, type TrackedLookup, type TrackedRef } from '../integrations/recipes'
import { registerBusCommands, type TicketProviderResolver } from '../integrations/bus-commands'
import type { Command, DomainEvent } from '../integrations/bus-types'
import type { PanelAdapterDeps } from '../integration-panels'
import type { TicketProvider } from '../integrations/ticket-types'

const BRANCH = 'feat/login'
const REPO = 'acme/webapp'
const TRACKED: TrackedRef = { pluginId: 'jira', providerId: 'PROJ-42' }

// Deps mínimas: opacas para el bus, sólo el handler `notify` las tocaría (acá no).
function makeDeps(over: Partial<PanelAdapterDeps> = {}): PanelAdapterDeps {
  return {
    getToken: () => null,
    getConfig: () => ({}),
    fetch: vi.fn(),
    ...over,
  } as unknown as PanelAdapterDeps
}

function makeProvider(): TicketProvider {
  return { listMyTickets: vi.fn(async () => []), transition: vi.fn(async () => {}) }
}

// Tracking fake vivo: replica el branch→Tracked del TicketLoop sin importar
// ticket-loop.ts. Mutable para poder simular el borrado post-merge de H3.
function makeTracking() {
  const map = new Map<string, TrackedRef>([[BRANCH, { ...TRACKED }]])
  const lookup: TrackedLookup = (branch) => map.get(branch)
  return { map, lookup }
}

const evTaskCreated: DomainEvent = {
  type: 'task.created', taskId: TRACKED.providerId, pluginId: TRACKED.pluginId,
  providerId: TRACKED.providerId, repoFullName: REPO, branch: BRANCH, title: 'Login',
}
const evPrOpened: DomainEvent = { type: 'pr.opened', branch: BRANCH, repoFullName: REPO }
const evPrMerged: DomainEvent = { type: 'pr.merged', branch: BRANCH, repoFullName: REPO }

describe('bus-integration: todos los buses (evento → receta → comando → provider)', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('la secuencia task.created → pr.opened → pr.merged dispara updateStatus in_review y done en orden', async () => {
    const { lookup } = makeTracking()
    const provider = makeProvider()
    const resolver: TicketProviderResolver = { providerFor: vi.fn(() => provider) }

    const bus = new EventBus()
    bus.setRecipes(defaultRecipes(lookup))
    registerBusCommands(bus, { ticketLoop: resolver })

    const deps = makeDeps()

    // task.created: la receta v1 es no-op (evita doble transición a in_progress).
    const created = await bus.emit(evTaskCreated, deps)
    expect(created.commands).toEqual([])

    // pr.opened → updateStatus(to:in_review) con los IDs del tracking resueltos.
    const opened = await bus.emit(evPrOpened, deps)
    expect(opened.commands).toEqual([
      { cmd: 'updateStatus', pluginId: 'jira', providerId: 'PROJ-42', to: 'in_review' },
    ])

    // pr.merged → updateStatus(to:done).
    const merged = await bus.emit(evPrMerged, deps)
    expect(merged.commands).toEqual([
      { cmd: 'updateStatus', pluginId: 'jira', providerId: 'PROJ-42', to: 'done' },
    ])

    // El provider real recibió exactamente las dos transiciones, en orden.
    const transition = provider.transition as ReturnType<typeof vi.fn>
    expect(transition.mock.calls).toEqual([
      ['PROJ-42', 'in_review'],
      ['PROJ-42', 'done'],
    ])
    // El provider se resolvió vía el pluginId del tracking, con las deps inyectadas.
    expect(resolver.providerFor).toHaveBeenCalledWith('jira', deps)
  })

  it('con handlers espiados (vi.fn), los comandos llegan al handler correcto en la secuencia', async () => {
    const { lookup } = makeTracking()
    const updateStatus = vi.fn(async () => {})
    const notify = vi.fn(async () => {})

    const bus = new EventBus()
    bus.setRecipes(defaultRecipes(lookup))
    bus.registerHandler('updateStatus', updateStatus)
    bus.registerHandler('notify', notify)

    const deps = makeDeps()
    await bus.emit(evTaskCreated, deps)
    await bus.emit(evPrOpened, deps)
    await bus.emit(evPrMerged, deps)

    // notify nunca se dispara con las DEFAULT_RECIPES (gancho v2).
    expect(notify).not.toHaveBeenCalled()
    // updateStatus recibió in_review y luego done, con el evento origen como 2º arg.
    expect(updateStatus.mock.calls.map((c) => (c[0] as Command & { to: string }).to)).toEqual([
      'in_review', 'done',
    ])
    expect((updateStatus.mock.calls[0][1] as DomainEvent).type).toBe('pr.opened')
    expect((updateStatus.mock.calls[1][1] as DomainEvent).type).toBe('pr.merged')
  })

  it('si el branch no está trackeado, ningún comando se dispara (paridad con H3 if(!t) return)', async () => {
    const emptyLookup: TrackedLookup = () => undefined
    const provider = makeProvider()
    const bus = new EventBus()
    bus.setRecipes(defaultRecipes(emptyLookup))
    registerBusCommands(bus, { ticketLoop: { providerFor: () => provider } })

    const opened = await bus.emit(evPrOpened, makeDeps())
    const merged = await bus.emit(evPrMerged, makeDeps())
    expect(opened.commands).toEqual([])
    expect(merged.commands).toEqual([])
    expect(provider.transition).not.toHaveBeenCalled()
  })

  it('el emit resuelve el tracking del branch mientras sigue vivo (borrado post-emit no afecta la transición)', async () => {
    // Modela el invariante de T4: en merge, el emit corre ANTES de tracked.delete.
    // Acá lo demostramos borrando el tracking DESPUÉS del emit y verificando que la
    // transición ya se materializó con los IDs correctos.
    const { map, lookup } = makeTracking()
    const provider = makeProvider()
    const bus = new EventBus()
    bus.setRecipes(defaultRecipes(lookup))
    registerBusCommands(bus, { ticketLoop: { providerFor: () => provider } })

    const merged = await bus.emit(evPrMerged, makeDeps())
    map.delete(BRANCH) // H3 borraría el tracking recién ahora

    expect(merged.commands).toEqual([
      { cmd: 'updateStatus', pluginId: 'jira', providerId: 'PROJ-42', to: 'done' },
    ])
    expect(provider.transition).toHaveBeenCalledWith('PROJ-42', 'done')
    // tras el borrado, un nuevo emit del mismo branch ya no resuelve comando.
    expect((await bus.emit(evPrMerged, makeDeps())).commands).toEqual([])
  })
})
