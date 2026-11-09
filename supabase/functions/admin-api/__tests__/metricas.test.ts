import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  pedirMetricasDelSync, resumirConversion, resumirUso, MESES_DE_TRIAL, type PerfilDeTrial,
} from '../metricas.ts'

const DIA = 24 * 60 * 60 * 1000
const AHORA = new Date('2026-11-09T12:00:00Z')
const hace = (dias: number) => new Date(AHORA.getTime() - dias * DIA).toISOString()
const perfil = (plan: string | null, trial: string | null): PerfilDeTrial => ({ plan, trial_started_at: trial })

describe('resumirConversion', () => {
  it('convierte sobre los trials TERMINADOS, no sobre todos', () => {
    const c = resumirConversion([
      perfil('cloud', hace(40)), // terminó y paga
      perfil('free', hace(20)), // terminó y no paga
      perfil('free', hace(3)), // en trial
      perfil('cloud', hace(2)), // pagó durante el trial: convirtió, no está "en trial"
    ], AHORA)
    expect(c).toMatchObject({ en_trial: 1, terminaron: 2, pagan: 1, tasa: 0.5 })
  })

  it('los 15 días se cumplen justo en el día 15', () => {
    expect(resumirConversion([perfil('free', hace(15))], AHORA).terminaron).toBe(1)
    expect(resumirConversion([perfil('free', hace(14.9))], AHORA).en_trial).toBe(1)
  })

  it('sin trials terminados la tasa es null, no 0', () => {
    expect(resumirConversion([perfil('free', hace(1))], AHORA).tasa).toBeNull()
    expect(resumirConversion([], AHORA).tasa).toBeNull()
  })

  it('un perfil sin trial o con fecha rota no entra en ningún denominador', () => {
    const c = resumirConversion([perfil('team', null), perfil('free', 'no-es-fecha')], AHORA)
    expect(c).toMatchObject({ en_trial: 0, terminaron: 0, pagan: 0 })
  })

  it('cualquier plan pago cuenta; un plan nulo es free', () => {
    const c = resumirConversion(
      ['cloud', 'pro', 'team', 'enterprise', null].map((p) => perfil(p, hace(30))), AHORA,
    )
    expect(c).toMatchObject({ terminaron: 5, pagan: 4 })
  })

  it('agrupa por mes de inicio (UTC), el más nuevo primero', () => {
    const c = resumirConversion([
      perfil('cloud', '2026-11-01T00:00:00Z'),
      perfil('free', '2026-10-31T23:59:59Z'),
      perfil('cloud', '2026-10-10T00:00:00Z'),
      perfil('free', '2025-01-01T00:00:00Z'), // fuera de los 6 meses
    ], AHORA)
    expect(c.cohortes).toHaveLength(MESES_DE_TRIAL)
    expect(c.cohortes[0]).toEqual({ mes: '2026-11', empezaron: 1, terminaron: 0, pagan: 0 })
    // El del 31-oct todavía no cumplió los 15 días: empezó en octubre pero no terminó.
    expect(c.cohortes[1]).toEqual({ mes: '2026-10', empezaron: 2, terminaron: 1, pagan: 1 })
    expect(c.cohortes[5].mes).toBe('2026-06')
  })

  it('el corte de año no rompe los meses', () => {
    const c = resumirConversion([], new Date('2027-01-15T00:00:00Z'))
    expect(c.cohortes.map((x) => x.mes)).toEqual(['2027-01', '2026-12', '2026-11', '2026-10', '2026-09', '2026-08'])
  })
})

describe('resumirUso', () => {
  it('cuenta las activas por ventana e ignora nulos y fechas rotas', () => {
    expect(resumirUso(10, [hace(1), hace(10), hace(40), null, 'x'], AHORA))
      .toEqual({ cuentas: 10, activas_7d: 1, activas_30d: 2 })
  })
})

describe('pedirMetricasDelSync', () => {
  const config = { url: 'https://sync.example/', secreto: 'secreto-de-prueba' }
  const T = 1_800_000_000

  it('firma el cuerpo exacto que manda, y devuelve las métricas', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const cuerpo = init.body as string
      const v1 = createHmac('sha256', config.secreto).update(`${T}.${cuerpo}`).digest('hex')
      expect((init.headers as Record<string, string>)['X-Nest-Signature']).toBe(`t=${T},v1=${v1}`)
      expect(JSON.parse(cuerpo)).toEqual({ consulta: 'metricas' })
      return new Response(JSON.stringify({ ok: true, metricas: { cuentas: 3 } }))
    })
    const r = await pedirMetricasDelSync(fetchImpl as unknown as typeof fetch, config, T)
    expect(r).toEqual({ ok: true, metricas: { cuentas: 3 } })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://sync.example/internal/metrics')
  })

  it('sin config no sale a la red', async () => {
    const fetchImpl = vi.fn()
    expect(await pedirMetricasDelSync(fetchImpl as unknown as typeof fetch, null, T))
      .toEqual({ ok: false, motivo: 'sin_config' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('un no-2xx, un cuerpo sin métricas o la red caída son un fallo con motivo', async () => {
    const con = (impl: () => Promise<Response>) =>
      pedirMetricasDelSync(impl as unknown as typeof fetch, config, T)
    expect(await con(async () => new Response('{}', { status: 401 }))).toEqual({ ok: false, motivo: 'HTTP 401' })
    expect(await con(async () => new Response('{"ok":true}'))).toEqual({ ok: false, motivo: 'respuesta_invalida' })
    expect(await con(async () => new Response('no json'))).toEqual({ ok: false, motivo: 'respuesta_invalida' })
    expect(await con(async () => { throw new Error('ECONNREFUSED') })).toEqual({ ok: false, motivo: 'ECONNREFUSED' })
  })
})
