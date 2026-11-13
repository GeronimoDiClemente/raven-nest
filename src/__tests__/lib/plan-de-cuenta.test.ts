import { describe, it, expect } from 'vitest'
import { lineaDePlan, fechaLarga } from '../../lib/plan-de-cuenta'

const AHORA = Date.UTC(2026, 9, 29)
const FIN = '2026-11-29T00:00:00Z'
const base = { rawPlan: 'free', isTrialActive: false, billingInterval: null, currentPeriodEnd: null, cancelAtPeriodEnd: false } as const

describe('lineaDePlan', () => {
  it('free', () => {
    expect(lineaDePlan({ ...base }, AHORA)).toEqual({ titulo: 'Free', detalle: '1 project in the cloud. Cloud syncs all of them.', accion: 'upgrade' })
  })
  it('cloud monthly renueva', () => {
    expect(lineaDePlan({ ...base, rawPlan: 'cloud', billingInterval: 'monthly', currentPeriodEnd: FIN }, AHORA))
      .toEqual({ titulo: 'Cloud · Monthly', detalle: 'Renews on Nov 29, 2026', accion: 'manage' })
  })
  it('cloud annual', () => {
    expect(lineaDePlan({ ...base, rawPlan: 'cloud', billingInterval: 'annual', currentPeriodEnd: FIN }, AHORA).titulo).toBe('Cloud · Annual')
  })
  it('cancelando', () => {
    expect(lineaDePlan({ ...base, rawPlan: 'cloud', billingInterval: 'monthly', currentPeriodEnd: FIN, cancelAtPeriodEnd: true }, AHORA).detalle)
      .toBe('Cancels on Nov 29, 2026 — you keep Cloud until then.')
  })
  it('cloud sin fecha', () => {
    expect(lineaDePlan({ ...base, rawPlan: 'cloud' }, AHORA)).toEqual({ titulo: 'Cloud', detalle: null, accion: 'manage' })
    expect(lineaDePlan({ ...base, rawPlan: 'cloud', billingInterval: 'monthly' }, AHORA)).toEqual({ titulo: 'Cloud · Monthly', detalle: null, accion: 'manage' })
  })
  it('fin en el pasado: sin detalle', () => {
    expect(lineaDePlan({ ...base, rawPlan: 'cloud', billingInterval: 'monthly', currentPeriodEnd: '2026-09-01T00:00:00Z' }, AHORA).detalle).toBeNull()
  })
  it('pro, team, enterprise', () => {
    expect(lineaDePlan({ ...base, rawPlan: 'pro' }, AHORA)).toEqual({ titulo: 'Pro', detalle: null, accion: 'manage' })
    expect(lineaDePlan({ ...base, rawPlan: 'team' }, AHORA)).toEqual({ titulo: 'Team', detalle: null, accion: null })
    expect(lineaDePlan({ ...base, rawPlan: 'enterprise' }, AHORA)).toEqual({ titulo: 'Enterprise', detalle: null, accion: null })
  })
  it('trial activo', () => {
    expect(lineaDePlan({ ...base, isTrialActive: true }, AHORA)).toEqual({ titulo: 'Trial', detalle: null, accion: 'upgrade' })
  })
  it('plan desconocido se capitaliza', () => {
    expect(lineaDePlan({ ...base, rawPlan: 'diamante' }, AHORA).titulo).toBe('Diamante')
  })
})

describe('fechaLarga', () => {
  it('formatea en UTC', () => {
    expect(fechaLarga(FIN)).toBe('Nov 29, 2026')
  })
})
