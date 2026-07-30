import { describe, it, expect, vi } from 'vitest'
import { SlackSocket } from '../integrations/slack-socket'

function fakeWs() {
  const handlers: Record<string, ((ev: unknown) => void)[]> = {}
  return {
    sent: [] as string[],
    addEventListener: (t: string, cb: (ev: unknown) => void) => { (handlers[t] ??= []).push(cb) },
    send(d: string) { this.sent.push(d) },
    close() { (handlers['close'] ?? []).forEach((cb) => cb({})) },
    emit(msg: unknown) { (handlers['message'] ?? []).forEach((cb) => cb({ data: JSON.stringify(msg) })) },
    open() { (handlers['open'] ?? []).forEach((cb) => cb({})) },
  }
}

const okOpen = () =>
  new Response(JSON.stringify({ ok: true, url: 'wss://x' }), { status: 200 })

describe('SlackSocket', () => {
  it('connect abre la url de apps.connections.open y ACKea + dispatcha una mención', async () => {
    const ws = fakeWs()
    const fetch = vi.fn(async () => okOpen())
    const onAppMention = vi.fn()
    const sock = new SlackSocket({
      appToken: 'xapp-1', fetch: fetch as unknown as typeof globalThis.fetch,
      wsFactory: () => ws, onAppMention, onBlockAction: vi.fn(),
    })
    await sock.connect()
    ws.emit({ type: 'events_api', envelope_id: 'e1', payload: { event: {
      type: 'app_mention', channel: 'C1', ts: '1.1', user: 'U9', text: '<@B> hola' } } })
    expect(JSON.parse(ws.sent[0])).toEqual({ envelope_id: 'e1' })          // ACK
    expect(onAppMention).toHaveBeenCalledWith(expect.objectContaining({ channel: 'C1', text: 'hola' }))
    sock.disconnect()
  })

  it('dispatcha un block_action con ACK', async () => {
    const ws = fakeWs()
    const fetch = vi.fn(async () => okOpen())
    const onBlockAction = vi.fn()
    const sock = new SlackSocket({
      appToken: 'xapp-1', fetch: fetch as unknown as typeof globalThis.fetch,
      wsFactory: () => ws, onAppMention: vi.fn(), onBlockAction,
    })
    await sock.connect()
    ws.emit({ type: 'interactive', envelope_id: 'e3', payload: {
      type: 'block_actions', user: { id: 'U9' }, channel: { id: 'C1' },
      message: { thread_ts: '110.0' }, actions: [{ action_id: 'fix_ci', value: '/wt/x' }] } })
    expect(JSON.parse(ws.sent[0])).toEqual({ envelope_id: 'e3' })
    expect(onBlockAction).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'fix_ci', value: '/wt/x' }))
    sock.disconnect()
  })

  it('reconecta cuando el socket se cierra', async () => {
    const wss = [fakeWs(), fakeWs()]
    let i = 0
    const fetch = vi.fn(async () => okOpen())
    const sock = new SlackSocket({ appToken: 'xapp-1', fetch: fetch as unknown as typeof globalThis.fetch,
      wsFactory: () => wss[i++], onAppMention: vi.fn(), onBlockAction: vi.fn() })
    await sock.connect()
    wss[0].close()                       // dispara reconexión
    await Promise.resolve(); await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(2)  // re-open
    sock.disconnect()
  })

  it('disconnect frena la reconexión (no re-open tras close manual)', async () => {
    const wss = [fakeWs(), fakeWs()]
    let i = 0
    const fetch = vi.fn(async () => okOpen())
    const sock = new SlackSocket({ appToken: 'xapp-1', fetch: fetch as unknown as typeof globalThis.fetch,
      wsFactory: () => wss[i++], onAppMention: vi.fn(), onBlockAction: vi.fn() })
    await sock.connect()
    sock.disconnect()                    // close manual → stopped
    await Promise.resolve(); await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)  // no re-open
  })
})
