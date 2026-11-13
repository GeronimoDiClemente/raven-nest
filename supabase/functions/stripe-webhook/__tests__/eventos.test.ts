import { describe, it, expect } from 'vitest'
import { decidir, armarPrecioAPlan, PRECIOS_LEGACY, suscripcionSigueViva, periodoDeCobro, PERIODO_VACIO, resolverActivacion } from '../eventos.ts'

const PRO_MENSUAL = 'price_1TJmwsJarRYFmNbKh7G6JXnF'
const TEAM_MENSUAL = 'price_1TJmyRJarRYFmNbKeiOLrXss'
const CLOUD_MENSUAL = 'price_cloud_mensual_test'
const CLOUD_ANUAL = 'price_cloud_anual_test'
// El mapa que arma el shell en producción: los precios viejos más los dos de Cloud.
const MAPA = armarPrecioAPlan({ STRIPE_PRICE_CLOUD_MONTHLY: CLOUD_MENSUAL, STRIPE_PRICE_CLOUD_ANNUAL: CLOUD_ANUAL })

function invoicePagada(over: Record<string, unknown> = {}) {
  return {
    type: 'invoice.paid',
    data: {
      object: {
        customer: 'cus_1',
        subscription: 'sub_1',
        subscription_details: { metadata: { user_id: 'u-1' } },
        lines: { data: [{ price: { id: PRO_MENSUAL } }] },
        ...over,
      },
    },
  }
}

describe('decidir', () => {
  // El cobro real del dia 14 llega como `invoice.paid`. Sin este caso, alguien
  // que paga y cuyo `checkout.session.completed` se perdio no se recupera nunca.
  it('invoice.paid activa el plan del precio cobrado', () => {
    expect(decidir(invoicePagada(), MAPA)).toEqual({
      tipo: 'activar',
      userId: 'u-1',
      plan: 'pro',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
    })
  })

  it('invoice.paid sin user_id se ignora en vez de reventar', () => {
    const e = invoicePagada({ subscription_details: { metadata: {} } })
    expect(decidir(e, MAPA).tipo).toBe('ignorar')
  })

  // Un precio que no esta en el mapa es un deploy a medias: se agrego en
  // Stripe y no en el codigo. Antes caia a `?? 'pro'`, asi que alguien que
  // compraba Team recibia Pro y la cuenta quedaba `ok` en el back-office —
  // invisible. Sin plan, en cambio, sale `sin_configurar` y se ve.
  it('invoice.paid con un precio desconocido no adivina el plan', () => {
    const e = invoicePagada({ lines: { data: [{ price: { id: 'price_nuevo' } }] } })
    const d = decidir(e, MAPA)
    expect(d.tipo).toBe('ignorar')
    expect(d.tipo === 'ignorar' && d.motivo).toContain('price_nuevo')
  })

  it('customer.subscription.deleted baja el plan a free', () => {
    const e = {
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', customer: 'cus_1', metadata: { user_id: 'u-1' } } },
    }
    expect(decidir(e, MAPA)).toEqual({ tipo: 'bajar_a_free', subscriptionId: 'sub_1' })
  })

  it('un evento que no manejamos se ignora nombrandolo', () => {
    const d = decidir({ type: 'payment_intent.succeeded', data: { object: {} } }, MAPA)
    expect(d.tipo).toBe('ignorar')
    expect(d.tipo === 'ignorar' && d.motivo).toContain('payment_intent.succeeded')
  })

  // ── checkout.session.completed ──────────────────────────────────────────
  // El evento NO trae el precio: hay que ir a buscar la suscripcion. Por eso el
  // priceId entra por parametro, resuelto por el shell, y `decidir` sigue puro.
  describe('checkout.session.completed', () => {
    const sesion = (over: Record<string, unknown> = {}) => ({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { user_id: 'u-1' },
          ...over,
        },
      },
    })

    it('activa el plan con el precio que resolvio el shell', () => {
      expect(decidir(sesion(), MAPA, PRO_MENSUAL)).toEqual({
        tipo: 'activar', userId: 'u-1', plan: 'pro',
        customerId: 'cus_1', subscriptionId: 'sub_1',
      })
    })

    // Antes caia a `?? 'pro'`: si no se pudo resolver el precio, daba Pro igual.
    it('sin precio resuelto no adivina el plan', () => {
      expect(decidir(sesion(), MAPA).tipo).toBe('ignorar')
    })

    it('sin user_id en la metadata se ignora', () => {
      expect(decidir(sesion({ metadata: {} }), MAPA, PRO_MENSUAL).tipo).toBe('ignorar')
    })
  })

  // ── customer.subscription.updated ───────────────────────────────────────
  describe('customer.subscription.updated', () => {
    const sub = (status: string, over: Record<string, unknown> = {}) => ({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          customer: 'cus_1',
          status,
          metadata: { user_id: 'u-1' },
          items: { data: [{ price: { id: TEAM_MENSUAL } }] },
          ...over,
        },
      },
    })

    it('una suscripcion active sincroniza el plan', () => {
      expect(decidir(sub('active'), MAPA)).toEqual({
        tipo: 'activar', userId: 'u-1', plan: 'team',
        customerId: 'cus_1', subscriptionId: 'sub_1',
      })
    })

    it('trialing tambien cuenta como viva', () => {
      expect(decidir(sub('trialing'), MAPA).tipo).toBe('activar')
    })

    // No se baja el plan aca: `past_due` es Stripe reintentando el cobro, y
    // revocar el acceso al primer rebote castiga una tarjeta que se renueva
    // sola dos dias despues. El unico que baja a free es `deleted`.
    it('past_due no toca el plan', () => {
      expect(decidir(sub('past_due'), MAPA).tipo).toBe('ignorar')
    })

    it('un cambio de precio mueve el plan al nuevo tier', () => {
      const e = sub('active', { items: { data: [{ price: { id: PRO_MENSUAL } }] } })
      const d = decidir(e, MAPA)
      expect(d.tipo === 'activar' && d.plan).toBe('pro')
    })
  })
})

