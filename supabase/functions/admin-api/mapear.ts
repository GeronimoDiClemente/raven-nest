import { montoMensualCents, planLabel, trialEndsAt, type SubResumen } from './pricing.ts'
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
  return { ...base, status: 'ok', detail: sub ? null : 'Sin suscripcion activa' }
}

export function aAccountDetail(
  u: UsuarioAuth,
  p: PerfilFila | null,
  sub: SubResumen | null,
  extra: DatosFicha,
): AccountDetail {
  return {
    ...aAccountSummary(u, p, sub),
    meters: [
      medidor('seats', 'Seats', 'seats', extra.seats),
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
