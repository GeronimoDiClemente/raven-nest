import { describe, it, expect } from 'vitest'
import { aAccountSummary, aAccountDetail } from '../mapear.ts'
import { ACCOUNT_ALLOWED_KEYS, clavesNoPermitidas } from '../allowlist.ts'
import type { SubResumen } from '../pricing.ts'

const USUARIO = { id: 'u1', email: 'gero@nestmux.com', created_at: '2026-01-10T12:00:00.000Z' }
const PERFIL = { plan: 'team', stripe_customer_id: 'cus_1', trial_started_at: null }
const SUB: SubResumen = {
  status: 'active', unit_amount: 3500, quantity: 3,
  interval: 'month', interval_count: 1, price_id: 'price_team_monthly',
}
const FICHA = { repos: 4, teams: 2, seats: 3, stripeCaido: false }

describe('aAccountSummary', () => {
  it('usa el email como nombre de la cuenta', () => {
    expect(aAccountSummary(USUARIO, PERFIL, SUB).name).toBe('gero@nestmux.com')
  })

  it('sin email cae a un placeholder con el id, no a vacio', () => {
    const r = aAccountSummary({ ...USUARIO, email: null }, PERFIL, SUB)
    expect(r.name).toBe('(sin email · u1)')
  })

  it('sin perfil el plan es free', () => {
    const r = aAccountSummary(USUARIO, null, null)
    expect(r.plan).toBe('free')
    expect(r.plan_label).toBe('Free')
  })

  it('el label trae el ciclo', () => {
    expect(aAccountSummary(USUARIO, PERFIL, SUB).plan_label).toBe('Team (mensual)')
  })

  it('el status sale de la suscripcion', () => {
    expect(aAccountSummary(USUARIO, PERFIL, SUB).status).toBe('active')
  })

  it('sin suscripcion el status es sin_suscripcion', () => {
    expect(aAccountSummary(USUARIO, PERFIL, null).status).toBe('sin_suscripcion')
  })

  it('calcula el fin del trial', () => {
    const p = { ...PERFIL, trial_started_at: '2026-02-01T00:00:00.000Z' }
    expect(aAccountSummary(USUARIO, p, null).trial_ends_at).toBe('2026-02-16T00:00:00.000Z')
  })

  it('voz_suspendida siempre false: es un campo de AiraMed', () => {
    expect(aAccountSummary(USUARIO, PERFIL, SUB).voz_suspendida).toBe(false)
  })

  // El dato de `user_last_activity` con el que se calculan DAU/WAU/MAU y con
  // el que la Task 10 compara paridad contra raven-admin antes de apagarlo.
  it('expone el ultimo uso de la cuenta', () => {
    const r = aAccountSummary(USUARIO, PERFIL, SUB, '2026-08-27T09:30:00.000Z')
    expect(r.last_activity_at).toBe('2026-08-27T09:30:00.000Z')
  })

  it('sin actividad conocida el campo existe en null, no ausente', () => {
    const r = aAccountSummary(USUARIO, PERFIL, SUB)
    expect(r.last_activity_at).toBe(null)
    expect('last_activity_at' in r).toBe(true)
  })
})

