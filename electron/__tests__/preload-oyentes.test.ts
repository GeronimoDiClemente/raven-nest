// Los `onX` del preload que hacían `removeAllListeners` antes de `on` dejaban sordo al
// suscriptor anterior, y sin baja propia el desmontaje de uno borraba a todos. Acá el
// `ipcRenderer` es un EventEmitter de verdad, así que el test mide la semántica real de
// on / removeListener / removeAllListeners y no la de un mock.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const exposed: Record<string, Record<string, (...args: unknown[]) => unknown>> = {}
const ipc = vi.hoisted(() => ({ emitter: null as unknown as EventEmitter }))

vi.mock('electron', async () => {
  const { EventEmitter: EE } = await import('node:events')
  const emitter = new EE()
  ipc.emitter = emitter
  return {
    contextBridge: {
      exposeInMainWorld: (key: string, api: Record<string, (...args: unknown[]) => unknown>) => {
        exposed[key] = api
      },
    },
    ipcRenderer: Object.assign(emitter, { invoke: vi.fn(async () => ({ ok: true })), send: vi.fn() }),
    webUtils: { getPathForFile: vi.fn() },
  }
})

beforeAll(async () => {
  await import('../preload')
})

describe('preload · browser.onNavigated', () => {
  it('dos suscriptores reciben el evento y la baja de uno no afecta al otro', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = exposed.browser.onNavigated(a) as () => void
    const offB = exposed.browser.onNavigated(b) as () => void

    ipc.emitter.emit('browser:navigated', {}, 'p1', 'https://a.test')
    expect(a).toHaveBeenCalledWith('p1', 'https://a.test')
    expect(b).toHaveBeenCalledWith('p1', 'https://a.test')

    offA()
    ipc.emitter.emit('browser:navigated', {}, 'p2', 'https://b.test')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenLastCalledWith('p2', 'https://b.test')

    offB()
    expect(ipc.emitter.listenerCount('browser:navigated')).toBe(0)
  })
})
