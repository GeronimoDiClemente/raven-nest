// El blocker C no era código faltante: `graph:run:setMode`, `graph:gate:approve` y
// `graph:gate:requestChanges` ya existían en main y andaban. Lo que faltaba era el
// puente del preload, así que el renderer no tenía cómo llamarlos.
//
// Esta clase de bug (handler vivo, bridge mudo) no la agarra ningún test de UI ni
// ningún test de main: cada lado está bien por separado. Se agarra acá, verificando
// que el bridge exponga los métodos y que cada uno pegue en el canal correcto.
import { describe, it, expect, beforeAll, vi } from 'vitest'

const exposed: Record<string, Record<string, (...args: unknown[]) => unknown>> = {}
const invoke = vi.fn(async () => ({ ok: true }))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: Record<string, (...args: unknown[]) => unknown>) => {
      exposed[key] = api
    },
  },
  ipcRenderer: { invoke, send: vi.fn(), on: vi.fn(), removeAllListeners: vi.fn(), removeListener: vi.fn() },
}))

beforeAll(async () => {
  await import('../preload')
})

describe('preload · bridge graphRuns', () => {
  it('expone las tres decisiones humanas además de list/start/attach', () => {
    expect(Object.keys(exposed.graphRuns).sort()).toEqual(
      ['approve', 'attach', 'list', 'requestChanges', 'setMode', 'start'],
    )
  })

  it('setMode pega en graph:run:setMode con el runId y el modo', async () => {
    invoke.mockClear()
    await exposed.graphRuns.setMode('r1', 'gate')
    expect(invoke).toHaveBeenCalledWith('graph:run:setMode', 'r1', 'gate')
  })

  it('approve pega en graph:gate:approve con el runId y el gate', async () => {
    invoke.mockClear()
    await exposed.graphRuns.approve('r1', 'gate')
    expect(invoke).toHaveBeenCalledWith('graph:gate:approve', 'r1', 'gate')
  })

  it('requestChanges pega en graph:gate:requestChanges con el feedback', async () => {
    invoke.mockClear()
    await exposed.graphRuns.requestChanges('r1', 'sacá el log del token')
    expect(invoke).toHaveBeenCalledWith('graph:gate:requestChanges', 'r1', 'sacá el log del token')
  })
})
