/** Los 4 tiers de Nest. `enterprise` no es self-serve: se asigna a mano. */
export const PLANES_VALIDOS = ['free', 'pro', 'team', 'enterprise'] as const

export const TRIAL_DIAS = 15

const ETIQUETAS: Record<string, string> = {
  free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise',
}

/** Lo que necesitamos de una suscripción de Stripe, sin depender del SDK. */
export interface SubResumen {
  status: string
  unit_amount: number | null
  quantity: number
  interval: 'day' | 'week' | 'month' | 'year' | null
  interval_count: number
  price_id: string | null
}

/**
 * Monto mensual en centavos.
 *
 * Multiplica por `quantity` porque Team y Enterprise se cobran **por seat**
 * (mínimo 2 y 4). raven-admin no lo hacía: un equipo de 5 seats figuraba como
 * $35 en vez de $175, y el MRR quedaba subestimado.
 *
 * Solo genera monto si el status es `active` o `trialing`. Cualquier otro
 * status (canceled, incomplete, unpaid, past_due, paused, etc.) devuelve 0,
 * para evitar que suscripciones canceladas se sumen al MRR.
 */
export function montoMensualCents(sub: SubResumen | null): number {
  if (!sub || !sub.unit_amount) return 0
  if (sub.status !== 'active' && sub.status !== 'trialing') return 0
  const count = sub.interval_count || 1
  const porSeat = sub.unit_amount
  let mensual: number
  switch (sub.interval) {
    case 'year':  mensual = porSeat / (12 * count); break
    case 'week':  mensual = (porSeat * 52) / 12 / count; break
    case 'day':   mensual = (porSeat * 365) / 12 / count; break
    default:      mensual = porSeat / count
  }
  return Math.round(mensual * (sub.quantity ?? 1))
}

/**
 * El ciclo va en la etiqueta porque el mismo plan tiene precio mensual y anual,
 * y desde el back-office no hay otra forma de distinguirlos de un vistazo.
 */
export function planLabel(plan: string, sub: SubResumen | null): string {
  const base = ETIQUETAS[plan] ?? plan
  if (!sub || !sub.interval) return base
  return `${base} (${sub.interval === 'year' ? 'anual' : 'mensual'})`
}

export function trialEndsAt(trialStartedAt: string | null): string | null {
  if (!trialStartedAt) return null
  const inicio = new Date(trialStartedAt)
  if (Number.isNaN(inicio.getTime())) return null
  return new Date(inicio.getTime() + TRIAL_DIAS * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Lo mínimo que `aSubResumen` necesita leer de una suscripción de Stripe.
 *
 * Un tipo estructural en vez de `Stripe.Subscription`: así este módulo sigue
 * puro (sin importar el SDK de Stripe) y `aSubResumen` queda testeable sin
 * Deno ni red, igual que el resto de `pricing.ts`.
 */
export interface StripeSubscripcionMinima {
  status: string
  items: {
    data: Array<{
      quantity?: number | null
      price: {
        id?: string | null
        unit_amount?: number | null
        recurring?: {
          interval?: 'day' | 'week' | 'month' | 'year' | null
          interval_count?: number | null
        } | null
      }
    }>
  }
}

/** Mapea una suscripción de Stripe (o su forma mínima) al resumen del contrato. */
export function aSubResumen(s: StripeSubscripcionMinima): SubResumen {
  const item = s.items.data[0]
  return {
    status: s.status,
    unit_amount: item?.price.unit_amount ?? null,
    quantity: item?.quantity ?? 1,
    interval: item?.price.recurring?.interval ?? null,
    interval_count: item?.price.recurring?.interval_count ?? 1,
    price_id: item?.price.id ?? null,
  }
}
