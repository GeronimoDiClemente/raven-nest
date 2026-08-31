import { describe, it, expect } from 'vitest'
import { decidir } from '../eventos.ts'

const PRO_MENSUAL = 'price_1TJmwsJarRYFmNbKh7G6JXnF'
const TEAM_MENSUAL = 'price_1TJmyRJarRYFmNbKeiOLrXss'

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
    expect(decidir(invoicePagada())).toEqual({
      tipo: 'activar',
      userId: 'u-1',
      plan: 'pro',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
    })
  })

  it('invoice.paid sin user_id se ignora en vez de reventar', () => {
    const e = invoicePagada({ subscription_details: { metadata: {} } })
    expect(decidir(e).tipo).toBe('ignorar')
  })

  // Un precio que no esta en el mapa es un deploy a medias: se agrego en
  // Stripe y no en el codigo. Antes caia a `?? 'pro'`, asi que alguien que
  // compraba Team recibia Pro y la cuenta quedaba `ok` en el back-office —
  // invisible. Sin plan, en cambio, sale `sin_configurar` y se ve.
  it('invoice.paid con un precio desconocido no adivina el plan', () => {
    const e = invoicePagada({ lines: { data: [{ price: { id: 'price_nuevo' } }] } })
    const d = decidir(e)
    expect(d.tipo).toBe('ignorar')
    expect(d.tipo === 'ignorar' && d.motivo).toContain('price_nuevo')
  })

  it('customer.subscription.deleted baja el plan a free', () => {
    const e = {
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', customer: 'cus_1', metadata: { user_id: 'u-1' } } },
    }
    expect(decidir(e)).toEqual({ tipo: 'bajar_a_free', subscriptionId: 'sub_1' })
  })

  it('un evento que no manejamos se ignora nombrandolo', () => {
    const d = decidir({ type: 'payment_intent.succeeded', data: { object: {} } })
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
      expect(decidir(sesion(), PRO_MENSUAL)).toEqual({
        tipo: 'activar', userId: 'u-1', plan: 'pro',
        customerId: 'cus_1', subscriptionId: 'sub_1',
      })
    })

    // Antes caia a `?? 'pro'`: si no se pudo resolver el precio, daba Pro igual.
    it('sin precio resuelto no adivina el plan', () => {
      expect(decidir(sesion()).tipo).toBe('ignorar')
    })

    it('sin user_id en la metadata se ignora', () => {
      expect(decidir(sesion({ metadata: {} }), PRO_MENSUAL).tipo).toBe('ignorar')
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
      expect(decidir(sub('active'))).toEqual({
        tipo: 'activar', userId: 'u-1', plan: 'team',
        customerId: 'cus_1', subscriptionId: 'sub_1',
      })
    })

    it('trialing tambien cuenta como viva', () => {
      expect(decidir(sub('trialing')).tipo).toBe('activar')
    })

    // No se baja el plan aca: `past_due` es Stripe reintentando el cobro, y
    // revocar el acceso al primer rebote castiga una tarjeta que se renueva
    // sola dos dias despues. El unico que baja a free es `deleted`.
    it('past_due no toca el plan', () => {
      expect(decidir(sub('past_due')).tipo).toBe('ignorar')
    })

    it('un cambio de precio mueve el plan al nuevo tier', () => {
      const e = sub('active', { items: { data: [{ price: { id: PRO_MENSUAL } }] } })
      const d = decidir(e)
      expect(d.tipo === 'activar' && d.plan).toBe('pro')
    })
  })
})
