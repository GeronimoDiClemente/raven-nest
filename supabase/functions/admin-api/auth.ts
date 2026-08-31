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
 * Compara dos secretos en tiempo constante.
 *
 * `a !== b` corta en el primer byte distinto, asi que el tiempo de respuesta
 * delata cuantos caracteres del token acerto el que llama y permite
 * reconstruirlo de a uno. Aca se recorren siempre los dos hasta el final y las
 * diferencias se acumulan con XOR, incluida la del largo.
 *
 * A mano y sobre bytes UTF-8 en vez de `crypto.subtle.timingSafeEqual`: este
 * modulo corre en Deno (la edge function) y en Node (vitest), y la comparacion
 * no puede depender de una extension que exista solo en uno de los dos.
 */
function igualEnTiempoConstante(a: string, b: string): boolean {
  const codificador = new TextEncoder()
  const ba = codificador.encode(a)
  const bb = codificador.encode(b)
  let dif = ba.length ^ bb.length
  const largo = Math.max(ba.length, bb.length)
  for (let i = 0; i < largo; i++) dif |= (ba[i] ?? 0) ^ (bb[i] ?? 0)
  return dif === 0
}

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
  // El largo se mira aparte y primero: es dato del que llama, no del secreto,
  // y cortar ahi no filtra nada del token del server.
  if (recibido.length < LARGO_MINIMO_TOKEN) return NO_AUTORIZADO
  if (!igualEnTiempoConstante(recibido, tokenEsperado)) return NO_AUTORIZADO

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
