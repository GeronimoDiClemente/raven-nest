// Spec 2b-2 §4.8: el plan lo cambia el webhook de Stripe en `profiles` y la app lo ve al
// recuperar el foco (useProfile). Acá se decide qué hacer con ese cambio.

/** Los planes que se cobran. Misma lista que `PLANES_PAGOS` del servidor y del checkout. */
export function esPlanPago(plan: string): boolean {
  return plan === 'cloud' || plan === 'pro' || plan === 'team' || plan === 'enterprise'
}

export type CambioDePlan = 'activado' | 'bajado' | null

/**
 * `activado` = de un no-pago a `cloud` (toast + status nuevo). `bajado` = de un pago a uno que
 * no lo es (status nuevo, sin toast). `antes === null` es la primera lectura: no es un cambio
 * (Review Focus 1: abrir la app con una cuenta que ya es Cloud no la "activa").
 *
 * Ruling P3: se compara el plan CRUDO de `profiles`, no el efectivo: durante el trial el
 * efectivo es `team` y taparía el paso de free a cloud.
 */
export function cambioDePlan(antes: string | null, ahora: string): CambioDePlan {
  if (antes === null || antes === ahora) return null
  if (!esPlanPago(antes) && ahora === 'cloud') return 'activado'
  if (esPlanPago(antes) && !esPlanPago(ahora)) return 'bajado'
  return null
}
