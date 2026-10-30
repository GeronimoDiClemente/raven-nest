// El cobro de Cloud desde la app. Las dos edge functions autentican con la
// sesión de Supabase (supabase-js manda el JWT solo) y devuelven `{ url }` o `{ error: <código> }`.
import { supabase } from './supabase'
import type { BillingInterval } from './stripe'

export const COPY_CHECKOUT_NO_DISPONIBLE = "Checkout isn't available right now — try again later."
export const COPY_CHECKOUT_SIN_RED = "Couldn't reach checkout. Check your connection and try again."
export const COPY_SIN_SUSCRIPCION = 'No subscription found for this account.'

export type ResultadoDeCobro = { ok: true } | { ok: false; error: string; code: string | null }

/**
 * El copy de un código de error de las funciones. El portal usa el genérico, salvo
 * `no_subscription`, que no es un problema de red y no puede decir "Check your connection".
 */
export function textoDeErrorDeCobro(code: string | null): string {
  if (code === 'checkout_unavailable') return COPY_CHECKOUT_NO_DISPONIBLE
  if (code === 'no_subscription') return COPY_SIN_SUSCRIPCION
  return COPY_CHECKOUT_SIN_RED
}

/** supabase-js pone la Response del no-2xx en `error.context`; el código va en su cuerpo. */
async function codigoDeError(error: unknown): Promise<string | null> {
  const contexto = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context
  if (!contexto || typeof contexto.json !== 'function') return null
  try {
    const cuerpo = (await contexto.json()) as { error?: unknown } | null
    return typeof cuerpo?.error === 'string' ? cuerpo.error : null
  } catch {
    return null
  }
}

async function invocar(funcion: 'stripe-checkout' | 'stripe-portal', body: object): Promise<{ url: string } | { code: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke(funcion, { body })
    if (error) return { code: await codigoDeError(error) }
    const url = (data as { url?: unknown } | null)?.url
    return typeof url === 'string' && url ? { url } : { code: null }
  } catch {
    return { code: null }
  }
}

export async function abrirPortal(): Promise<ResultadoDeCobro> {
  const r = await invocar('stripe-portal', {})
  if ('url' in r) {
    window.electronShell.openExternal(r.url)
    return { ok: true }
  }
  return { ok: false, error: textoDeErrorDeCobro(r.code), code: r.code }
}

export async function abrirCheckout(interval: BillingInterval): Promise<ResultadoDeCobro> {
  const r = await invocar('stripe-checkout', { interval })
  if ('url' in r) {
    window.electronShell.openExternal(r.url)
    return { ok: true }
  }
  // Ya paga: el servidor evita el doble cobro y acá se abre su suscripción en vez de fallar.
  if (r.code === 'already_subscribed') return abrirPortal()
  return { ok: false, error: textoDeErrorDeCobro(r.code), code: r.code }
}