// Spec 2b-2 §4.4: los precios de Cloud viven en secrets, no en el código.
describe('precios de Cloud (2b-2)', () => {
  it('los dos precios de Cloud activan el plan cloud', () => {
    for (const precio of [CLOUD_MENSUAL, CLOUD_ANUAL]) {
      const d = decidir(invoicePagada({ lines: { data: [{ price: { id: precio } }] } }), MAPA)
      expect(d).toEqual({ tipo: 'activar', userId: 'u-1', plan: 'cloud', customerId: 'cus_1', subscriptionId: 'sub_1' })
    }
  })

  it('checkout.session.completed con el anual de Cloud resuelto por el shell', () => {
    const e = { type: 'checkout.session.completed', data: { object: { customer: 'cus_1', subscription: 'sub_1', metadata: { user_id: 'u-1' } } } }
    const d = decidir(e, MAPA, CLOUD_ANUAL)
    expect(d.tipo === 'activar' && d.plan).toBe('cloud')
  })

  it('un precio desconocido sigue ignorado aunque haya precios de Cloud', () => {
    const d = decidir(invoicePagada({ lines: { data: [{ price: { id: 'price_otro' } }] } }), MAPA)
    expect(d.tipo).toBe('ignorar')
  })

  it('los precios legacy siguen intactos', () => {
    expect(MAPA[PRO_MENSUAL]).toBe('pro')
    expect(MAPA[TEAM_MENSUAL]).toBe('team')
    for (const [precio, plan] of Object.entries(PRECIOS_LEGACY)) expect(MAPA[precio]).toBe(plan)
  })

  it('sin secrets (o vacíos) no se mapea ningún precio de Cloud', () => {
    expect(armarPrecioAPlan({})).toEqual({ ...PRECIOS_LEGACY })
    expect(armarPrecioAPlan({ STRIPE_PRICE_CLOUD_MONTHLY: '', STRIPE_PRICE_CLOUD_ANNUAL: '  ' })).toEqual({ ...PRECIOS_LEGACY })
  })

  it('un secret no puede pisar un precio legacy', () => {
    const mapa = armarPrecioAPlan({ STRIPE_PRICE_CLOUD_MONTHLY: PRO_MENSUAL })
    expect(mapa[PRO_MENSUAL]).toBe('pro')
  })
})

