// `pro` sigue en el tipo mientras haya perfiles con ese valor guardado en Supabase. Se
// borra después de migrarlos.
export type Plan = 'free' | 'cloud' | 'pro' | 'team' | 'enterprise'

/**
 * Los precios de Cloud, la fuente de verdad de los números que se muestran.
 * Los IDs de precio de Stripe NO viven en la app: los elige `stripe-checkout` desde sus
 * secrets según el intervalo, así un cliente no puede pedir un precio arbitrario.
 */
export const CLOUD_MONTHLY_PRICE = 10
/** Anual: US$ 96 por año, que se muestra como US$ 8 por mes. */
export const CLOUD_ANNUAL_MONTHLY_PRICE = 8
export const CLOUD_ANNUAL_PRICE = 96

export type BillingInterval = 'monthly' | 'annual'

/** Si el plan tiene una suscripción de Stripe propia que gestionar desde el portal. */
export function tieneSuscripcionPropia(plan: string): boolean {
  return plan === 'cloud' || plan === 'pro'
}
export const TEAM_MIN_SEATS = 2

// Enterprise is sales-led: the in-app modal links out to a demo booking instead
// of showing a card.
export const BOOK_DEMO_URL = 'https://calendly.com/matias-nestmux/new-meeting'

/**
 * Lo que un plan habilita. Describe SÓLO la nube: lo que corre en la máquina del usuario no
 * nos cuesta nada y por lo tanto no se cobra, así que no hay nada local que gatear. Panes,
 * worktrees, voice, sharing o diff viewer son locales y la competencia OSS los regala:
 * gatearlos es un motivo para que nos comparen y perdamos.
 *
 * Los límites numéricos de nube (proyectos, bytes) NO viven acá: los hace cumplir el
 * servidor y el cliente los lee de `GET /v1/sync/status`.
 */
export interface PlanLimits {
  /** Siempre true, en todos los planes. Está explícito porque es la promesa del producto. */
  memoryLocal: boolean
  /** Si la memoria se aloja en nuestra nube y se replica entre máquinas. */
  memoryCloud: boolean
  /** Sólo Teams: promover una memoria a `scope: 'team'`, visible para el resto del equipo. */
  memoryTeamShare: boolean
  /** Meta: si el plan es la punta de Teams (SSO, instancia dedicada, SLA). */
  isEnterprise: boolean
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  // Free conecta la nube con UN proyecto. El tope lo aplica el servidor
  // (server/src/limits.ts, `project_limit_reached`); acá sólo se dice si se ofrece Connect.
  free:       { memoryLocal: true, memoryCloud: true,  memoryTeamShare: false, isEnterprise: false },
  cloud:      { memoryLocal: true, memoryCloud: true,  memoryTeamShare: false, isEnterprise: false },
  // Alias heredado de cloud hasta migrar los perfiles.
  pro:        { memoryLocal: true, memoryCloud: true,  memoryTeamShare: false, isEnterprise: false },
  team:       { memoryLocal: true, memoryCloud: true,  memoryTeamShare: true,  isEnterprise: false },
  enterprise: { memoryLocal: true, memoryCloud: true,  memoryTeamShare: true,  isEnterprise: true },
}

/**
 * Si el plan ofrece conectar la nube. Un plan que esta versión no conoce, no: es el único caso
 * que queda para «cloud sync is a Cloud feature». Sin esto,
 * `PLAN_LIMITS[plan].memoryCloud` con un plan desconocido rompería el render.
 */
export function planIncluyeNube(plan: string): boolean {
  return (PLAN_LIMITS as Record<string, PlanLimits | undefined>)[plan]?.memoryCloud === true
}
