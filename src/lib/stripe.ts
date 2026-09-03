export const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY

// Price IDs from Stripe dashboard → Products → [product] → Prices.
// Enterprise has no self-serve checkout — sales-led, invoiced manually.
export const STRIPE_PRICES = {
  pro_monthly:  'price_1TJmwsJarRYFmNbKh7G6JXnF',  // $20/mo
  pro_annual:   'price_1TbX45JarRYFmNbKXYSBT3Yn',  // $180/yr ($15/mo) — 25% off
  team_monthly: 'price_1TJmyRJarRYFmNbKeiOLrXss',  // $35/mo
  team_annual:  'price_1TbX66JarRYFmNbKqTA1AoEA',  // $312/yr ($26/mo) — 25% off
}

// `pro` sigue en el tipo mientras haya perfiles con ese valor guardado en Supabase. Se
// borra en la Task 7 del corte comercial, después de migrarlos.
export type Plan = 'free' | 'cloud' | 'pro' | 'team' | 'enterprise'
export type BillingCycle = 'monthly' | 'annual'

export interface PlanPricing {
  monthly: number
  annual: number  // per-month equivalent when paid yearly
}

// Source of truth for prices shown in UI and comms. Stripe Price IDs above must
// match these numbers; if you change one, change the other in the dashboard.
export const PLAN_PRICING: Record<'pro' | 'team', PlanPricing> = {
  pro:  { monthly: 20, annual: 15 },
  team: { monthly: 35, annual: 26 },
}

export const ANNUAL_DISCOUNT_PERCENT = 25
export const ENTERPRISE_MIN_SEATS = 4
export const ENTERPRISE_FLOOR_PER_SEAT = 60  // $/seat/mo, annual billing
export const TEAM_MIN_SEATS = 2
export const ENTERPRISE_CONTACT_EMAIL = 'bautista@nestmux.com'

// Enterprise is sales-led: the in-app modal links out to a demo booking instead
// of showing a card.
export const BOOK_DEMO_URL = 'https://calendly.com/matias-nestmux/new-meeting'

/**
 * Lo que un plan habilita. Después del pricing del 2026-09-02 esto describe SÓLO la nube:
 * lo que corre en la máquina del usuario no nos cuesta nada y por lo tanto no se cobra, así
 * que no hay nada local que gatear. Los catorce flags que había acá antes gateaban panes,
 * worktrees, voice, sharing y diff viewer — todo local, todo regalado por la competencia
 * OSS, y cada uno un motivo para que nos comparen y perdamos.
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
  free:       { memoryLocal: true, memoryCloud: false, memoryTeamShare: false, isEnterprise: false },
  cloud:      { memoryLocal: true, memoryCloud: true,  memoryTeamShare: false, isEnterprise: false },
  // Alias heredado de cloud hasta que la Task 6 migre los perfiles.
  pro:        { memoryLocal: true, memoryCloud: true,  memoryTeamShare: false, isEnterprise: false },
  team:       { memoryLocal: true, memoryCloud: true,  memoryTeamShare: true,  isEnterprise: false },
  enterprise: { memoryLocal: true, memoryCloud: true,  memoryTeamShare: true,  isEnterprise: true },
}
