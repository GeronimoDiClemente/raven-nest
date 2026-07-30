import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerBusCommands, type TicketProviderResolver, type OpenSessionFn } from '../integrations/bus-commands'
import type { CommandHandler } from '../integrations/event-bus'
import { EventBus } from '../integrations/event-bus'
import type { Command, DomainEvent } from '../integrations/bus-types'
import type { PanelAdapterDeps } from '../integration-panels'
import type { TicketProvider } from '../integrations/ticket-types'

// Bus falso que captura los handlers registrados en un Map, para invocarlos
// directamente y testear cada handler en aislamiento (sin recetas ni emit).
function capturingBus() {
  const handlers = new Map<Command['cmd'], CommandHandler>()
  const bus = { registerHandler: (cmd: Command['cmd'], h: CommandHandler) => handlers.set(cmd, h) } as unknown as EventBus
  return { bus, handlers }
}

function makeDeps(over: Partial<PanelAdapterDeps> = {}): PanelAdapterDeps {
  return {
    getToken: () => null,
    getConfig: () => ({}),
    fetch: vi.fn(),
    ...over,
  } as unknown as PanelAdapterDeps
}

// Provider base (solo listMyTickets/transition, sin createTask).
function makeProvider(): TicketProvider {
  return { listMyTickets: vi.fn(async () => []), transition: vi.fn(async () => {}) }
}

const evPrOpened: DomainEvent = { type: 'pr.opened', branch: 'feat/x', repoFullName: 'o/r' }
const evTaskCreated: DomainEvent = {
  type: 'task.created', taskId: 'PROJ-1', pluginId: 'jira', providerId: 'p1', repoFullName: 'o/r', branch: 'feat/x',
}