// La cuenta de Stripe está en `2026-03-25.dahlia` y la versión de los eventos la fija el endpoint
// de webhook, no el SDK. Desde `basil` cambió la forma de la factura: la suscripción y su
// metadata pasaron a `parent.subscription_details`, y el precio de la línea a
// `pricing.price_details.price` (un id). Las suscripciones mantienen `items.data[].price`, pero
// `current_period_end` bajó a los items. Fixtures con la forma de `dahlia`:
describe('eventos con la forma de la API dahlia (desde basil)', () => {
  const lineaDahlia = (precio: unknown, extra: Record<string, unknown> = {}) => ({
    object: 'line_item',
    parent: {
      type: 'subscription_item_details',
      subscription_item_details: { subscription: 'sub_1', subscription_item: 'si_1', proration: false },
    },
    pricing: { type: 'price_details', price_details: { price: precio, product: 'prod_1' }, unit_amount_decimal: '1000' },
    ...extra,
  })
  const facturaDahlia = (over: Record<string, unknown> = {}) => ({
    type: 'invoice.paid',
    data: {
      object: {
        object: 'invoice',
        customer: 'cus_1',
        parent: {
          type: 'subscription_details',
          subscription_details: { metadata: { user_id: 'u-1' }, subscription: 'sub_1' },
        },
        lines: { object: 'list', data: [lineaDahlia(CLOUD_MENSUAL)] },
        ...over,
      },
    },
  })

  it('invoice.paid activa con la suscripción y el precio en su lugar nuevo', () => {
    expect(decidir(facturaDahlia(), MAPA)).toEqual({
      tipo: 'activar', userId: 'u-1', plan: 'cloud', customerId: 'cus_1', subscriptionId: 'sub_1',
    })
  })

  it('invoice.paid acepta el precio y la suscripción expandidos', () => {
    const e = facturaDahlia({
      parent: { type: 'subscription_details', subscription_details: { metadata: { user_id: 'u-1' }, subscription: { id: 'sub_1' } } },
      lines: { data: [lineaDahlia({ id: CLOUD_ANUAL, object: 'price' })] },
    })
    expect(decidir(e, MAPA)).toMatchObject({ tipo: 'activar', plan: 'cloud', subscriptionId: 'sub_1' })
  })

  it('invoice.paid sin user_id en parent se ignora', () => {
    const e = facturaDahlia({ parent: { type: 'subscription_details', subscription_details: { metadata: {}, subscription: 'sub_1' } } })
    expect(decidir(e, MAPA)).toEqual({ tipo: 'ignorar', motivo: 'sin user_id en la metadata' })
  })

  // Una factura suelta (sin suscripción) llega con `parent: null`: no hay nada que activar.
  it('invoice.paid de una factura sin suscripción se ignora', () => {
    expect(decidir(facturaDahlia({ parent: null }), MAPA).tipo).toBe('ignorar')
  })

  it('invoice.paid con precio desconocido no adivina el plan', () => {
    const d = decidir(facturaDahlia({ lines: { data: [lineaDahlia('price_nuevo')] } }), MAPA)
    expect(d.tipo === 'ignorar' && d.motivo).toContain('price_nuevo')
  })

  // Stripe pone los prorrateos antes que los items de la suscripción: la línea 0 no es
  // necesariamente la del precio que se cobra.
  it('invoice.paid no se queda con una primera línea de precio desconocido', () => {
    const e = facturaDahlia({ lines: { data: [lineaDahlia('price_ajeno'), lineaDahlia(CLOUD_ANUAL)] } })
    expect(decidir(e, MAPA)).toMatchObject({ tipo: 'activar', plan: 'cloud' })
  })

  it('checkout.session.completed no cambió de forma', () => {
    const e = {
      type: 'checkout.session.completed',
      data: { object: { object: 'checkout.session', mode: 'subscription', status: 'complete', customer: 'cus_1', subscription: 'sub_1', metadata: { user_id: 'u-1' } } },
    }
    expect(decidir(e, MAPA, CLOUD_MENSUAL)).toEqual({
      tipo: 'activar', userId: 'u-1', plan: 'cloud', customerId: 'cus_1', subscriptionId: 'sub_1',
    })
  })

  const subDahlia = (tipo: string, status: string) => ({
    type: tipo,
    data: {
      object: {
        id: 'sub_1', object: 'subscription', customer: 'cus_1', status, metadata: { user_id: 'u-1' },
        cancel_at_period_end: false,
        items: { data: [{ id: 'si_1', current_period_end: 1795910400, price: { id: CLOUD_ANUAL, object: 'price' } }] },
      },
    },
  })

  it('customer.subscription.updated activa con la forma nueva', () => {
    expect(decidir(subDahlia('customer.subscription.updated', 'active'), MAPA)).toEqual({
      tipo: 'activar', userId: 'u-1', plan: 'cloud', customerId: 'cus_1', subscriptionId: 'sub_1',
    })
  })

  it('customer.subscription.deleted baja a free con la forma nueva', () => {
    expect(decidir(subDahlia('customer.subscription.deleted', 'canceled'), MAPA))
      .toEqual({ tipo: 'bajar_a_free', subscriptionId: 'sub_1' })
  })
})

