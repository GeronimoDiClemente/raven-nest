// Spec 2b-2 §4.3: el portal de Stripe sólo existe para quien tiene customer.
import { describe, it, expect } from 'vitest'
import { decidirPortal, URL_DE_VUELTA } from '../portal.ts'

describe('decidirPortal', () => {
  it('con customer, una sesión que vuelve a nestmux', () => {
    expect(decidirPortal({ stripe_customer_id: 'cus_1' })).toEqual({ ok: true, sesion: { customer: 'cus_1', return_url: URL_DE_VUELTA } })
    expect(URL_DE_VUELTA).toBe('https://nestmux.com/checkout/portal-return')
  })

  it('sin customer (o sin perfil) es 404 no_subscription', () => {
    expect(decidirPortal({ stripe_customer_id: null })).toEqual({ ok: false, status: 404, error: 'no_subscription' })
    expect(decidirPortal({ stripe_customer_id: '' })).toEqual({ ok: false, status: 404, error: 'no_subscription' })
    expect(decidirPortal(null)).toEqual({ ok: false, status: 404, error: 'no_subscription' })
  })
})