describe('registerBusCommands', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('registra los handlers estándar', () => {
    const { bus, handlers } = capturingBus()
    const resolver: TicketProviderResolver = { providerFor: () => makeProvider() }
    registerBusCommands(bus, { ticketLoop: resolver })
    expect([...handlers.keys()].sort()).toEqual(['createTask', 'logOutcome', 'notify', 'openSession', 'setPresence', 'updateStatus'])
  })

  // ── updateStatus ──────────────────────────────────────────────────────────
  it('updateStatus resuelve el provider vía ticketLoop y llama transition', async () => {
    const { bus, handlers } = capturingBus()
    const provider = makeProvider()
    const providerFor = vi.fn(() => provider)
    registerBusCommands(bus, { ticketLoop: { providerFor } })
    const deps = makeDeps()
    await handlers.get('updateStatus')!(
      { cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to: 'in_review' },
      evPrOpened, deps,
    )
    expect(providerFor).toHaveBeenCalledWith('jira', deps)
    expect(provider.transition).toHaveBeenCalledWith('p1', 'in_review')
  })

  it('updateStatus con provider ausente TIRA (para no destrackear un ticket sin transicionar)', async () => {
    // A diferencia de notify/logOutcome/setPresence (best-effort de verdad), la
    // transición NO es best-effort: si el provider no existe, el comando debe caer
    // en failed[] para que el ticket loop conserve el tracking y reintente (paridad
    // con el path sin-bus de H3). Ver Fix 3 del review de H4-H7.
    const { bus, handlers } = capturingBus()
    registerBusCommands(bus, { ticketLoop: { providerFor: () => null } })
    await expect(
      handlers.get('updateStatus')!(
        { cmd: 'updateStatus', pluginId: 'nope', providerId: 'p1', to: 'done' },
        evPrOpened, makeDeps(),
      ),
    ).rejects.toThrow(/provider ausente/)
  })

  it('updateStatus NO envuelve el error de transition (best-effort lo hace el bus)', async () => {
    const { bus, handlers } = capturingBus()
    const provider = makeProvider()
    ;(provider.transition as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('jira 500'))
    registerBusCommands(bus, { ticketLoop: { providerFor: () => provider } })
    await expect(
      handlers.get('updateStatus')!(
        { cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to: 'done' },
        evPrOpened, makeDeps(),
      ),
    ).rejects.toThrow('jira 500')
  })

  // ── notify (Slack) ────────────────────────────────────────────────────────
  it('notify POSTea chat.postMessage con el bot token y el body correcto', async () => {
    const { bus, handlers } = capturingBus()
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const deps = makeDeps({ getToken: (id: string) => (id === 'slack' ? 'xoxb-tok' : null), fetch: fetch as unknown as typeof globalThis.fetch })
    registerBusCommands(bus, { ticketLoop: { providerFor: () => null } })
    await handlers.get('notify')!(
      { cmd: 'notify', channel: '#dev', message: 'PR abierto' },
      evPrOpened, deps,
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://slack.com/api/chat.postMessage')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer xoxb-tok')
    expect(JSON.parse(init.body as string)).toMatchObject({ channel: '#dev', text: 'PR abierto' })
  })

  it('notify sin token Slack degrada a no-op con warn (no rompe el bus)', async () => {
    const { bus, handlers } = capturingBus()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetch = vi.fn()
    const deps = makeDeps({ fetch: fetch as unknown as typeof globalThis.fetch })
    registerBusCommands(bus, { ticketLoop: { providerFor: () => null } })
    await expect(
      handlers.get('notify')!({ cmd: 'notify', channel: '#dev', message: 'hola' }, evPrOpened, deps),
    ).resolves.toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('notify con channel vacío usa deps.getConfig(slack).channel', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const deps = { getToken: () => 'tok', getConfig: () => ({ channel: '#builds' }), fetch } as unknown as PanelAdapterDeps
    const bus = new EventBus()
    registerBusCommands(bus, { ticketLoop: { providerFor: () => null } })
    bus.setRecipes([{ id: 'r', when: 'ci.failed', then: () => [{ cmd: 'notify', channel: '', message: 'hola' }] }])
    await bus.emit({ type: 'ci.failed', branch: 'b', repoFullName: 'o/r' } as DomainEvent, deps)
    const [, init] = fetch.mock.calls[0] as unknown as [string, { body: string }]
    const body = JSON.parse(init.body)
    expect(body.channel).toBe('#builds')
  })

  it('notify con respuesta Slack no-ok warnea pero no tira', async () => {
    const { bus, handlers } = capturingBus()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), { status: 200 }))
    const deps = makeDeps({ getToken: () => 'xoxb-tok', fetch: fetch as unknown as typeof globalThis.fetch })
    registerBusCommands(bus, { ticketLoop: { providerFor: () => null } })
    await expect(
      handlers.get('notify')!({ cmd: 'notify', channel: '#nope', message: 'x' }, evPrOpened, deps),
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  // ── setPresence (Slack status) ──────────────────────────────────────────────
  it('setPresence POSTea users.profile.set con status_text y el bot token', async () => {
    const { bus, handlers } = capturingBus()
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const deps = makeDeps({ getToken: (id: string) => (id === 'slack' ? 'xoxb-tok' : null), fetch: fetch as unknown as typeof globalThis.fetch })
    registerBusCommands(bus, { ticketLoop: { providerFor: () => null } })
    await handlers.get('setPresence')!({ cmd: 'setPresence', text: 'focus: feat/x' }, evPrOpened, deps)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://slack.com/api/users.profile.set')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer xoxb-tok')
    const body = JSON.parse(init.body as string)
    expect(body.profile.status_text).toBe('focus: feat/x')
    expect(body.profile.status_emoji).toBe(':hammer_and_wrench:')
  })

  it('setPresence sin token Slack degrada a no-op con warn', async () => {
    const { bus, handlers } = capturingBus()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetch = vi.fn()
    const deps = makeDeps({ fetch: fetch as unknown as typeof globalThis.fetch })
    registerBusCommands(bus, { ticketLoop: { providerFor: () => null } })
    await expect(
      handlers.get('setPresence')!({ cmd: 'setPresence', text: 'focus: x' }, evPrOpened, deps),
    ).resolves.toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  // ── openSession ───────────────────────────────────────────────────────────
  it('openSession delega en el callback inyectado con el comando y el evento', async () => {
    const { bus, handlers } = capturingBus()
    const openSession = vi.fn<Parameters<OpenSessionFn>, ReturnType<OpenSessionFn>>(async () => {})
    registerBusCommands(bus, { ticketLoop: { providerFor: () => null }, openSession })
    const cmd = { cmd: 'openSession', branch: 'feat/x', repoFullName: 'o/r', context: 'ctx' } as const
    await handlers.get('openSession')!(cmd, evTaskCreated, makeDeps())
    expect(openSession).toHaveBeenCalledWith(cmd, evTaskCreated)
  })

  it('openSession sin callback degrada a no-op con warn', async () => {
    const { bus, handlers } = capturingBus()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerBusCommands(bus, { ticketLoop: { providerFor: () => null } })
    await expect(
      handlers.get('openSession')!({ cmd: 'openSession', branch: 'feat/x' }, evTaskCreated, makeDeps()),
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  // ── createTask ────────────────────────────────────────────────────────────
  it('createTask llama al provider si soporta crear', async () => {
    const { bus, handlers } = capturingBus()
    const createTask = vi.fn(async () => {})
    const provider = Object.assign(makeProvider(), { createTask })
    registerBusCommands(bus, { ticketLoop: { providerFor: () => provider } })
    await handlers.get('createTask')!(
      { cmd: 'createTask', pluginId: 'jira', title: 'Nueva', body: 'desc' },
      evTaskCreated, makeDeps(),
    )
    expect(createTask).toHaveBeenCalledWith('Nueva', 'desc')
  })

  it('createTask con provider que no soporta crear degrada a no-op con warn', async () => {
    const { bus, handlers } = capturingBus()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerBusCommands(bus, { ticketLoop: { providerFor: () => makeProvider() } })
    await expect(
      handlers.get('createTask')!(
        { cmd: 'createTask', pluginId: 'jira', title: 'Nueva' },
        evTaskCreated, makeDeps(),
      ),
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('createTask con provider desconocido degrada a no-op con warn', async () => {
    const { bus, handlers } = capturingBus()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerBusCommands(bus, { ticketLoop: { providerFor: () => null } })
    await expect(
      handlers.get('createTask')!(
        { cmd: 'createTask', pluginId: 'nope', title: 'X' },
        evTaskCreated, makeDeps(),
      ),
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  // ── logOutcome (Calendar, H6) ───────────────────────────────────────────────
  it('logOutcome apendea al evento existente del taskId (findEventByTask → appendOutcome)', async () => {
    const append = vi.fn(async () => {})
    const gcal = {
      findEventByTask: vi.fn(async () => ({ id: 'ev1' })),
      appendOutcome: append,
      createOutcomeEvent: vi.fn(async () => ({ id: 'new1' })),
    }
    const bus = new EventBus()
    registerBusCommands(bus, { ticketLoop: { providerFor: () => null }, gcal: () => gcal })
    bus.setRecipes([{ id: 'r', when: 'pr.merged', then: () => [{ cmd: 'logOutcome', ref: 'PROJ-1', summary: 'hecho' }] }])
    await bus.emit({ type: 'pr.merged', branch: 'b', repoFullName: 'o/r' } as DomainEvent, makeDeps())
    expect(gcal.findEventByTask).toHaveBeenCalledWith('PROJ-1')
    expect(append).toHaveBeenCalledWith('ev1', 'hecho')
    expect(gcal.createOutcomeEvent).not.toHaveBeenCalled()
  })

  it('logOutcome sin evento existente crea uno de registro (createOutcomeEvent)', async () => {
    const create = vi.fn(async () => ({ id: 'new1' }))
    const gcal = {
      findEventByTask: vi.fn(async () => null),
      appendOutcome: vi.fn(async () => {}),
      createOutcomeEvent: create,
    }
    const bus = new EventBus()
    registerBusCommands(bus, { ticketLoop: { providerFor: () => null }, gcal: () => gcal })
    bus.setRecipes([{ id: 'r', when: 'pr.merged', then: () => [{ cmd: 'logOutcome', ref: 'X', summary: 'hecho' }] }])
    await bus.emit({ type: 'pr.merged', branch: 'b', repoFullName: 'o/r' } as DomainEvent, makeDeps())
    expect(create).toHaveBeenCalled()
    expect(gcal.appendOutcome).not.toHaveBeenCalled()
  })

  it('logOutcome sin gcal inyectado degrada a no-op con warn (como notify sin token)', async () => {
    const { bus, handlers } = capturingBus()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerBusCommands(bus, { ticketLoop: { providerFor: () => null } })
    await expect(
      handlers.get('logOutcome')!({ cmd: 'logOutcome', ref: 'X', summary: 's' }, evPrOpened, makeDeps()),
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})