describe('aAccountDetail', () => {
  it('arma los tres meters', () => {
    const r = aAccountDetail(USUARIO, PERFIL, SUB, FICHA)
    expect(r.meters.map((m) => m.key)).toEqual(['seats', 'repos', 'teams'])
    expect(r.meters.find((m) => m.key === 'repos')?.used).toBe(4)
  })

  it('los meters no tienen cupo, asi que quota es null y pct 0', () => {
    const m = aAccountDetail(USUARIO, PERFIL, SUB, FICHA).meters[0]
    expect(m.quota).toBe(null)
    expect(m.pct).toBe(0)
  })

  // Con Stripe caído `seats` es null: un meter "Seats 0" al lado de ese null
  // se contradice solo. `Meter.used` no puede ser nullable (el zod del core lo
  // exige `number`), así que la salida honesta es omitir el meter.
  it('con Stripe caido omite el meter seats, no lo manda en cero', () => {
    const r = aAccountDetail(USUARIO, PERFIL, null, { ...FICHA, stripeCaido: true })
    expect(r.meters.map((m) => m.key)).toEqual(['repos', 'teams'])
    expect(r.seats).toBe(null)
  })

  it('repos y teams no dependen de Stripe y se quedan', () => {
    const r = aAccountDetail(USUARIO, PERFIL, null, { ...FICHA, stripeCaido: true })
    expect(r.meters.find((m) => m.key === 'repos')?.used).toBe(4)
    expect(r.meters.find((m) => m.key === 'teams')?.used).toBe(2)
  })

  it('flags vacio: Nest no tiene flags de staff', () => {
    expect(aAccountDetail(USUARIO, PERFIL, SUB, FICHA).flags).toEqual({})
  })

  // El caso real al 2026-08-28: 17 usuarios con plan de pago y ningún customer.
  it('marca el plan de pago sin suscripcion', () => {
    const p = { plan: 'team', stripe_customer_id: null, trial_started_at: null }
    const salud = aAccountDetail(USUARIO, p, null, FICHA).health
    const item = salud.find((h) => h.key === 'suscripcion')
    expect(item?.status).toBe('sin_configurar')
    expect(item?.detail).toBe('Plan team asignado sin suscripcion de Stripe')
  })

  it('un plan free sin suscripcion esta ok, no roto', () => {
    const p = { plan: 'free', stripe_customer_id: null, trial_started_at: null }
    const item = aAccountDetail(USUARIO, p, null, FICHA).health
      .find((h) => h.key === 'suscripcion')
    expect(item?.status).toBe('ok')
  })

  // Stripe caído no puede parecer "no paga": son cosas distintas.
  it('con Stripe caido informa parcial, no sin_configurar', () => {
    const item = aAccountDetail(USUARIO, PERFIL, null, { ...FICHA, stripeCaido: true }).health
      .find((h) => h.key === 'suscripcion')
    expect(item?.status).toBe('parcial')
    expect(item?.detail).toBe('Stripe no responde: el dato de cobro no esta disponible')
  })

  // Prueba combinada: Stripe caído toma precedencia sobre "plan sin customer".
  // Razonamiento: con Stripe no disponible no se sabe si hay suscripción o no,
  // así que afirmar "sin_configurar" sería especular con datos que no se tienen.
  // Por eso "parcial" debe ganar, reportando que la información es incompleta.
  it('Stripe caido + plan de pago sin customer: parcial gana sobre sin_configurar', () => {
    const p = { plan: 'team', stripe_customer_id: null, trial_started_at: null }
    const item = aAccountDetail(USUARIO, p, null, { ...FICHA, stripeCaido: true }).health
      .find((h) => h.key === 'suscripcion')
    expect(item?.status).toBe('parcial')
    expect(item?.detail).toBe('Stripe no responde: el dato de cobro no esta disponible')
  })

  // El caso que quedaba mudo: `montoMensualCents` filtraba por status y la
  // salud no, así que un Team moroso salía con monto 0 y `health: ok` — el
  // único campo diseñado para levantar la mano, callado con la cuenta que hay
  // que mirar.
  it('una suscripcion past_due no esta ok: esta suspendida', () => {
    const morosa: SubResumen = { ...SUB, status: 'past_due', quantity: 5 }
    const r = aAccountDetail(USUARIO, PERFIL, morosa, { ...FICHA, seats: 5 })
    const item = r.health.find((h) => h.key === 'suscripcion')
    expect(item?.status).toBe('suspendido')
    expect(item?.detail).toBe('Suscripcion en estado past_due: no se esta cobrando')
    // Los dos campos ahora cuentan la misma historia.
    expect(r.monto_mensual_cents).toBe(0)
  })

  it('canceled, unpaid y paused tambien son suspendido', () => {
    for (const status of ['canceled', 'unpaid', 'paused', 'incomplete_expired']) {
      const item = aAccountDetail(USUARIO, PERFIL, { ...SUB, status }, FICHA).health
        .find((h) => h.key === 'suscripcion')
      expect(item?.status).toBe('suspendido')
    }
  })

  it('trialing sigue siendo ok: es una suscripcion viva', () => {
    const item = aAccountDetail(USUARIO, PERFIL, { ...SUB, status: 'trialing' }, FICHA).health
      .find((h) => h.key === 'suscripcion')
    expect(item?.status).toBe('ok')
    expect(item?.detail).toBe(null)
  })

  // Stripe caído gana: con el dato no disponible no se puede afirmar que el
  // cobro está frenado.
  it('Stripe caido gana sobre suspendido', () => {
    const item = aAccountDetail(USUARIO, PERFIL, { ...SUB, status: 'past_due' },
      { ...FICHA, stripeCaido: true }).health.find((h) => h.key === 'suscripcion')
    expect(item?.status).toBe('parcial')
  })

  it('expone la facturacion, con el monto multiplicado por seats', () => {
    const r = aAccountDetail(USUARIO, PERFIL, SUB, FICHA)
    expect(r.price_id).toBe('price_team_monthly')
    expect(r.monto_mensual_cents).toBe(10500) // 3500 x 3 seats
    expect(r.seats).toBe(3)
  })

  it('sin suscripcion la facturacion queda en cero, no en null', () => {
    const r = aAccountDetail(USUARIO, PERFIL, null, { ...FICHA, seats: 0 })
    expect(r.price_id).toBe(null)
    expect(r.monto_mensual_cents).toBe(0)
    expect(r.seats).toBe(0)
  })

  // Cero es un monto válido: con Stripe caído no se sabe cuánto paga la
  // cuenta, así que mentiría mostrar `0` en la pantalla donde se decide.
  it('con Stripe caido la facturacion es null, no cero', () => {
    const r = aAccountDetail(USUARIO, PERFIL, null, { ...FICHA, stripeCaido: true })
    expect(r.monto_mensual_cents).toBe(null)
    expect(r.seats).toBe(null)
  })

  it('la ficha tambien trae el ultimo uso, no solo la lista', () => {
    const r = aAccountDetail(USUARIO, PERFIL, SUB, FICHA, '2026-08-27T09:30:00.000Z')
    expect(r.last_activity_at).toBe('2026-08-27T09:30:00.000Z')
  })

  it('no filtra ninguna clave prohibida', () => {
    const r = aAccountDetail(USUARIO, PERFIL, SUB, FICHA)
    expect(clavesNoPermitidas(r, ACCOUNT_ALLOWED_KEYS)).toEqual([])
  })

  // El test que importa: si alguien serializa el perfil crudo, esto lo caza.
  it('detecta el token si alguien lo dejara entrar', () => {
    const sucio = { ...aAccountDetail(USUARIO, PERFIL, SUB, FICHA), github_token: 'ghp_x' }
    expect(clavesNoPermitidas(sucio, ACCOUNT_ALLOWED_KEYS)).toEqual(['github_token'])
  })
})
