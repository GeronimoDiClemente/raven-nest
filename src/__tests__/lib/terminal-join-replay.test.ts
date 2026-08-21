import { describe, it, expect, vi, beforeEach } from 'vitest'

// El servicio crea su cliente de Supabase al importarse: canal falso que nos
// deja disparar los eventos del host a mano.
type Handler = (msg: { payload: Record<string, unknown> }) => void
const handlers = new Map<string, Handler>()
let subscribeCb: ((status: string, err?: unknown) => void) | null = null
const send = vi.fn()

const fakeChannel = {
  on(_type: string, opts: { event: string }, cb: Handler) {
    handlers.set(opts.event, cb)
    return fakeChannel
  },
  subscribe(cb: (status: string, err?: unknown) => void) {
    subscribeCb = cb
    return fakeChannel
  },
  send,
  unsubscribe: vi.fn(),
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ channel: () => fakeChannel }),
}))

const { terminalJoinService } = await import('../../lib/terminalJoinService')

function hostSends(event: string, payload: Record<string, unknown>) {
  const h = handlers.get(event)
  if (!h) throw new Error(`el servicio no escucha '${event}'`)
  h({ payload })
}

describe('terminalJoinService — lo que ve el invitado al entrar', () => {
  beforeEach(() => {
    handlers.clear()
    subscribeCb = null
    send.mockClear()
    terminalJoinService.join('ABC123')
    subscribeCb?.('SUBSCRIBED')
  })

  // Bug: attachViewer enganchaba el stream vivo YA y replayeaba el historial
  // 50 ms despues, asi que los chunks nuevos se escribian ANTES que los viejos
  // y la pantalla del invitado quedaba corrupta en cada join.
  it('escribe el estado conocido ANTES que la data viva, sin timers', () => {
    hostSends('snapshot', { data: 'PANTALLA-DEL-HOST' })
    hostSends('data', { data: 'delta-1' })

    const writes: string[] = []
    terminalJoinService.attachViewer(d => writes.push(d))

    // sincrono: sin correr timers ya tiene que estar todo escrito
    expect(writes.join('')).toContain('PANTALLA-DEL-HOST')
    expect(writes.join('')).toContain('delta-1')
    expect(writes.join('').indexOf('PANTALLA-DEL-HOST'))
      .toBeLessThan(writes.join('').indexOf('delta-1'))

    // y lo que llega despues va al final
    hostSends('data', { data: 'delta-2' })
    expect(writes[writes.length - 1]).toBe('delta-2')
  })

  it('limpia la pantalla antes de pintar la foto del host', () => {
    hostSends('snapshot', { data: 'FOTO' })
    const writes: string[] = []
    terminalJoinService.attachViewer(d => writes.push(d))
    expect(writes[0]).toContain('2J')
    expect(writes[1]).toBe('FOTO')
  })

  // El snapshot es el estado completo: el historial incremental previo ya esta
  // incluido ahi, replayearlo encima duplicaria contenido.
  it('el snapshot descarta el historial acumulado antes de el', () => {
    hostSends('data', { data: 'viejo-pre-snapshot' })
    hostSends('snapshot', { data: 'FOTO' })

    const writes: string[] = []
    terminalJoinService.attachViewer(d => writes.push(d))
    expect(writes.join('')).not.toContain('viejo-pre-snapshot')
  })

  it('expone el tamano del host para que el viewer lo adopte', () => {
    expect(terminalJoinService.hostSize).toBeNull()
    hostSends('size', { cols: 190, rows: 48 })
    expect(terminalJoinService.hostSize).toEqual({ cols: 190, rows: 48 })
  })

  it('el evento size llega al listener registrado (estaba cableado y muerto)', () => {
    const onSize = vi.fn()
    terminalJoinService.attachSizeListener(onSize)
    hostSends('size', { cols: 100, rows: 30 })
    expect(onSize).toHaveBeenCalledWith(100, 30)
  })
})
