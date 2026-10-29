// @vitest-environment jsdom
// Spec 2b-2 §4.8: el cobro desde la app. Las funciones de Supabase devuelven el código del
// error en el cuerpo; acá se traduce a copy y `already_subscribed` cae al portal.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const supabaseMock = vi.hoisted(() => ({ functions: { invoke: vi.fn() } }))
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

import { abrirCheckout, abrirPortal, COPY_CHECKOUT_NO_DISPONIBLE, COPY_CHECKOUT_SIN_RED, textoDeErrorDeCobro } from '../../lib/checkout'

const conCodigo = (error: string) => ({ data: null, error: { context: { json: async () => ({ error }) } } })
let openExternal: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  openExternal = vi.fn()
  ;(globalThis as unknown as { window: { electronShell: unknown } }).window.electronShell = { openExternal }
})

describe('textoDeErrorDeCobro', () => {
  it('checkout_unavailable tiene su copy; cualquier otro, el genérico', () => {
    expect(COPY_CHECKOUT_NO_DISPONIBLE).toBe("Checkout isn't available right now — try again later.")
    expect(COPY_CHECKOUT_SIN_RED).toBe("Couldn't reach checkout. Check your connection and try again.")
    expect(textoDeErrorDeCobro('checkout_unavailable')).toBe(COPY_CHECKOUT_NO_DISPONIBLE)
    expect(textoDeErrorDeCobro('stripe_error')).toBe(COPY_CHECKOUT_SIN_RED)
    expect(textoDeErrorDeCobro(null)).toBe(COPY_CHECKOUT_SIN_RED)
  })
})

describe('abrirCheckout', () => {
  it('manda sólo el intervalo y abre la URL afuera', async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: { url: 'https://checkout.stripe.test/s' }, error: null })
    expect(await abrirCheckout('annual')).toEqual({ ok: true })
    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith('stripe-checkout', { body: { interval: 'annual' } })
    expect(openExternal).toHaveBeenCalledWith('https://checkout.stripe.test/s')
  })

  it('already_subscribed abre el portal en vez de fallar', async () => {
    supabaseMock.functions.invoke
      .mockResolvedValueOnce(conCodigo('already_subscribed'))
      .mockResolvedValueOnce({ data: { url: 'https://billing.stripe.test/p' }, error: null })
    expect(await abrirCheckout('monthly')).toEqual({ ok: true })
    expect(supabaseMock.functions.invoke).toHaveBeenNthCalledWith(2, 'stripe-portal', { body: {} })
    expect(openExternal).toHaveBeenCalledWith('https://billing.stripe.test/p')
  })

  it('checkout_unavailable, un error sin cuerpo, una URL ausente o una excepción: copy y nada abierto', async () => {
    supabaseMock.functions.invoke.mockResolvedValueOnce(conCodigo('checkout_unavailable'))
    expect(await abrirCheckout('monthly')).toEqual({ ok: false, error: COPY_CHECKOUT_NO_DISPONIBLE, code: 'checkout_unavailable' })
    supabaseMock.functions.invoke.mockResolvedValueOnce({ data: null, error: new Error('Failed to send a request') })
    expect(await abrirCheckout('monthly')).toEqual({ ok: false, error: COPY_CHECKOUT_SIN_RED, code: null })
    supabaseMock.functions.invoke.mockResolvedValueOnce({ data: {}, error: null })
    expect(await abrirCheckout('monthly')).toEqual({ ok: false, error: COPY_CHECKOUT_SIN_RED, code: null })
    supabaseMock.functions.invoke.mockRejectedValueOnce(new Error('offline'))
    expect(await abrirCheckout('monthly')).toEqual({ ok: false, error: COPY_CHECKOUT_SIN_RED, code: null })
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('abrirPortal', () => {
  it('abre el portal; sin suscripción, el genérico (D8)', async () => {
    supabaseMock.functions.invoke.mockResolvedValueOnce({ data: { url: 'https://billing.stripe.test/p' }, error: null })
    expect(await abrirPortal()).toEqual({ ok: true })
    supabaseMock.functions.invoke.mockResolvedValueOnce(conCodigo('no_subscription'))
    expect(await abrirPortal()).toEqual({ ok: false, error: COPY_CHECKOUT_SIN_RED, code: 'no_subscription' })
  })
})