// Un id de precio que coincide con una propiedad heredada de Object no puede dar un "plan".
it('un precio llamado como una propiedad de Object no mapea', () => {
  const d = decidir(invoicePagada({ lines: { data: [{ price: { id: 'toString' } }] } }), MAPA)
  expect(d.tipo).toBe('ignorar')
})

describe('suscripcionSigueViva', () => {
  // Un `invoice.paid` o `subscription.updated` viejo que Stripe reintenta (días, sin orden) no
  // puede resucitar una suscripción que ya se canceló: el shell la relee y sólo activa si vive.
  it.each(['active', 'trialing', 'past_due'])('%s sigue viva', (status) => {
    expect(suscripcionSigueViva(status)).toBe(true)
  })

  it.each(['canceled', 'incomplete_expired', 'unpaid', 'incomplete', 'paused', '', undefined, null])(
    '%s no sigue viva', (status) => {
      expect(suscripcionSigueViva(status as string | null | undefined)).toBe(false)
    },
  )
})

describe('periodoDeCobro', () => {
  const ENV = { STRIPE_PRICE_CLOUD_MONTHLY: CLOUD_MENSUAL, STRIPE_PRICE_CLOUD_ANNUAL: CLOUD_ANUAL }
  const conPrecio = (id: string, extra: Record<string, unknown> = {}) => ({ items: { data: [{ price: { id } }] }, ...extra })

  it('el precio anual da annual y el mensual monthly', () => {
    expect(periodoDeCobro(conPrecio(CLOUD_ANUAL), ENV).billing_interval).toBe('annual')
    expect(periodoDeCobro(conPrecio(CLOUD_MENSUAL), ENV).billing_interval).toBe('monthly')
  })

  it('un precio legacy no tiene intervalo', () => {
    expect(periodoDeCobro(conPrecio(PRO_MENSUAL), ENV).billing_interval).toBeNull()
  })

  it('un secret vacío no matchea un precio vacío', () => {
    expect(periodoDeCobro(conPrecio(''), { STRIPE_PRICE_CLOUD_MONTHLY: '', STRIPE_PRICE_CLOUD_ANNUAL: '  ' }).billing_interval).toBeNull()
    expect(periodoDeCobro({}, {}).billing_interval).toBeNull()
  })

  it('current_period_end pasa de segundos a ISO; ausente o null da null', () => {
    expect(periodoDeCobro(conPrecio(CLOUD_ANUAL, { current_period_end: 1795910400 }), ENV).current_period_end)
      .toBe('2026-11-29T00:00:00.000Z')
    expect(periodoDeCobro(conPrecio(CLOUD_ANUAL), ENV).current_period_end).toBeNull()
    expect(periodoDeCobro(conPrecio(CLOUD_ANUAL, { current_period_end: null }), ENV).current_period_end).toBeNull()
  })

  it('cancel_at_period_end se copia; ausente es false', () => {
    expect(periodoDeCobro(conPrecio(CLOUD_ANUAL, { cancel_at_period_end: true }), ENV).cancel_at_period_end).toBe(true)
    expect(periodoDeCobro(conPrecio(CLOUD_ANUAL), ENV).cancel_at_period_end).toBe(false)
  })

  it('PERIODO_VACIO es todo null y false', () => {
    expect(PERIODO_VACIO).toEqual({ billing_interval: null, current_period_end: null, cancel_at_period_end: false })
  })

  // Desde `basil` la suscripción no trae `current_period_end` arriba: está en cada item.
  it('current_period_end se lee del item cuando la suscripción no lo trae arriba', () => {
    const sub = { items: { data: [{ price: { id: CLOUD_ANUAL }, current_period_end: 1795910400 }] } }
    expect(periodoDeCobro(sub, ENV)).toEqual({
      billing_interval: 'annual', current_period_end: '2026-11-29T00:00:00.000Z', cancel_at_period_end: false,
    })
  })
})

