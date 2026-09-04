import { describe, it, expect, vi } from 'vitest'
import { runPluginAction, type ActionDeps } from '../plugin-actions'

const okFetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true }) } as Response)

describe('runPluginAction — slack.notify', () => {
  it('postea a chat.postMessage con el token y el canal', async () => {
    const fetchSpy = vi.fn<typeof fetch>(okFetch)
    const deps: ActionDeps = { getToken: () => 'xoxb-1', fetch: fetchSpy as unknown as typeof fetch }
    const r = await runPluginAction('slack', 'notify', { channel: '#dev', text: 'listo' }, deps)
    expect(r.ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ channel: '#dev', text: 'listo' })
  })

  it('devuelve NOT_CONNECTED si no hay token', async () => {
    const deps: ActionDeps = { getToken: () => null, fetch: vi.fn() as unknown as typeof fetch }
    expect(await runPluginAction('slack', 'notify', {}, deps)).toEqual({ ok: false, error: 'NOT_CONNECTED' })
  })

  it('propaga el error de la API de Slack', async () => {
    const deps: ActionDeps = {
      getToken: () => 'x',
      fetch: (() => Promise.resolve({ json: () => Promise.resolve({ ok: false, error: 'channel_not_found' }) })) as unknown as typeof fetch,
    }
    expect(await runPluginAction('slack', 'notify', { channel: '#x' }, deps)).toEqual({ ok: false, error: 'channel_not_found' })
  })
})
