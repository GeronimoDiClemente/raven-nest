import { describe, it, expect, vi } from 'vitest'
import { authUrl, exchangeCode, refreshAccessToken } from '../integrations/gcal-oauth'

describe('gcal-oauth', () => {
  it('authUrl incluye challenge S256, scope y redirect loopback', () => {
    const url = authUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:9999/cb', challenge: 'CH' })
    expect(url).toContain('code_challenge=CH')
    expect(url).toContain('code_challenge_method=S256')
    expect(url).toContain('scope=')
    expect(url).toContain('client_id=cid')
  })

  it('refreshAccessToken cambia el access token con el refresh token', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'nuevo', expires_in: 3600 }), { status: 200 }))
    const out = await refreshAccessToken({ clientId: 'cid', refreshToken: 'rt', fetch: fetch as unknown as typeof globalThis.fetch })
    expect(out).toMatchObject({ accessToken: 'nuevo' })
    expect(out.expiresAt).toBeGreaterThan(0)
  })

  it('refreshAccessToken calcula expiresAt = now + expires_in*1000 (now inyectable, determinista)', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'nuevo', expires_in: 3600 }), { status: 200 }))
    const out = await refreshAccessToken({ clientId: 'cid', refreshToken: 'rt', fetch: fetch as unknown as typeof globalThis.fetch, now: 1_000_000 })
    expect(out.expiresAt).toBe(1_000_000 + 3600 * 1000)
  })

  it('exchangeCode postea authorization_code con code_verifier y arma las creds', async () => {
    let body = ''
    const fetch = vi.fn(async (_url: string, init: { body?: string }) => {
      body = init?.body ?? ''
      return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 100 }), { status: 200 })
    })
    const out = await exchangeCode({
      clientId: 'cid', code: 'abc', verifier: 'ver', redirectUri: 'http://127.0.0.1:1/cb',
      fetch: fetch as unknown as typeof globalThis.fetch, now: 500,
    })
    expect(out).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: 500 + 100 * 1000 })
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('code_verifier=ver')
    expect(body).toContain('code=abc')
  })

  it('exchangeCode tira si la respuesta no trae access_token', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))
    await expect(exchangeCode({
      clientId: 'cid', code: 'abc', verifier: 'ver', redirectUri: 'r',
      fetch: fetch as unknown as typeof globalThis.fetch,
    })).rejects.toThrow('invalid_grant')
  })
})
