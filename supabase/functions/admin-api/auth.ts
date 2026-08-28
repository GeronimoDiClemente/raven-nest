/** Mínimo que exige el contrato del back-office. */
export const LARGO_MINIMO_TOKEN = 32

export interface Actor {
  id: string
  email: string | null
  motivo: string | null
}

export type ResultadoAuth =
  | { ok: true; actor: Actor }
  | { ok: false; status: number; error: string }

/**
 * Guard de toda llamada del back-office.
 *
 * Fail-closed a propósito: sin token configurado en el server, o con uno más
 * corto que el mínimo del contrato, se rechaza aunque el header coincida. Un
 * token corto que "funciona" es peor que uno que no está, porque nadie lo mira.
 */
export function verificarAuth(
  headers: Headers,
  tokenEsperado: string | undefined,
  esEscritura: boolean,
): ResultadoAuth {
  const NO_AUTORIZADO = { ok: false, status: 401, error: 'No autorizado' } as const

  if (!tokenEsperado || tokenEsperado.length < LARGO_MINIMO_TOKEN) return NO_AUTORIZADO

  const recibido = headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (recibido.length < LARGO_MINIMO_TOKEN || recibido !== tokenEsperado) return NO_AUTORIZADO

  // El actor se exige también en lecturas: sin actor no hay auditoría, y una
  // lectura de la ficha de una cuenta es información que alguien miró.
  const id = headers.get('x-admin-actor')?.trim()
  if (!id) return { ok: false, status: 400, error: 'Falta X-Admin-Actor' }

  const motivo = headers.get('x-admin-motivo')?.trim() || null
  if (esEscritura && !motivo) return { ok: false, status: 400, error: 'Falta X-Admin-Motivo' }

  return {
    ok: true,
    actor: { id, email: headers.get('x-admin-actor-email')?.trim() || null, motivo },
  }
}
