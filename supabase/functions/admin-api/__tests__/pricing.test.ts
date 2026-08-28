import { describe, it, expect } from 'vitest'
import {
  montoMensualCents, planLabel, trialEndsAt, aSubResumen, PLANES_VALIDOS, TRIAL_DIAS,
  type SubResumen, type StripeSubscripcionMinima,
} from '../pricing.ts'

function sub(over: Partial<SubResumen> = {}): SubResumen {
  return {
    status: 'active', unit_amount: 3500, quantity: 1,
    interval: 'month', interval_count: 1, price_id: 'price_team_monthly',
    ...over,
  }
}

describe('montoMensualCents', () => {
  it('sin suscripcion es 0', () => {
    expect(montoMensualCents(null)).toBe(0)
  })

  it('mensual de 1 seat es el precio', () => {
    expect(montoMensualCents(sub())).toBe(3500)
  })

  // El bug de raven-admin: Team se cobra por seat y el monto ignoraba quantity.
  it('multiplica por los seats', () => {
    expect(montoMensualCents(sub({ quantity: 5 }))).toBe(17500)
  })

  it('prorratea el anual a mensual, con seats', () => {
    // $312/año x 2 seats = 31200 cents / 12 = 2600 por seat
    expect(montoMensualCents(sub({ unit_amount: 31200, interval: 'year', quantity: 2 }))).toBe(5200)
  })

  it('sin unit_amount es 0', () => {
    expect(montoMensualCents(sub({ unit_amount: null }))).toBe(0)
  })

  // Fix: quantity: 0 debe dar 0, no 1 seat
  it('quantity 0 devuelve 0', () => {
    expect(montoMensualCents(sub({ quantity: 0 }))).toBe(0)
  })

  // Fix: status invalido devuelve 0
  it('status canceled devuelve 0', () => {
    expect(montoMensualCents(sub({ status: 'canceled' }))).toBe(0)
  })

  it('status past_due devuelve 0', () => {
    expect(montoMensualCents(sub({ status: 'past_due' }))).toBe(0)
  })

  it('status active genera monto', () => {
    expect(montoMensualCents(sub({ status: 'active' }))).toBe(3500)
  })

  it('status trialing genera monto', () => {
    expect(montoMensualCents(sub({ status: 'trialing' }))).toBe(3500)
  })
})

describe('planLabel', () => {
  it('dice el ciclo cuando hay suscripcion', () => {
    expect(planLabel('team', sub({ interval: 'year' }))).toBe('Team (anual)')
    expect(planLabel('pro', sub({ interval: 'month' }))).toBe('Pro (mensual)')
  })

  it('sin suscripcion es solo el plan', () => {
    expect(planLabel('free', null)).toBe('Free')
    expect(planLabel('enterprise', null)).toBe('Enterprise')
  })

  it('un plan desconocido se muestra tal cual en vez de romper', () => {
    expect(planLabel('legacy_beta', null)).toBe('legacy_beta')
  })
})

describe('trialEndsAt', () => {
  it('suma 15 dias al inicio del trial', () => {
    expect(trialEndsAt('2026-08-01T00:00:00.000Z')).toBe('2026-08-16T00:00:00.000Z')
  })

  it('sin inicio no hay fin', () => {
    expect(trialEndsAt(null)).toBe(null)
  })

  it('una fecha invalida no explota', () => {
    expect(trialEndsAt('no-es-fecha')).toBe(null)
  })
})

it('los 4 tiers son los validos', () => {
  expect([...PLANES_VALIDOS]).toEqual(['free', 'pro', 'team', 'enterprise'])
  expect(TRIAL_DIAS).toBe(15)
})

// Movida desde index.ts (no testeado: corre en Deno) a pricing.ts (puro,
// testeable sin red) para que la lógica de plata quede bajo cobertura.
describe('aSubResumen', () => {
  it('mapea una suscripcion completa', () => {
    const s: StripeSubscripcionMinima = {
      status: 'active',
      items: {
        data: [{
          quantity: 3,
          price: { id: 'price_x', unit_amount: 3500, recurring: { interval: 'month', interval_count: 1 } },
        }],
      },
    }
    expect(aSubResumen(s)).toEqual({
      status: 'active', unit_amount: 3500, quantity: 3,
      interval: 'month', interval_count: 1, price_id: 'price_x',
    })
  })

  it('items vacio cae a los defaults', () => {
    const s: StripeSubscripcionMinima = { status: 'canceled', items: { data: [] } }
    expect(aSubResumen(s)).toEqual({
      status: 'canceled', unit_amount: null, quantity: 1,
      interval: null, interval_count: 1, price_id: null,
    })
  })

  it('campos ausentes en el item caen a sus defaults', () => {
    const s: StripeSubscripcionMinima = {
      status: 'trialing',
      items: { data: [{ price: {} }] },
    }
    expect(aSubResumen(s)).toEqual({
      status: 'trialing', unit_amount: null, quantity: 1,
      interval: null, interval_count: 1, price_id: null,
    })
  })
})
