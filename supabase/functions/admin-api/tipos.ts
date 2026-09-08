export interface Manifest {
  product: string
  account_label: { singular: string; plural: string }
  capabilities: string[]
  flags: { key: string; label: string; default: boolean; staff_only: boolean }[]
  usage_meters: { key: string; label: string; unit: string }[]
  sections: { key: string; label: string; module: string }[]
}

export interface Meter {
  key: string
  label: string
  unit: string
  used: number
  quota: number | null
  pct: number
}

export type EstadoSalud = 'ok' | 'parcial' | 'sin_configurar' | 'suspendido'

export interface HealthItem {
  key: string
  label: string
  status: EstadoSalud
  detail: string | null
}

export interface OnboardingItem {
  key: string
  label: string
  done: boolean
  manual: boolean
  detail: string | null
}

export interface AccountSummary {
  id: string
  name: string
  plan: string
  plan_label: string
  status: string
  created_at: string | null
  trial_ends_at: string | null
  /**
   * `user_last_activity.last_refresh_at`: el último uso real de la cuenta.
   *
   * Es la fuente de DAU/WAU/MAU y el dato con el que la Task 10 del plan manda
   * comparar cuenta por cuenta contra raven-admin antes de apagarlo — sin este
   * campo ese gate no se puede cumplir. `null` cuando la cuenta nunca refrescó
   * o cuando la vista no se pudo leer.
   *
   * Campo extra igual que `price_id`: el core del back-office parsea sin
   * `.strict()`, así que no le rompe nada.
   */
  last_activity_at: string | null
}

export interface AccountDetail extends AccountSummary {
  meters: Meter[]
  health: HealthItem[]
  flags: Record<string, boolean>
  onboarding: OnboardingItem[]
  /**
   * Facturación. El core del back-office parsea con zod sin `.strict()`, así
   * que ignora estos campos; los dibuja el módulo `products/nest`. Están acá
   * porque la paridad con raven-admin incluye ver cuánto paga cada cuenta.
   *
   * `monto_mensual_cents` y `seats` son `null` cuando Stripe está caído: cero
   * es un monto válido y mentiría en la pantalla donde se decide sobre una
   * cuenta. Con Stripe sano y sin suscripción siguen siendo `0`, que ahí sí
   * es la verdad.
   */
  price_id: string | null
  monto_mensual_cents: number | null
  seats: number | null
}