describe('resolverActivacion', () => {
  const ENV = { STRIPE_PRICE_CLOUD_MONTHLY: CLOUD_MENSUAL, STRIPE_PRICE_CLOUD_ANNUAL: CLOUD_ANUAL }
  const decision = { tipo: 'activar' as const, userId: 'u-1', plan: 'team', customerId: 'cus_1', subscriptionId: 'sub_1' }
  const releida = (precio: string, extra: Record<string, unknown> = {}) => ({
    status: 'active', cancel_at_period_end: false, current_period_end: 1795910400,
    items: { data: [{ price: { id: precio } }] }, ...extra,
  })

  // Un `subscription.updated` viejo (Team) reintentado después de pasar a Cloud anual: el plan y
  // el período tienen que salir de la misma suscripción, la de ahora.
  it('el plan sale del precio de la suscripción releída, no del evento', () => {
    expect(resolverActivacion(decision, releida(CLOUD_ANUAL), MAPA, ENV)).toEqual({
      tipo: 'aplicar',
      fila: {
        id: 'u-1', plan: 'cloud', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1',
        billing_interval: 'annual', current_period_end: '2026-11-29T00:00:00.000Z', cancel_at_period_end: false,
      },
    })
  })

  it('una suscripción que ya no vive no se activa', () => {
    const r = resolverActivacion(decision, releida(CLOUD_ANUAL, { status: 'canceled' }), MAPA, ENV)
    expect(r.tipo === 'descartar' && r.motivo).toContain('canceled')
  })

  it('past_due sigue activando (Stripe está reintentando el cobro)', () => {
    expect(resolverActivacion(decision, releida(CLOUD_MENSUAL, { status: 'past_due' }), MAPA, ENV).tipo).toBe('aplicar')
  })

  it('un precio desconocido en la suscripción releída no adivina el plan', () => {
    const r = resolverActivacion(decision, releida('price_nuevo'), MAPA, ENV)
    expect(r.tipo === 'descartar' && r.motivo).toContain('price_nuevo')
  })

  it('acepta la suscripción releída con la forma de basil en adelante', () => {
    const sub = { status: 'trialing', items: { data: [{ price: { id: CLOUD_MENSUAL }, current_period_end: 1795910400 }] } }
    const r = resolverActivacion(decision, sub, MAPA, ENV)
    expect(r.tipo === 'aplicar' && r.fila).toMatchObject({ plan: 'cloud', billing_interval: 'monthly', current_period_end: '2026-11-29T00:00:00.000Z' })
  })
})
