// Spec 2b-2 §4.4: después de escribir `profiles`, el webhook le avisa al servidor de sync.
import { describe, it, expect, vi } from 'vitest'
import { avisarPlan, clasificarAviso, configDeAviso, firmarAviso } from '../aviso-de-plan.ts'

const CUERPO = '{"user_id":"00000000-0000-4000-8000-000000000001","plan":"cloud"}'
// D13: el MISMO vector que verifica el servidor (server/__tests__/plan-sync.test.ts).
const V1_DEL_VECTOR = '8b149a93534d60ed7fb23268c484647e3a5a939afa9a2fe94402be2161e7fee8'
const CONFIG = { url: 'https://sync.test/', secreto: 'test-secret' }

describe('firmarAviso', () => {
  it('produce la firma del vector fijo', async () => {
    expect(await firmarAviso('test-secret', CUERPO, 1_700_000_000)).toBe(`t=1700000000,v1=${V1_DEL_VECTOR}`)
  })
})

describe('configDeAviso', () => {
  it('sin url o sin secreto (o en blanco) no hay config', () => {
    expect(configDeAviso({})).toBeNull()
    expect(configDeAviso({ PLAN_SYNC_URL: 'https://sync.test' })).toBeNull()
    expect(configDeAviso({ PLAN_SYNC_SECRET: 's' })).toBeNull()
    expect(configDeAviso({ PLAN_SYNC_URL: ' ', PLAN_SYNC_SECRET: 's' })).toBeNull()
    expect(configDeAviso({ PLAN_SYNC_URL: 'https://sync.test', PLAN_SYNC_SECRET: '  ' })).toBeNull()
  })

  it('con las dos, la config', () => {
    expect(configDeAviso({ PLAN_SYNC_URL: 'https://sync.test', PLAN_SYNC_SECRET: 's' })).toEqual({ url: 'https://sync.test', secreto: 's' })
  })
})

describe('avisarPlan', () => {
  it('postea a <base>/internal/plan el cuerpo firmado con user_id y plan', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    const r = await avisarPlan(fetchImpl as unknown as typeof fetch, CONFIG, '00000000-0000-4000-8000-000000000001', 'cloud', 1_700_000_000)
    expect(r).toEqual({ ok: true })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://sync.test/internal/plan')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(CUERPO)
    expect(init.headers['X-Nest-Signature']).toBe(`t=1700000000,v1=${V1_DEL_VECTOR}`)
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('una base sin barra final arma la misma url', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    await avisarPlan(fetchImpl as unknown as typeof fetch, { url: 'https://sync.test', secreto: 's' }, 'u', 'cloud', 1)
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://sync.test/internal/plan')
  })

  it('un no-2xx es una falla con el status', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }))
    expect(await avisarPlan(fetchImpl as unknown as typeof fetch, CONFIG, 'u', 'cloud', 1)).toEqual({ ok: false, motivo: 'HTTP 401', status: 401 })
  })

  it('un error de red es una falla, sin lanzar', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    expect(await avisarPlan(fetchImpl as unknown as typeof fetch, CONFIG, 'u', 'cloud', 1)).toEqual({ ok: false, motivo: 'ECONNREFUSED' })
  })
})

// Ruling P9: qué le contesta el webhook a Stripe según cómo salió el aviso.
describe('clasificarAviso', () => {
  it('un aviso que llegó es ok', () => {
    expect(clasificarAviso({ ok: true })).toBe('ok')
  })

  it('un 400 (dato inválido, no se arregla reintentando) se descarta', () => {
    expect(clasificarAviso({ ok: false, motivo: 'HTTP 400', status: 400 })).toBe('descartar')
  })

  it.each([401, 404, 500, 502, 503, 504])('un %i se reintenta', (status) => {
    expect(clasificarAviso({ ok: false, motivo: `HTTP ${status}`, status })).toBe('reintentar')
  })

  it('un error de red o timeout (sin status) se reintenta', () => {
    expect(clasificarAviso({ ok: false, motivo: 'ECONNREFUSED' })).toBe('reintentar')
    expect(clasificarAviso({ ok: false, motivo: 'The operation was aborted due to timeout' })).toBe('reintentar')
  })

  it('sin config (falta PLAN_SYNC_URL/PLAN_SYNC_SECRET) se reintenta', () => {
    expect(clasificarAviso(null)).toBe('reintentar')
  })
})
