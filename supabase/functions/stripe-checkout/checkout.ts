/**
 * Spec 2b-2 §4.2: qué sesión de Stripe se crea, o por qué no. Módulo puro —sin SDK, sin red,
 * sin Deno— para testearlo con vitest en Node, igual que `stripe-webhook/eventos.ts`.
 *
 * La identidad sale SÓLO del JWT y el precio SÓLO de los secrets: el cliente ya no puede
 * pagar por otro (`userId` del body) ni elegir un precio arbitrario (`priceId` del body).
 */

export type Intervalo = 'monthly' | 'annual'

/** Planes que se cobran. Misma lista que `PLANES_PAGOS` del servidor de sync. */
export const PLANES_PAGOS: readonly string[] = ['cloud', 'pro', 'team', 'enterprise']

export const URL_EXITO = 'https://nestmux.com/checkout/success'
export const URL_CANCELADO = 'https://nestmux.com/checkout/cancelled'

export interface PerfilDeCobro {
  plan: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
}

export interface ParametrosDeSesion {
  mode: 'subscription'
  line_items: Array<{ price: string; quantity: 1 }>
  metadata: { user_id: string }
  subscription_data: { metadata: { user_id: string } }
  success_url: string
  cancel_url: string
  customer?: string
  customer_email?: string
}

export type DecisionDeCheckout =
  | { ok: true; sesion: ParametrosDeSesion }
  | { ok: false; status: 400 | 409 | 503; error: 'invalid_interval' | 'already_subscribed' | 'checkout_unavailable' }

function leerIntervalo(body: unknown): Intervalo | null {
  if (!body || typeof body !== 'object') return null
  const i = (body as { interval?: unknown }).interval
  return i === 'monthly' || i === 'annual' ? i : null
}

export function decidirCheckout(e: {
  body: unknown
  precios: { monthly?: string; annual?: string }
  perfil: PerfilDeCobro | null
  userId: string
  email: string | null
}): DecisionDeCheckout {
  const intervalo = leerIntervalo(e.body)
  if (!intervalo) return { ok: false, status: 400, error: 'invalid_interval' }

  // Sin el secret el botón no puede cobrar nada correcto: 503, configuración faltante.
  const precio = e.precios[intervalo]?.trim()
  if (!precio) return { ok: false, status: 503, error: 'checkout_unavailable' }

  // Doble cobro: hace falta la suscripción Y un plan pago. Una sub guardada con plan free es
  // un webhook a medias, y bloquear ahí dejaría a la persona sin poder pagar.
  const p = e.perfil
  if (p?.stripe_subscription_id && p.plan && PLANES_PAGOS.includes(p.plan)) {
    return { ok: false, status: 409, error: 'already_subscribed' }
  }

  const sesion: ParametrosDeSesion = {
    mode: 'subscription',
    line_items: [{ price: precio, quantity: 1 }],
    // Sin `trial_period_days` (decisión 1 de Gero): Free con un proyecto ya es la prueba.
    metadata: { user_id: e.userId },
    subscription_data: { metadata: { user_id: e.userId } },
    success_url: URL_EXITO,
    cancel_url: URL_CANCELADO,
  }
  // Reusar el customer evita un segundo cliente en Stripe para quien canceló y vuelve.
  if (p?.stripe_customer_id) sesion.customer = p.stripe_customer_id
  else if (e.email) sesion.customer_email = e.email
  return { ok: true, sesion }
}

/**
 * Stripe contesta `resource_missing` sobre `customer` cuando el customer guardado en el perfil
 * ya no existe (borrado a mano en el dashboard, o de otra cuenta de Stripe). `code` y `param`
 * cuelgan del error como propiedades; se leen defensivamente porque llega como `unknown`.
 */
export function esClienteInexistente(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const { code, param } = err as { code?: unknown; param?: unknown }
  return code === 'resource_missing' && param === 'customer'
}

/** La misma sesión sin el customer muerto: Stripe crea uno nuevo a partir del email, si lo hay. */
export function sinCliente(sesion: ParametrosDeSesion, email: string | null): ParametrosDeSesion {
  const { customer: _viejo, customer_email: _mail, ...resto } = sesion
  return email ? { ...resto, customer_email: email } : resto
}
