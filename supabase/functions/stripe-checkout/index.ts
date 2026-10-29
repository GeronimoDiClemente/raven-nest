// Supabase Edge Function — crea la sesión de Stripe Checkout de Cloud (spec 2b-2 §4.2).
// Deploy: supabase functions deploy stripe-checkout
// Secrets:
//   supabase secrets set STRIPE_SECRET_KEY=sk_...
//   supabase secrets set STRIPE_PRICE_CLOUD_MONTHLY=price_... STRIPE_PRICE_CLOUD_ANNUAL=price_...
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.

import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno'
import { jwtDelHeader } from '../_shared/jwt.ts'
import { decidirCheckout, esClienteInexistente, sinCliente } from './checkout.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-11-20.acacia',
  httpClient: Stripe.createFetchHttpClient(),
})

// Service role: valida el JWT (auth.getUser) y lee las columnas de cobro, que el cliente no
// puede escribir (`protect_profile_billing_columns`).
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  // La identidad sale SÓLO del JWT: el body ya no trae userId ni email.
  const jwt = jwtDelHeader(req.headers.get('Authorization'))
  if (!jwt) return json(401, { error: 'unauthorized' })
  const { data: auth, error: authError } = await admin.auth.getUser(jwt)
  const user = auth?.user
  if (authError || !user) return json(401, { error: 'unauthorized' })

  let body: unknown = null
  try {
    body = await req.json()
  } catch {
    // Body ilegible: no hay intervalo que leer (D7 del plan).
  }

  const { data: perfil, error: perfilError } = await admin
    .from('profiles')
    .select('plan, stripe_customer_id, stripe_subscription_id')
    .eq('id', user.id)
    .maybeSingle()
  if (perfilError) {
    console.error('[stripe-checkout] no se pudo leer el perfil', { userId: user.id, error: perfilError.message })
    return json(500, { error: 'internal_error' })
  }

  const decision = decidirCheckout({
    body,
    precios: {
      monthly: Deno.env.get('STRIPE_PRICE_CLOUD_MONTHLY'),
      annual: Deno.env.get('STRIPE_PRICE_CLOUD_ANNUAL'),
    },
    perfil,
    userId: user.id,
    email: user.email ?? null,
  })
  if (!decision.ok) {
    if (decision.error === 'checkout_unavailable') {
      console.error('[stripe-checkout] faltan los secrets STRIPE_PRICE_CLOUD_*')
    }
    return json(decision.status, { error: decision.error })
  }

  try {
    const session = await stripe.checkout.sessions.create(decision.sesion)
    if (!session.url) return json(502, { error: 'stripe_error' })
    return json(200, { url: session.url })
  } catch (e) {
    const viejo = decision.sesion.customer
    if (viejo && esClienteInexistente(e)) {
      // El customer guardado ya no existe en Stripe: se limpia (condicionado al id viejo, por si
      // el webhook ya lo cambió) y se reintenta UNA vez con el email. El reintento no depende
      // de que el update haya andado.
      console.warn('[stripe-checkout] el customer ya no existe en Stripe, reintento sin él', { userId: user.id, customer: viejo })
      const { error: limpiarError } = await admin
        .from('profiles')
        .update({ stripe_customer_id: null, updated_at: new Date().toISOString() })
        .eq('id', user.id)
        .eq('stripe_customer_id', viejo)
      if (limpiarError) {
        console.error('[stripe-checkout] no se pudo limpiar el customer', { userId: user.id, error: limpiarError.message })
      }
      try {
        const reintento = await stripe.checkout.sessions.create(sinCliente(decision.sesion, user.email ?? null))
        if (!reintento.url) return json(502, { error: 'stripe_error' })
        return json(200, { url: reintento.url })
      } catch (e2) {
        console.error('[stripe-checkout] el reintento también falló', { userId: user.id, error: e2 instanceof Error ? e2.message : String(e2) })
        return json(502, { error: 'stripe_error' })
      }
    }
    console.error('[stripe-checkout] Stripe rechazó la sesión', { userId: user.id, error: e instanceof Error ? e.message : String(e) })
    return json(502, { error: 'stripe_error' })
  }
})
