// Motor 4 (H6) — OAuth desktop de Google (loopback + PKCE, sin client secret).
// El secret no puede vivir en el binario (repo público), así que usamos PKCE: el
// challenge S256 reemplaza al secret. Este módulo aísla la lógica testeable
// (authUrl/exchangeCode/refreshAccessToken, con fetch inyectado) del efecto de
// servidor real + browser (startLoopbackFlow), que NO se testea en vivo.
//
// Determinismo: `expiresAt = now + expires_in*1000`; `now` es un parámetro con
// default `Date.now()` para que los tests puedan fijarlo.
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { pkceChallenge } from './gcal'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
// Leer + escribir la description de eventos. Es un "sensitive scope": Google
// exige verificación del app antes de release pública (decisión de release, no
// bloquea el código — ver spec §2).
const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const LOOPBACK_TIMEOUT_MS = 120_000

/** Credenciales persistidas en pluginCreds('gcal') como JSON. */
export interface GcalCreds {
  accessToken: string
  refreshToken?: string
  expiresAt: number
}

export interface AuthUrlParams {
  clientId: string
  redirectUri: string
  challenge: string
}

/** URL de consent con PKCE S256, scope de calendar.events y redirect loopback. */
export function authUrl({ clientId, redirectUri, challenge }: AuthUrlParams): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // access_type=offline + prompt=consent para que Google devuelva refresh_token.
    access_type: 'offline',
    prompt: 'consent',
  })
  return `${AUTH_ENDPOINT}?${q.toString()}`
}

export interface ExchangeParams {
  clientId: string
  code: string
  verifier: string
  redirectUri: string
  fetch: typeof globalThis.fetch
  now?: number
}

/** Intercambia el `code` por tokens (grant_type=authorization_code + code_verifier). */
export async function exchangeCode(
  { clientId, code, verifier, redirectUri, fetch, now = Date.now() }: ExchangeParams,
): Promise<GcalCreds> {
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  })
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string }
  if (!res.ok || !json.access_token) throw new Error(json.error ?? `token exchange failed (${res.status})`)
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: now + (json.expires_in ?? 0) * 1000,
  }
}

export interface RefreshParams {
  clientId: string
  refreshToken: string
  fetch: typeof globalThis.fetch
  now?: number
}

/** Refresca el access token (grant_type=refresh_token). El refresh token no cambia. */
export async function refreshAccessToken(
  { clientId, refreshToken, fetch, now = Date.now() }: RefreshParams,
): Promise<{ accessToken: string; expiresAt: number }> {
  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string }
  if (!res.ok || !json.access_token) throw new Error(json.error ?? `token refresh failed (${res.status})`)
  return { accessToken: json.access_token, expiresAt: now + (json.expires_in ?? 0) * 1000 }
}

export interface LoopbackParams {
  clientId: string
  openExternal: (url: string) => void | Promise<void>
  fetch: typeof globalThis.fetch
  timeoutMs?: number
}

/**
 * Flujo completo main-side: levanta un http server efímero en 127.0.0.1:<puerto
 * libre>, arma verifier/challenge, abre el browser del sistema a la URL de
 * consent y resuelve cuando llega `?code=`. Cierra SIEMPRE el server (al recibir
 * el code, en error, y por timeout) para no dejar puertos abiertos. NO se testea
 * en vivo (sin credenciales Google); su firma queda lista para main.
 */
export function startLoopbackFlow(
  { clientId, openExternal, fetch, timeoutMs = LOOPBACK_TIMEOUT_MS }: LoopbackParams,
): Promise<GcalCreds> {
  const { verifier, challenge } = pkceChallenge()
  return new Promise<GcalCreds>((resolve, reject) => {
    let redirectUri = ''
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      fn()
    }
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', redirectUri || 'http://127.0.0.1')
      const err = url.searchParams.get('error')
      if (err) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<p>Authorization failed. You can close this window.</p>')
        finish(() => reject(new Error(err)))
        return
      }
      const code = url.searchParams.get('code')
      if (!code) { res.writeHead(204); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<p>Connected. You can close this window and return to Nest.</p>')
      exchangeCode({ clientId, code, verifier, redirectUri, fetch })
        .then((creds) => finish(() => resolve(creds)))
        .catch((e: unknown) => finish(() => reject(e instanceof Error ? e : new Error(String(e)))))
    })
    const timer = setTimeout(() => finish(() => reject(new Error('OAuth loopback timed out'))), timeoutMs)
    server.on('error', (e) => finish(() => reject(e)))
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null
      redirectUri = `http://127.0.0.1:${addr?.port ?? 0}/cb`
      void Promise.resolve(openExternal(authUrl({ clientId, redirectUri, challenge }))).catch(() => {})
    })
  })
}
