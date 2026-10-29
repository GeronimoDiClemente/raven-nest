// Supabase Edge Function — Stripe webhook handler
// Deploy: supabase functions deploy stripe-webhook
// Set secrets:
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
//   supabase secrets set STRIPE_PRICE_CLOUD_MONTHLY=price_... STRIPE_PRICE_CLOUD_ANNUAL=price_...
//   supabase secrets set PLAN_SYNC_URL=https://<servicio de sync> PLAN_SYNC_SECRET=<mismo que Railway>

import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno'
import { armarPrecioAPlan, decidir, periodoDeCobro, PERIODO_VACIO, suscripcionSigueViva, type EventoStripe } from './eventos.ts'
import { avisarPlan, clasificarAviso, configDeAviso, resolverBaja, type Desenlace } from './aviso-de-plan.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-11-20.acacia',
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

/**
 * Relee el plan que quedó en `profiles` y se lo avisa al servidor de sync (spec 2b-2 §4.4).
 * `reintentar` = el aviso no llegó: el llamador devuelve 500 y Stripe reintenta. Un pago que no
 * llega a la nube no se puede tragar en silencio. `descartar` = el servidor contestó 400 (dato
 * inválido que ningún reintento arregla, ruling P9): queda en el log y el evento sigue.
 */
async function avisarPlanDe(userId: string): Promise<Desenlace> {
  const config = configDeAviso({
    PLAN_SYNC_URL: Deno.env.get('PLAN_SYNC_URL'),
    PLAN_SYNC_SECRET: Deno.env.get('PLAN_SYNC_SECRET'),
  })
  if (!config) {
    console.error('[stripe-webhook] faltan PLAN_SYNC_URL/PLAN_SYNC_SECRET: el plan no llega al servidor de sync', { userId })
    return clasificarAviso(null)
  }
  const { data, error } = await supabase.from('profiles').select('plan').eq('id', userId).maybeSingle()
  if (error || !data) {
    console.error('[stripe-webhook] no se pudo releer el plan para avisar', { userId, error: error?.message ?? 'sin perfil' })
    return 'reintentar'
  }
  const r = await avisarPlan(fetch, config, userId, data.plan, Math.floor(Date.now() / 1000))
  const desenlace = clasificarAviso(r)
  if (!r.ok) {
    const status = 'status' in r ? r.status : undefined
    if (desenlace === 'descartar') {
      console.error('[stripe-webhook] el servidor de sync rechazó el aviso por dato inválido; no se reintenta', {
        user_id: userId, plan: data.plan, status,
      })
    } else {
      console.error('[stripe-webhook] el servidor de sync no tomó el plan', {
        user_id: userId, plan: data.plan, status, motivo: r.motivo,
      })
    }
  }
  return desenlace
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

  // `checkout.session.completed` es el unico evento que no trae el precio:
  // Stripe no expande line_items salvo que se lo pidas. Se resuelve aca, en el
  // shell, para que `decidir` no haga red y siga testeable sin Deno.
  let priceIdDeRespaldo: string | null = null
  // La suscripción ya leída acá se reusa abajo para chequear que siga viva sin pedirla dos veces.
  let suscripcionLeida: Stripe.Subscription | null = null
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    if (session.subscription) {
      try {
        const sub = await stripe.subscriptions.retrieve(session.subscription as string)
        suscripcionLeida = sub
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

  // El mapa se arma por request: un secret seteado después del deploy aplica sin redeploy.
  const preciosDeCloud = {
    STRIPE_PRICE_CLOUD_MONTHLY: Deno.env.get('STRIPE_PRICE_CLOUD_MONTHLY'),
    STRIPE_PRICE_CLOUD_ANNUAL: Deno.env.get('STRIPE_PRICE_CLOUD_ANNUAL'),
  }
  const precioAPlan = armarPrecioAPlan(preciosDeCloud)
  const decision = decidir(event as unknown as EventoStripe, precioAPlan, priceIdDeRespaldo)

  if (decision.tipo === 'activar') {
    // El evento puede ser un reintento viejo (Stripe reintenta días y sin orden cuando el aviso
    // al servidor de sync falla): si la suscripción ya se canceló, activarla la resucitaría en
    // `profiles` y en el servidor, y nada lo corrige después. Se mira su estado de AHORA.
    let estadoActual: string
    let sub: Stripe.Subscription
    try {
      sub = suscripcionLeida?.id === decision.subscriptionId
        ? suscripcionLeida
        : await stripe.subscriptions.retrieve(decision.subscriptionId)
      estadoActual = sub.status
    } catch (e) {
      // Sin saber si vive no se activa ni se descarta: 500 y Stripe reintenta.
      console.error('[stripe-webhook] no se pudo releer la suscripción antes de activar', {
        evento: event.type, subscription: decision.subscriptionId, error: e instanceof Error ? e.message : String(e),
      })
      return new Response('Could not verify subscription', { status: 500 })
    }
    if (!suscripcionSigueViva(estadoActual)) {
      console.log('[stripe-webhook] activación descartada: la suscripción ya no está viva', {
        evento: event.type, userId: decision.userId, subscription: decision.subscriptionId, status: estadoActual,
      })
      return new Response('ok', { status: 200 })
    }
    const { error } = await supabase.from('profiles').upsert({
      id: decision.userId,
      plan: decision.plan,
      stripe_customer_id: decision.customerId,
      stripe_subscription_id: decision.subscriptionId,
      // En API `basil` `current_period_end` pasa a los items de la suscripción: si se sube la
      // apiVersion, hay que leerlo de ahí o este campo queda en null.
      ...periodoDeCobro(sub, preciosDeCloud),
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
    if ((await avisarPlanDe(decision.userId)) === 'reintentar') {
      return new Response('Could not notify sync service', { status: 500 })
    }
  }

  if (decision.tipo === 'bajar_a_free') {
    // Ruling T5a: se baja el plan CONSERVANDO `stripe_subscription_id`, así un reintento de
    // Stripe vuelve a encontrar las filas y vuelve a avisar. `.select('id')`: los usuarios que
    // efectivamente bajaron, para avisar por cada uno.
    const { data: bajados, error } = await supabase
      .from('profiles')
      .update({ plan: 'free', ...PERIODO_VACIO, updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', decision.subscriptionId)
      .select('id')
    if (error) {
      console.error('[stripe-webhook] fallo al bajar el plan a free', {
        subscription: decision.subscriptionId, error: error.message,
      })
      return new Response('Could not downgrade plan', { status: 500 })
    }
    const ids = (bajados ?? []).map((fila) => fila.id as string)
    // Se avisa a todos (no se corta en el primer fallo): los que llegan, llegan ya.
    const desenlaces: Desenlace[] = []
    for (const id of ids) desenlaces.push(await avisarPlanDe(id))
    const { limpiar, status } = resolverBaja(desenlaces)
    if (status === 500) {
      return new Response('Could not notify sync service', { status: 500 })
    }
    if (limpiar) {
      // El `.eq` de la suscripción evita pisar una suscripción NUEVA que el usuario haya
      // sacado entre el update y este paso.
      const { error: errorAlLimpiar } = await supabase
        .from('profiles')
        .update({ stripe_subscription_id: null, updated_at: new Date().toISOString() })
        .in('id', ids)
        .eq('stripe_subscription_id', decision.subscriptionId)
      if (errorAlLimpiar) {
        console.error('[stripe-webhook] fallo al limpiar la suscripción después de bajar a free', {
          subscription: decision.subscriptionId, error: errorAlLimpiar.message,
        })
        return new Response('Could not downgrade plan', { status: 500 })
      }
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
