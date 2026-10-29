/**
 * Spec 2b-2 §4.3: la sesión del Customer Portal de Stripe, o por qué no hay. Puro, como
 * `stripe-checkout/checkout.ts`. Lo que el portal deja hacer (cancelar al fin del período,
 * tarjeta, facturas, mensual <-> anual) se configura en el dashboard de Stripe, no acá.
 */
import { esClienteInexistente } from '../stripe-checkout/checkout.ts'

export const URL_DE_VUELTA = 'https://nestmux.com/checkout/portal-return'

export type DecisionDePortal =
  | { ok: true; sesion: { customer: string; return_url: string } }
  | { ok: false; status: 404; error: 'no_subscription' }

export function decidirPortal(perfil: { stripe_customer_id: string | null } | null): DecisionDePortal {
  const customer = perfil?.stripe_customer_id
  if (!customer) return { ok: false, status: 404, error: 'no_subscription' }
  return { ok: true, sesion: { customer, return_url: URL_DE_VUELTA } }
}

export type DecisionTrasError =
  | { limpiarCliente: true; status: 404; error: 'no_subscription' }
  | { limpiarCliente: false; status: 502; error: 'stripe_error' }

/**
 * Si Stripe dice que el customer ya no existe, para el portal es lo mismo que no tener ninguno:
 * 404 `no_subscription` (el mismo código que `decidirPortal`, es el que mira la app) y hay que
 * limpiar el id muerto del perfil. Cualquier otro error sigue siendo 502.
 */
export function decidirPortalTrasError(err: unknown): DecisionTrasError {
  if (esClienteInexistente(err)) return { limpiarCliente: true, status: 404, error: 'no_subscription' }
  return { limpiarCliente: false, status: 502, error: 'stripe_error' }
}
