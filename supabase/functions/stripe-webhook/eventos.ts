/**
 * Decide que hacer con un evento de Stripe. Modulo puro: sin SDK, sin red y
 * sin cliente de Supabase, para que se pueda testear con vitest en Node igual
 * que los modulos de `admin-api`. El shell (`index.ts`) valida la firma y
 * ejecuta la decision.
 */

/**
 * Los precios viejos de Pro/Team, fijos en el código como siempre. Los de Cloud NO van acá:
 * viven en los secrets de la función (spec 2b-2 §4.1) y se suman con `armarPrecioAPlan`.
 */
export const PRECIOS_LEGACY: Readonly<Record<string, string>> = {
  price_1TJmwsJarRYFmNbKh7G6JXnF: 'pro',   // pro mensual $20
  price_1TJmy8JarRYFmNbKeScj4mwX: 'pro',   // pro anual $204 (legacy 15% off)
  price_1TbX45JarRYFmNbKXYSBT3Yn: 'pro',   // pro anual $180 (actual 25% off)
  price_1TJmyRJarRYFmNbKeiOLrXss: 'team',  // team mensual $35
  price_1TJmyyJarRYFmNbKq9mRgrdz: 'team',  // team anual $348 (legacy 15% off)
  price_1TbX66JarRYFmNbKqTA1AoEA: 'team',  // team anual $312 (actual 25% off)
}

export interface PreciosDeCloudEnv {
  STRIPE_PRICE_CLOUD_MONTHLY?: string
  STRIPE_PRICE_CLOUD_ANNUAL?: string
}

/**
 * Price ID de Stripe -> plan de Nest: los legacy más los dos de Cloud (spec 2b-2 §4.4).
 *
 * Un secret vacío no mapea nada: `''` como clave haría "activar" un evento sin precio. Y un
 * secret no pisa un precio legacy: un copy-paste equivocado en el dashboard le daría Cloud a
 * quien compró Team.
 */
export function armarPrecioAPlan(env: PreciosDeCloudEnv): Record<string, string> {
  const mapa: Record<string, string> = { ...PRECIOS_LEGACY }
  for (const precio of [env.STRIPE_PRICE_CLOUD_MONTHLY, env.STRIPE_PRICE_CLOUD_ANNUAL]) {
    const id = precio?.trim()
    if (id && !(id in mapa)) mapa[id] = 'cloud'
  }
  return mapa
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

/** `hasOwn` y no `in`: `'toString' in mapa` es true y daría un "plan" que no existe. */
function planDePrecio(precioAPlan: Readonly<Record<string, string>>, precio: string | undefined): string | undefined {
  return precio && Object.prototype.hasOwnProperty.call(precioAPlan, precio) ? precioAPlan[precio] : undefined
}

/** Un campo expandible de Stripe llega como id (string) o, expandido, como objeto con `id`. */
function idDe(valor: unknown): string | undefined {
  if (typeof valor === 'string') return valor || undefined
  if (valor && typeof valor === 'object') {
    const id = (valor as { id?: unknown }).id
    if (typeof id === 'string' && id) return id
  }
  return undefined
}

/**
 * Precio de una línea de factura en las dos formas de la API: `pricing.price_details.price`
 * desde `2025-03-31.basil` (la cuenta está en `dahlia`), `price.id` hasta `acacia`.
 */
function precioDeLinea(linea: any): string | undefined {
  return idDe(linea?.pricing?.price_details?.price) ?? idDe(linea?.price)
}

/**
 * El precio que gobierna una factura. Los prorrateos van PRIMERO en `lines` (Stripe ordena
 * pendientes antes que items de la suscripción), así que la línea 0 de un cambio de tier puede
 * ser el crédito del precio viejo: se prefiere una línea con precio conocido.
 */
function precioDeFactura(o: any, precioAPlan: Readonly<Record<string, string>>): string | undefined {
  const lineas: unknown[] = Array.isArray(o.lines?.data) ? o.lines.data : []
  const precios = lineas.map(precioDeLinea).filter((p): p is string => !!p)
  return precios.find((p) => planDePrecio(precioAPlan, p)) ?? precios[0]
}

interface DatosActivacion {
  userId?: string
  priceId?: string
  customerId?: string
  subscriptionId?: string
}

/**
 * Arma la decision de activar, o explica por que no se puede.
 *
 * **No adivina el plan.** Un precio que no esta en el mapa es un
 * deploy a medias —se agrego en Stripe y no en el codigo—, y el `?? 'pro'`
 * que habia antes le daba Pro a alguien que compro Team, dejando la cuenta
 * como `ok` en el back-office: un cobro mal provisionado e invisible. Sin
 * plan, la cuenta sale `sin_configurar` y alguien la ve.
 */
function activar(d: DatosActivacion, precioAPlan: Readonly<Record<string, string>>): Decision {
  if (!d.userId) return ignorar('sin user_id en la metadata')
  if (!d.customerId || !d.subscriptionId) return ignorar('sin customer o subscription')
  const plan = planDePrecio(precioAPlan, d.priceId)
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
export function decidir(
  evento: EventoStripe,
  precioAPlan: Readonly<Record<string, string>>,
  priceIdDeRespaldo: string | null = null,
): Decision {
  const o = evento.data.object as Record<string, any>

  // El cobro real (el del dia 14, y cada renovacion). Tambien es la red de
  // seguridad del checkout: si aquel evento se perdio, este reactiva el plan.
  //
  // Desde `basil` la suscripción y su metadata viven en `parent.subscription_details`; hasta
  // `acacia`, en `subscription` y `subscription_details`. La versión la fija el endpoint de
  // webhook, no el SDK, así que se aceptan las dos.
  if (evento.type === 'invoice.paid') {
    const padre = o.parent?.subscription_details
    return activar({
      userId: padre?.metadata?.user_id ?? o.subscription_details?.metadata?.user_id,
      priceId: precioDeFactura(o, precioAPlan),
      customerId: idDe(o.customer),
      subscriptionId: idDe(padre?.subscription) ?? idDe(o.subscription),
    }, precioAPlan)
  }

  if (evento.type === 'checkout.session.completed') {
    return activar({
      userId: o.metadata?.user_id,
      priceId: priceIdDeRespaldo ?? undefined,
      customerId: idDe(o.customer),
      subscriptionId: idDe(o.subscription),
    }, precioAPlan)
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
      priceId: idDe(o.items?.data?.[0]?.price),
      customerId: idDe(o.customer),
      subscriptionId: o.id,
    }, precioAPlan)
  }

  if (evento.type === 'customer.subscription.deleted') {
    if (!o.id) return ignorar('sin id de suscripcion')
    return { tipo: 'bajar_a_free', subscriptionId: o.id }
  }

  return ignorar(`evento no manejado: ${evento.type}`)
}

