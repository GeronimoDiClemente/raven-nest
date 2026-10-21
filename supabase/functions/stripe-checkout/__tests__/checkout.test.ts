// Spec 2b-2 §4.2: la decisión del checkout, pura. El shell (index.ts) sólo autentica, lee el
// perfil y le pasa esto a Stripe.
import { describe, it, expect } from 'vitest'
import { decidirCheckout, jwtDelHeader, URL_CANCELADO, URL_EXITO, type PerfilDeCobro } from '../checkout.ts'

const PRECIOS = { monthly: 'price_m', annual: 'price_a' }
const SIN_PERFIL: PerfilDeCobro = { plan: 'free', stripe_customer_id: null, stripe_subscription_id: null }
const base = (over: Partial<Parameters<typeof decidirCheckout>[0]> = {}) =>
  decidirCheckout({ body: { interval: 'monthly' }, precios: PRECIOS, perfil: SIN_PERFIL, userId: 'u-1', email: 'gero@x.com', ...over })

describe('decidirCheckout', () => {
  it('el intervalo elige el precio de los secrets', () => {
    const m = base()
    const a = base({ body: { interval: 'annual' } })
    expect(m.ok && m.sesion.line_items).toEqual([{ price: 'price_m', quantity: 1 }])
    expect(a.ok && a.sesion.line_items).toEqual([{ price: 'price_a', quantity: 1 }])
  })

  it('un intervalo inválido (o un body que no es objeto) es 400 invalid_interval', () => {
    for (const body of [{ interval: 'weekly' }, {}, null, 'monthly', { interval: 1 }, { priceId: 'price_x' }]) {
      expect(base({ body })).toEqual({ ok: false, status: 400, error: 'invalid_interval' })
    }
  })

  it('sin el secret del precio pedido es 503 checkout_unavailable', () => {
    expect(base({ precios: {} })).toEqual({ ok: false, status: 503, error: 'checkout_unavailable' })
    expect(base({ precios: { monthly: 'price_m', annual: '' }, body: { interval: 'annual' } }))
      .toEqual({ ok: false, status: 503, error: 'checkout_unavailable' })
  })

  it('ya suscripto (suscripción viva y plan pago) es 409 already_subscribed', () => {
    for (const plan of ['cloud', 'pro', 'team', 'enterprise']) {
      expect(base({ perfil: { plan, stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' } }))
        .toEqual({ ok: false, status: 409, error: 'already_subscribed' })
    }
  })

  // Review Focus 3: canceló (sub en null, plan free) y vuelve a pagar con el MISMO customer.
  it('quien canceló y vuelve no es already_subscribed y reusa su customer', () => {
    const d = base({ perfil: { plan: 'free', stripe_customer_id: 'cus_1', stripe_subscription_id: null } })
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.sesion.customer).toBe('cus_1')
    expect(d.sesion.customer_email).toBeUndefined()
  })

  it('una sub guardada con plan free (webhook a medias) no bloquea el pago', () => {
    expect(base({ perfil: { plan: 'free', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_viejo' } }).ok).toBe(true)
  })

  it('sin customer usa el email del JWT; sin email, ninguno de los dos', () => {
    const d = base()
    expect(d.ok && d.sesion.customer_email).toBe('gero@x.com')
    expect(d.ok && 'customer' in d.sesion).toBe(false)
    const sinEmail = base({ email: null, perfil: null })
    expect(sinEmail.ok && 'customer_email' in sinEmail.sesion).toBe(false)
  })

  it('sin trial, cantidad 1, metadata con el user_id en la sesión y en la suscripción, URLs de nestmux', () => {
    const d = base()
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.sesion).toMatchObject({
      mode: 'subscription',
      metadata: { user_id: 'u-1' },
      subscription_data: { metadata: { user_id: 'u-1' } },
      success_url: URL_EXITO,
      cancel_url: URL_CANCELADO,
    })
    expect(JSON.stringify(d.sesion)).not.toContain('trial')
    expect(URL_EXITO).toBe('https://nestmux.com/checkout/success')
    expect(URL_CANCELADO).toBe('https://nestmux.com/checkout/cancelled')
  })
})

describe('jwtDelHeader', () => {
  it('saca el token del Bearer; sin header o vacío, null', () => {
    expect(jwtDelHeader('Bearer abc.def.ghi')).toBe('abc.def.ghi')
    expect(jwtDelHeader('bearer   abc')).toBe('abc')
    expect(jwtDelHeader(null)).toBeNull()
    expect(jwtDelHeader('Bearer ')).toBeNull()
    expect(jwtDelHeader('Basic abc')).toBeNull()
  })
})
