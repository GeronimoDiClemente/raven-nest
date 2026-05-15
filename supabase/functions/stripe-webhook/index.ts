// Supabase Edge Function — Stripe webhook handler
// Deploy: supabase functions deploy stripe-webhook
// Set secrets:
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...

import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-11-20.acacia',
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Maps Stripe Price ID → plan name
const PRICE_TO_PLAN: Record<string, string> = {
  'price_1TJmwsJarRYFmNbKh7G6JXnF': 'pro',
  'price_1TJmy8JarRYFmNbKeScj4mwX': 'pro',
  'price_1TJmyRJarRYFmNbKeiOLrXss': 'team',
  'price_1TJmyyJarRYFmNbKq9mRgrdz': 'team',
}

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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId = session.metadata?.user_id
    // Stripe does NOT include line_items in checkout.session.completed unless
    // explicitly expanded. Pull the priceId from the subscription instead so
    // a Team purchase doesn't silently downgrade to Pro.
    let priceId = ''
    if (session.subscription) {
      const sub = await stripe.subscriptions.retrieve(session.subscription as string)
      priceId = sub.items.data[0]?.price.id ?? ''
    }
    const plan = PRICE_TO_PLAN[priceId] ?? 'pro'

    if (userId) {
      await supabase.from('profiles').upsert({
        id: userId,
        plan,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
        updated_at: new Date().toISOString(),
      })
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    await supabase
      .from('profiles')
      .update({ plan: 'free', stripe_subscription_id: null, updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', sub.id)
  }

  return new Response('ok', { status: 200 })
})
