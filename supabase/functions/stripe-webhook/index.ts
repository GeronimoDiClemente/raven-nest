// Supabase Edge Function — Stripe webhook handler
// Deploy: supabase functions deploy stripe-webhook
// Set secrets:
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...

import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno'
import { decidir, type EventoStripe } from './eventos.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-11-20.acacia',
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch {
    return new Response('Webhook signature invalid', { status: 400 })
  }

  // `checkout.session.completed` es el unico evento que no trae el precio:
  // Stripe no expande line_items salvo que se lo pidas. Se resuelve aca, en el
  // shell, para que `decidir` no haga red y siga testeable sin Deno.
  let priceIdDeRespaldo: string | null = null
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    if (session.subscription) {
      try {
        const sub = await stripe.subscriptions.retrieve(session.subscription as string)
        priceIdDeRespaldo = sub.items.data[0]?.price.id ?? null
      } catch (e) {
        // Sin precio no se adivina el plan: `invoice.paid` va a llegar despues
        // con el precio adentro y reactiva la cuenta.
        console.error('[stripe-webhook] no se pudo resolver el precio de la suscripcion', {
          subscription: session.subscription, error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  const decision = decidir(event as unknown as EventoStripe, priceIdDeRespaldo)

  if (decision.tipo === 'activar') {
    const { error } = await supabase.from('profiles').upsert({
      id: decision.userId,
      plan: decision.plan,
      stripe_customer_id: decision.customerId,
      stripe_subscription_id: decision.subscriptionId,
      updated_at: new Date().toISOString(),
    })
    if (error) {
      // 500 a proposito: Stripe reintenta. Tragarse el error aca es
      // exactamente como se pierde un pago sin que nadie se entere.
      console.error('[stripe-webhook] fallo al activar el plan', {
        evento: event.type, userId: decision.userId, plan: decision.plan, error: error.message,
      })
      return new Response('Could not apply plan', { status: 500 })
    }
    console.log('[stripe-webhook] plan activado', {
      evento: event.type, userId: decision.userId, plan: decision.plan,
    })
  }

  if (decision.tipo === 'bajar_a_free') {
    const { error } = await supabase
      .from('profiles')
      .update({ plan: 'free', stripe_subscription_id: null, updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', decision.subscriptionId)
    if (error) {
      console.error('[stripe-webhook] fallo al bajar el plan a free', {
        subscription: decision.subscriptionId, error: error.message,
      })
      return new Response('Could not downgrade plan', { status: 500 })
    }
  }

  // Un evento ignorado se loguea y devuelve 200: si devolviera error, Stripe
  // reintentaria durante dias un evento que nunca vamos a querer procesar. El
  // log es lo que hace visible un precio nuevo sin mapear.
  if (decision.tipo === 'ignorar') {
    console.log('[stripe-webhook] evento ignorado', { evento: event.type, motivo: decision.motivo })
  }

  return new Response('ok', { status: 200 })
})
