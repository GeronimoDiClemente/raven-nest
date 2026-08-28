/**
 * Claves que el contrato tiene permitido serializar en una cuenta.
 *
 * Es una allowlist y no una denylist a propósito: `profiles` guarda
 * `github_token` y `gitlab_token` en texto plano, y el día que alguien sume una
 * columna con un secreto, lo seguro es que no salga por default. Una denylist
 * habría que acordarse de actualizarla.
 */
export const ACCOUNT_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  // Resumen
  'id', 'name', 'plan', 'plan_label', 'status', 'created_at',
  'trial_ends_at', 'voz_suspendida',
  // Ficha
  'meters', 'health', 'flags', 'onboarding',
  // Items de meters / health / onboarding
  'key', 'label', 'unit', 'used', 'quota', 'pct',
  'detail', 'done', 'manual',
  // Datos de facturación que sí se muestran. Sin moneda: Nest cobra sólo en USD.
  'price_id', 'monto_mensual_cents', 'seats',
])

/**
 * Devuelve las claves del árbol que no están permitidas. Array vacío = limpio.
 * Recorre todo el árbol serializado: un secreto tres niveles abajo llega al
 * cliente igual que uno en la raíz.
 */
export function clavesNoPermitidas(
  valor: unknown,
  permitidas: ReadonlySet<string>,
): string[] {
  const encontradas = new Set<string>()

  const visitar = (nodo: unknown): void => {
    if (nodo === null || typeof nodo !== 'object') return
    if (Array.isArray(nodo)) {
      // Los índices de un array no son claves del contrato: se baja y ya.
      for (const item of nodo) visitar(item)
      return
    }
    for (const [clave, hijo] of Object.entries(nodo)) {
      if (!permitidas.has(clave)) encontradas.add(clave)
      visitar(hijo)
    }
  }

  visitar(valor)
  return [...encontradas]
}
