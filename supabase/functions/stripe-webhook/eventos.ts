/**
 * Decide que hacer con un evento de Stripe. Modulo puro: sin SDK, sin red y
 * sin cliente de Supabase, para que se pueda testear con vitest en Node igual
 * que los modulos de `admin-api`. El shell (`index.ts`) valida la firma y
 * ejecuta la decision.
 */

/** Price ID de Stripe -> plan de Nest. */
export const PRECIO_A_PLAN: Record<string, string> = {
  price_1TJmwsJarRYFmNbKh7G6JXnF: 'pro',   // pro mensual $20
  price_1TJmy8JarRYFmNbKeScj4mwX: 'pro',   // pro anual $204 (legacy 15% off)
  price_1TbX45JarRYFmNbKXYSBT3Yn: 'pro',   // pro anual $180 (actual 25% off)
  price_1TJmyRJarRYFmNbKeiOLrXss: 'team',  // team mensual $35
  price_1TJmyyJarRYFmNbKq9mRgrdz: 'team',  // team anual $348 (legacy 15% off)
  price_1TbX66JarRYFmNbKqTA1AoEA: 'team',  // team anual $312 (actual 25% off)
}

export type Decision =
  | {
      tipo: 'activar'
      userId: string
      plan: string
      customerId: string
      subscriptionId: string
    }
  | { tipo: 'bajar_a_free'; subscriptionId: string }
  | { tipo: 'ignorar'; motivo: string }

/** Forma minima de un evento de Stripe: lo que leemos, nada mas. */
export interface EventoStripe {
  type: string
  data: { object: Record<string, unknown> }
}

const ignorar = (motivo: string): Decision => ({ tipo: 'ignorar', motivo })

interface DatosActivacion {
  userId?: string
  priceId?: string
  customerId?: string
  subscriptionId?: string
}

/**
 * Arma la decision de activar, o explica por que no se puede.
 *
 * **No adivina el plan.** Un precio que no esta en `PRECIO_A_PLAN` es un
 * deploy a medias —se agrego en Stripe y no en el codigo—, y el `?? 'pro'`
 * que habia antes le daba Pro a alguien que compro Team, dejando la cuenta
 * como `ok` en el back-office: un cobro mal provisionado e invisible. Sin
 * plan, la cuenta sale `sin_configurar` y alguien la ve.
 */
function activar(d: DatosActivacion): Decision {
  if (!d.userId) return ignorar('sin user_id en la metadata')
  if (!d.customerId || !d.subscriptionId) return ignorar('sin customer o subscription')
  const plan = d.priceId ? PRECIO_A_PLAN[d.priceId] : undefined
  if (!plan) return ignorar(`precio desconocido: ${d.priceId ?? 'ninguno'}`)
  return {
    tipo: 'activar',
    userId: d.userId,
    plan,
    customerId: d.customerId,
    subscriptionId: d.subscriptionId,
  }
}

/**
 * Una suscripcion "viva" es la que se esta cobrando hoy: `active` o `trialing`.
 * Misma definicion que `admin-api/pricing.ts`, a proposito — si los dos lados
 * discrepan, el back-office muestra una cuenta como paga que aca no lo es.
 */
const VIVAS = ['active', 'trialing']

/**
 * Decide que hacer con un evento.
 *
 * `priceIdDeRespaldo` existe por `checkout.session.completed`, el unico evento
 * que no trae el precio adentro: el shell resuelve la suscripcion contra Stripe
 * y lo pasa por aca, de modo que esta funcion sigue sin hacer red.
 */
export function decidir(evento: EventoStripe, priceIdDeRespaldo: string | null = null): Decision {
  const o = evento.data.object as Record<string, any>

  // El cobro real (el del dia 14, y cada renovacion). Tambien es la red de
  // seguridad del checkout: si aquel evento se perdio, este reactiva el plan.
  if (evento.type === 'invoice.paid') {
    return activar({
      userId: o.subscription_details?.metadata?.user_id,
      priceId: o.lines?.data?.[0]?.price?.id,
      customerId: o.customer,
      subscriptionId: o.subscription,
    })
  }

  if (evento.type === 'checkout.session.completed') {
    return activar({
      userId: o.metadata?.user_id,
      priceId: priceIdDeRespaldo ?? undefined,
      customerId: o.customer,
      subscriptionId: o.subscription,
    })
  }

  // Cambios de tier (upgrade/downgrade) y transiciones de estado.
  if (evento.type === 'customer.subscription.updated') {
    if (!VIVAS.includes(o.status)) {
      // No se baja el plan aca. `past_due` es Stripe reintentando el cobro:
      // revocar el acceso al primer rebote castiga a una tarjeta que se
      // renueva sola dos dias despues. El unico que baja a free es `deleted`.
      return ignorar(`suscripcion en estado ${o.status}: no se toca el plan`)
    }
    return activar({
      userId: o.metadata?.user_id,
      priceId: o.items?.data?.[0]?.price?.id,
      customerId: o.customer,
      subscriptionId: o.id,
    })
  }

  if (evento.type === 'customer.subscription.deleted') {
    if (!o.id) return ignorar('sin id de suscripcion')
    return { tipo: 'bajar_a_free', subscriptionId: o.id }
  }

  return ignorar(`evento no manejado: ${evento.type}`)
}