/**
 * Antes de activar, el shell relee la suscripción contra Stripe y le pasa el `status` actual.
 *
 * Por qué: un aviso al servidor de sync que falla devuelve 500, y Stripe reintenta durante días
 * y sin orden. Si en el medio llegó `customer.subscription.deleted`, un `invoice.paid` o un
 * `subscription.updated` viejo reintentado reescribiría `plan` y la suscripción vieja en
 * `profiles` y en el servidor, y nada lo corregiría nunca. El evento trae el estado de cuando
 * se emitió; esto mira el de ahora.
 *
 * `past_due` cuenta como viva (a diferencia de `VIVAS`): es Stripe reintentando el cobro y el
 * plan no se baja por eso. `canceled`, `unpaid`, `incomplete` e `incomplete_expired` no activan.
 */
const SIGUEN_VIVAS = ['active', 'trialing', 'past_due']

export function suscripcionSigueViva(status: string | null | undefined): boolean {
  return typeof status === 'string' && SIGUEN_VIVAS.includes(status)
}

export interface PeriodoDeCobro {
  billing_interval: 'monthly' | 'annual' | null
  current_period_end: string | null
  cancel_at_period_end: boolean
}

/** Sin suscripción: lo que queda en `profiles` al bajar a free. */
export const PERIODO_VACIO: PeriodoDeCobro = {
  billing_interval: null,
  current_period_end: null,
  cancel_at_period_end: false,
}

/**
 * Intervalo, fin del período y cancelación de una suscripción, para `profiles` (spec 2b-3).
 *
 * El intervalo sale del precio contra los secrets de Cloud, trimeados como en `armarPrecioAPlan`;
 * un precio legacy (o un secret vacío) da `null`. `current_period_end` viene en segundos: arriba
 * de la suscripción hasta `acacia`, en cada item desde `basil`.
 */
export function periodoDeCobro(sub: SuscripcionLeida, env: PreciosDeCloudEnv): PeriodoDeCobro {
  const item = sub.items?.data?.[0]
  const precio = idDe(item?.price)
  const mensual = env.STRIPE_PRICE_CLOUD_MONTHLY?.trim()
  const anual = env.STRIPE_PRICE_CLOUD_ANNUAL?.trim()
  const billing_interval = precio && precio === anual ? 'annual' : precio && precio === mensual ? 'monthly' : null
  const fin = sub.current_period_end ?? item?.current_period_end
  return {
    billing_interval,
    current_period_end: typeof fin === 'number' ? new Date(fin * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end === true,
  }
}

/** Lo que el shell lee de la suscripción releída con `subscriptions.retrieve`. */
export interface SuscripcionLeida {
  status?: string | null
  items?: { data?: Array<{ price?: { id?: string } | string | null; current_period_end?: number | null }> }
  current_period_end?: number | null
  cancel_at_period_end?: boolean | null
}

export type Activacion =
  | {
      tipo: 'aplicar'
      fila: {
        id: string
        plan: string
        stripe_customer_id: string
        stripe_subscription_id: string
      } & PeriodoDeCobro
    }
  | { tipo: 'descartar'; motivo: string }

/**
 * Cierra una decisión de activar contra la suscripción releída: lo que se escribe en `profiles`.
 *
 * El plan sale del precio de la suscripción de AHORA, no del evento, igual que el período: un
 * `subscription.updated` o `invoice.paid` viejo reintentado después de un cambio de tier
 * escribiría el plan anterior con el período nuevo. Un precio que la suscripción ya no tiene en
 * el mapa no se adivina (mismo criterio que `activar`).
 */
export function resolverActivacion(
  decision: Extract<Decision, { tipo: 'activar' }>,
  sub: SuscripcionLeida,
  precioAPlan: Readonly<Record<string, string>>,
  env: PreciosDeCloudEnv,
): Activacion {
  if (!suscripcionSigueViva(sub.status)) {
    return { tipo: 'descartar', motivo: `la suscripción ya no está viva (${sub.status ?? 'sin status'})` }
  }
  const precio = idDe(sub.items?.data?.[0]?.price)
  const plan = planDePrecio(precioAPlan, precio)
  if (!plan) return { tipo: 'descartar', motivo: `precio desconocido en la suscripción: ${precio ?? 'ninguno'}` }
  return {
    tipo: 'aplicar',
    fila: {
      id: decision.userId,
      plan,
      stripe_customer_id: decision.customerId,
      stripe_subscription_id: decision.subscriptionId,
      ...periodoDeCobro(sub, env),
    },
  }
}
