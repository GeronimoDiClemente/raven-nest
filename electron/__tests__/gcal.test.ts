import { describe, it, expect, vi } from 'vitest'
import { pkceChallenge, formatOutcome, createGcalAdapter } from '../integrations/gcal'
import { NotConnectedError, type PanelAdapterDeps } from '../integration-panels'

function depsWith(f: (url: string, init?: unknown) => Promise<Response>): PanelAdapterDeps {
  return { getToken: () => 'at', getConfig: () => ({}), fetch: vi.fn(f) } as unknown as PanelAdapterDeps
}

describe('gcal helpers', () => {
  it('pkceChallenge(S256) es determinístico dado un verifier fijo', () => {
    // Vector del RFC 7636: verifier fijo → challenge conocido (S256 base64url del SHA-256).
    const { challenge } = pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
  it('pkceChallenge genera verifier propio si no se pasa uno', () => {
    const a = pkceChallenge()
    expect(a.verifier.length).toBeGreaterThanOrEqual(43)
    expect(a.challenge).not.toBe(a.verifier)
  })
  it('formatOutcome arma el resumen de la sesión', () => {
    const s = formatOutcome({ repo: 'acme/app', branch: 'feat/x', prNumber: 456, commits: 3, testsGreen: true })
    expect(s).toContain('acme/app')
    expect(s).toContain('PR #456')
    expect(s).toContain('3 commits')
  })
})

describe('createGcalAdapter', () => {
  it('findEventByTask busca por privateExtendedProperty', async () => {
    const deps = depsWith(async (url) => {
      expect(url).toContain('privateExtendedProperty=taskId%3DPROJ-1')
      return new Response(JSON.stringify({ items: [{ id: 'ev1', description: 'x' }] }), { status: 200 })
    })
    const g = createGcalAdapter(deps)
    expect(await g.findEventByTask('PROJ-1')).toMatchObject({ id: 'ev1' })
  })

  it('findEventByTask devuelve null si no hay items', async () => {
    const deps = depsWith(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }))
    const g = createGcalAdapter(deps)
    expect(await g.findEventByTask('PROJ-2')).toBeNull()
  })

  it('appendOutcome hace PATCH agregando la línea a la description', async () => {
    const calls: unknown[] = []
    const deps = depsWith(async (url, init) => {
      if ((init as { method?: string })?.method === 'PATCH') { calls.push(JSON.parse((init as { body: string }).body)); return new Response('{}', { status: 200 }) }
      return new Response(JSON.stringify({ id: 'ev1', description: 'previa' }), { status: 200 })
    })
    const g = createGcalAdapter(deps)
    await g.appendOutcome('ev1', 'línea nueva')
    expect((calls[0] as { description: string }).description).toContain('previa')
    expect((calls[0] as { description: string }).description).toContain('línea nueva')
  })

  it('appendOutcome sin description previa arranca con la línea sola', async () => {
    const calls: unknown[] = []
    const deps = depsWith(async (url, init) => {
      if ((init as { method?: string })?.method === 'PATCH') { calls.push(JSON.parse((init as { body: string }).body)); return new Response('{}', { status: 200 }) }
      return new Response(JSON.stringify({ id: 'ev2' }), { status: 200 })
    })
    const g = createGcalAdapter(deps)
    await g.appendOutcome('ev2', 'primera')
    expect((calls[0] as { description: string }).description).toBe('primera')
  })

  it('listEvents pide el rango con singleEvents y orderBy startTime', async () => {
    const deps = depsWith(async (url) => {
      expect(url).toContain('timeMin=2026-07-30T00%3A00%3A00Z')
      expect(url).toContain('timeMax=2026-07-31T00%3A00%3A00Z')
      expect(url).toContain('singleEvents=true')
      expect(url).toContain('orderBy=startTime')
      return new Response(JSON.stringify({ items: [{ id: 'a' }, { id: 'b' }] }), { status: 200 })
    })
    const g = createGcalAdapter(deps)
    expect(await g.listEvents('2026-07-30T00:00:00Z', '2026-07-31T00:00:00Z')).toHaveLength(2)
  })

  it('createOutcomeEvent hace POST con start/end en whenIso y summary', async () => {
    let body: { summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string } } = {}
    const deps = depsWith(async (url, init) => {
      expect((init as { method?: string })?.method).toBe('POST')
      body = JSON.parse((init as { body: string }).body)
      return new Response(JSON.stringify({ id: 'new1' }), { status: 200 })
    })
    const g = createGcalAdapter(deps)
    const ev = await g.createOutcomeEvent('hecho', '2026-07-30T12:00:00Z')
    expect(ev).toMatchObject({ id: 'new1' })
    expect(body.summary).toBe('hecho')
    expect(body.start?.dateTime).toBe('2026-07-30T12:00:00Z')
    expect(body.end?.dateTime).toBe('2026-07-30T12:00:00Z')
  })

  it('sin token guardado, tira NotConnectedError', async () => {
    const deps = { getToken: () => null, getConfig: () => ({}), fetch: vi.fn() } as unknown as PanelAdapterDeps
    const g = createGcalAdapter(deps)
    await expect(g.listEvents('a', 'b')).rejects.toBeInstanceOf(NotConnectedError)
  })

  it('401 de la API mapea a NotConnectedError', async () => {
    const deps = depsWith(async () => new Response('{}', { status: 401 }))
    const g = createGcalAdapter(deps)
    await expect(g.listEvents('a', 'b')).rejects.toBeInstanceOf(NotConnectedError)
  })
})
