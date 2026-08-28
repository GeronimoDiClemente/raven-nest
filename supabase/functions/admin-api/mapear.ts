import { esSubViva, montoMensualCents, planLabel, trialEndsAt, type SubResumen } from './pricing.ts'
import type { AccountDetail, AccountSummary, HealthItem, Meter } from './tipos.ts'

export interface UsuarioAuth {
  id: string
  email: string | null
  created_at: string
}

export interface PerfilFila {
  plan: string | null
  stripe_customer_id: string | null
  trial_started_at: string | null
}

export interface DatosFicha {
  repos: number
  teams: number
  seats: number
  /** true = no se pudo hablar con Stripe. Distinto de "no tiene suscripción". */
  stripeCaido: boolean
}

function medidor(key: string, label: string, unit: string, used: number): Meter {
  // Ningún meter de Nest tiene cupo hoy: `quota: null` y `pct: 0` es lo honesto.
  // Un pct inventado se dibuja como barra llena en la ficha.
  return { key, label, unit, used, quota: null, pct: 0 }
}

export function aAccountSummary(
  u: UsuarioAuth,
  p: PerfilFila | null,
  sub: SubResumen | null,
  /**
   * `user_last_activity.last_refresh_at`. Va aparte porque no sale de
   * `profiles` sino de una vista, y `null` cuando la cuenta nunca refrescó o
   * cuando la vista no se pudo leer: en las dos "no sabemos", que es lo
   * honesto para una columna de último uso.
   */
  lastActivityAt: string | null = null,
): AccountSummary {
  const plan = p?.plan ?? 'free'
  return {
    id: u.id,
    // Sin email la fila quedaría en blanco y no habría cómo identificarla.
    name: u.email ?? `(sin email · ${u.id})`,
    plan,
    plan_label: planLabel(plan, sub),
    status: sub?.status ?? 'sin_suscripcion',
    created_at: u.created_at ?? null,
    trial_ends_at: trialEndsAt(p?.trial_started_at ?? null),
    // El dato con el que se calculan DAU/WAU/MAU y con el que se compara la
    // paridad contra raven-admin antes de apagarlo (Task 10 del plan).
    last_activity_at: lastActivityAt,
    // Concepto de AiraMed que el core exige. Nest no tiene voz.
    voz_suspendida: false,
  }
}

function saludSuscripcion(
  p: PerfilFila | null,
  sub: SubResumen | null,
  stripeCaido: boolean,
): HealthItem {
  const base = { key: 'suscripcion', label: 'Suscripción' }
  if (stripeCaido) {
    return {
      ...base, status: 'parcial',
      detail: 'Stripe no responde: el dato de cobro no esta disponible',
    }
  }
  const plan = p?.plan ?? 'free'
  // Un plan de pago sin customer es el síntoma del webhook caído: se muestra,
  // no se esconde. Free sin suscripción es lo normal.
  if (plan !== 'free' && !p?.stripe_customer_id) {
    return {
      ...base, status: 'sin_configurar',
      detail: `Plan ${plan} asignado sin suscripcion de Stripe`,
    }
  }
  // Una suscripción que existe pero no está viva (`past_due`, `unpaid`,
  // `canceled`, `paused`…) no es `ok`: es exactamente la cuenta sobre la que
  // hay que actuar. Se emite `suspendido` y no `parcial` porque `parcial` ya
  // significa otra cosa en este mismo campo — "no pudimos leer el dato" — y
  // acá el dato se leyó perfecto: dice que el cobro está frenado.
  if (sub && !esSubViva(sub)) {
    return {
      ...base, status: 'suspendido',
      detail: `Suscripcion en estado ${sub.status}: no se esta cobrando`,
    }
  }
  return { ...base, status: 'ok', detail: sub ? null : 'Sin suscripcion activa' }
}

export function aAccountDetail(
  u: UsuarioAuth,
  p: PerfilFila | null,
  sub: SubResumen | null,
  extra: DatosFicha,
  lastActivityAt: string | null = null,
): AccountDetail {
  return {
    ...aAccountSummary(u, p, sub, lastActivityAt),
    meters: [
      // Con Stripe caído el meter `seats` **se omite**, no se manda en cero:
      // el campo `seats` de más abajo es `null` en ese caso y una UI genérica
      // dibujaría "Seats 0" al lado de un null, contradiciéndose sola. No se
      // hace `used` nullable porque el zod del core lo exige `number` y un
      // null le rompería el parseo de la ficha entera.
      ...(extra.stripeCaido ? [] : [medidor('seats', 'Seats', 'seats', extra.seats)]),
      medidor('repos', 'Repos conectados', 'repos', extra.repos),
      medidor('teams', 'Equipos', 'equipos', extra.teams),
    ],
    health: [saludSuscripcion(p, sub, extra.stripeCaido)],
    flags: {},
    onboarding: [],
    // El price_id es lo único que distingue a un suscriptor en un precio
    // legacy (hay dos anuales al 15% off) de uno en el precio actual.
    price_id: sub?.price_id ?? null,
    // Con Stripe caído, `null` en vez de `0`: cero es un monto válido y acá
    // mentiría. Con Stripe sano y sin suscripción, `0` sí es la verdad.
    monto_mensual_cents: extra.stripeCaido ? null : montoMensualCents(sub),
    seats: extra.stripeCaido ? null : extra.seats,
  }
}
