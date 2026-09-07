export const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY

// Price IDs from Stripe dashboard → Products → [product] → Prices.
// Cloud is the only self-serve tier: Teams and Enterprise are sales-led (Book a demo).
//
// EMPTY ON PURPOSE hasta la Task 5 del corte comercial, que crea el precio de $10 en
// Stripe y pega el ID acá. Vacío hace que el checkout se niegue a abrir; poner mientras
// tanto el ID de `pro` cobraría $20 por una card que dice $10.
export const STRIPE_PRICES = {
  cloud_monthly: '',
}

// `pro` sigue en el tipo mientras haya perfiles con ese valor guardado en Supabase. Se
// borra en la Task 7 del corte comercial, después de migrarlos.
export type Plan = 'free' | 'cloud' | 'pro' | 'team' | 'enterprise'

/**
 * El precio del único plan self-serve, y la fuente de verdad del número que se muestra.
 * Tiene que coincidir con el price de Stripe al que apunta `STRIPE_PRICES.cloud_monthly`.
 *
 * No hay precio anual: el corte comercial del 2026-09-02 lo dejó sin definir a propósito,
 * así que el modal no tiene toggle de facturación. Con Free en $0, Cloud mensual y Teams
 * sin precio, no quedaba nada que togglear.
 */
export const CLOUD_MONTHLY_PRICE = 10
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
