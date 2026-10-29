// Supabase Edge Function — abre el Customer Portal de Stripe (spec 2b-2 §4.3).
// Deploy: supabase functions deploy stripe-portal
// Secrets: STRIPE_SECRET_KEY (el mismo de stripe-checkout).

import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno'
import { jwtDelHeader } from '../_shared/jwt.ts'
import { decidirPortal, decidirPortalTrasError } from './portal.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-11-20.acacia',
  httpClient: Stripe.createFetchHttpClient(),
})

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

  const jwt = jwtDelHeader(req.headers.get('Authorization'))
  if (!jwt) return json(401, { error: 'unauthorized' })
  const { data: auth, error: authError } = await admin.auth.getUser(jwt)
  const user = auth?.user
  if (authError || !user) return json(401, { error: 'unauthorized' })

  const { data: perfil, error } = await admin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle()
  if (error) {
    console.error('[stripe-portal] no se pudo leer el perfil', { userId: user.id, error: error.message })
    return json(500, { error: 'internal_error' })
  }

  const decision = decidirPortal(perfil)
  if (!decision.ok) return json(decision.status, { error: decision.error })

  try {
    const session = await stripe.billingPortal.sessions.create(decision.sesion)
    return json(200, { url: session.url })
  } catch (e) {
    const tras = decidirPortalTrasError(e)
    if (tras.limpiarCliente) {
      // Customer borrado en Stripe: se limpia el id muerto (condicionado, por si el webhook ya lo
      // cambió) y se responde como si nunca hubiera tenido uno. Si el update falla igual se contesta 404.
      console.warn('[stripe-portal] el customer ya no existe en Stripe', { userId: user.id, customer: decision.sesion.customer })
      const { error: limpiarError } = await admin
        .from('profiles')
        .update({ stripe_customer_id: null, updated_at: new Date().toISOString() })
        .eq('id', user.id)
        .eq('stripe_customer_id', decision.sesion.customer)
      if (limpiarError) {
        console.error('[stripe-portal] no se pudo limpiar el customer', { userId: user.id, error: limpiarError.message })
      }
      return json(tras.status, { error: tras.error })
    }
    console.error('[stripe-portal] Stripe rechazó la sesión', { userId: user.id, error: e instanceof Error ? e.message : String(e) })
    return json(tras.status, { error: tras.error })
  }
})
