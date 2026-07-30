import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventBus, type Recipe, type CommandHandler } from '../integrations/event-bus'
import type { Command, DomainEvent } from '../integrations/bus-types'
import type { PanelAdapterDeps } from '../integration-panels'

// Deps mínimas: el bus las pasa opacas a los handlers, no las toca.
const deps = {
  getToken: () => null,
  getConfig: () => ({}),
  fetch: vi.fn(),
} as unknown as PanelAdapterDeps

const prOpened: DomainEvent = { type: 'pr.opened', branch: 'feat/x', repoFullName: 'o/r' }
const prMerged: DomainEvent = { type: 'pr.merged', branch: 'feat/x', repoFullName: 'o/r' }

function updateStatusRecipe(to: 'in_review' | 'done', when: DomainEvent['type']): Recipe {
  return {
    id: `test-${when}`,
    when,
    then: () => [{ cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to }],
  }
}

describe('EventBus', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('emit sin recetas devuelve [] y no invoca handlers', async () => {
    const bus = new EventBus()
    const handler = vi.fn<Parameters<CommandHandler>, ReturnType<CommandHandler>>()
    bus.registerHandler('updateStatus', handler)
    const out = await bus.emit(prOpened, deps)
    expect(out.commands).toEqual([])
    expect(handler).not.toHaveBeenCalled()
  })

  it('emit con receta que matchea invoca el handler con el comando resuelto', async () => {
    const bus = new EventBus()
    const handler = vi.fn<Parameters<CommandHandler>, ReturnType<CommandHandler>>()
    bus.registerHandler('updateStatus', handler)
    bus.setRecipes([updateStatusRecipe('in_review', 'pr.opened')])
    const out = await bus.emit(prOpened, deps)
    expect(out.commands).toEqual([{ cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to: 'in_review' }])
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(out.commands[0], prOpened, deps)
  })

  it('solo dispara recetas cuyo `when` matchea el type del evento', async () => {
    const bus = new EventBus()
    const handler = vi.fn<Parameters<CommandHandler>, ReturnType<CommandHandler>>()
    bus.registerHandler('updateStatus', handler)
    bus.setRecipes([
      updateStatusRecipe('in_review', 'pr.opened'),
      updateStatusRecipe('done', 'pr.merged'),
    ])
    const out = await bus.emit(prMerged, deps)
    expect(out.commands).toEqual([{ cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to: 'done' }])
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('respeta el predicado `match` opcional de la receta', async () => {
    const bus = new EventBus()
    const handler = vi.fn<Parameters<CommandHandler>, ReturnType<CommandHandler>>()
    bus.registerHandler('updateStatus', handler)
    bus.setRecipes([
      {
        id: 'only-main-repo',
        when: 'pr.opened',
        match: (ev) => (ev as { repoFullName: string }).repoFullName === 'o/other',
        then: () => [{ cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to: 'in_review' }],
      },
    ])
    const out = await bus.emit(prOpened, deps)
    expect(out.commands).toEqual([])
    expect(handler).not.toHaveBeenCalled()
  })

  it('preserva el orden de los comandos entre recetas', async () => {
    const bus = new EventBus()
    const calls: string[] = []
    bus.registerHandler('updateStatus', async (cmd) => { calls.push(`status:${(cmd as { to: string }).to}`) })
    bus.registerHandler('notify', async (cmd) => { calls.push(`notify:${(cmd as { channel: string }).channel}`) })
    bus.setRecipes([
      { id: 'r1', when: 'pr.opened', then: () => [{ cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to: 'in_review' }] },
      { id: 'r2', when: 'pr.opened', then: () => [{ cmd: 'notify', channel: '#dev', message: 'PR abierto' }] },
    ])
    const out = await bus.emit(prOpened, deps)
    expect(out.commands.map((c) => c.cmd)).toEqual(['updateStatus', 'notify'])
    expect(calls).toEqual(['status:in_review', 'notify:#dev'])
  })

  it('un handler que tira NO interrumpe a los demás ni rechaza el emit', async () => {
    const bus = new EventBus()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const second = vi.fn().mockResolvedValue(undefined)
    bus.registerHandler('updateStatus', async () => { throw new Error('boom') })
    bus.registerHandler('notify', second)
    bus.setRecipes([
      { id: 'r1', when: 'pr.opened', then: () => [{ cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to: 'in_review' }] },
      { id: 'r2', when: 'pr.opened', then: () => [{ cmd: 'notify', channel: '#dev', message: 'hi' }] },
    ])
    const out = await bus.emit(prOpened, deps)
    expect(out.commands.map((c) => c.cmd)).toEqual(['updateStatus', 'notify'])
    // El handler que tiró se reporta en `failed` (para que el emisor reintente);
    // el que resolvió no.
    expect(out.failed.map((c) => c.cmd)).toEqual(['updateStatus'])
    expect(second).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
  })

  it('un comando sin handler registrado se devuelve igual y no crashea', async () => {
    const bus = new EventBus()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    bus.setRecipes([updateStatusRecipe('in_review', 'pr.opened')])
    const out = await bus.emit(prOpened, deps)
    expect(out.commands).toEqual([{ cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to: 'in_review' }])
    // Un comando sin handler NO cuenta como `failed` (reintentarlo sería un bucle).
    expect(out.failed).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it('espera (await) a todos los handlers antes de resolver el emit', async () => {
    const bus = new EventBus()
    let resolved = false
    bus.registerHandler('updateStatus', async () => {
      await new Promise((r) => setTimeout(r, 5))
      resolved = true
    })
    bus.setRecipes([updateStatusRecipe('in_review', 'pr.opened')])
    await bus.emit(prOpened, deps)
    expect(resolved).toBe(true)
  })

  it('setRecipes reemplaza el set anterior', async () => {
    const bus = new EventBus()
    const handler = vi.fn<Parameters<CommandHandler>, ReturnType<CommandHandler>>()
    bus.registerHandler('updateStatus', handler)
    bus.setRecipes([updateStatusRecipe('in_review', 'pr.opened')])
    bus.setRecipes([updateStatusRecipe('done', 'pr.merged')])
    const out = await bus.emit(prOpened, deps)
    expect(out.commands).toEqual([])
    expect(handler).not.toHaveBeenCalled()
  })
})
