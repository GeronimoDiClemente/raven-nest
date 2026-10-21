import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'
import { CLOUD_PLANS } from './auth'
import { UUID_RE } from './uuid'

/**
 * Spec 2b-2 §4.5: el webhook de Stripe le avisa a este servicio qué plan quedó en
 * `profiles`. Hasta acá lo único que escribía `users.plan` era `mint-device-token.mjs`: un
 * pago no llegaba nunca a la nube.
 *
 * La firma es la de Stripe en chico: `X-Nest-Signature: t=<unix seg>,v1=<hex>` con
 * `v1 = HMAC-SHA256(PLAN_SYNC_SECRET, "<t>.<cuerpo crudo>")`.
 */
export const VENTANA_DE_FIRMA_SEG = 300

/** Los planes que se cobran: pagar te mete en la allowlist de la beta (decisión 5). */
export const PLANES_PAGOS: ReadonlySet<string> = new Set(['cloud', 'pro', 'team', 'enterprise'])

/**
 * ¿La cabecera firma ESTE cuerpo crudo, con este secreto, hace menos de 5 minutos?
 *
 * Sobre el cuerpo CRUDO a propósito: re-serializar el JSON parseado cambia espacios y orden de
 * claves, y rechazaría avisos legítimos. Nunca lanza.
 */
export function verificarFirmaDePlan(
  cabecera: string | undefined,
  cuerpo: string,
  secreto: string,
  ahoraSeg: number,
): boolean {
  if (!secreto || !cabecera) return false
  const partes = new Map<string, string>()
  for (const parte of cabecera.split(',')) {
    const i = parte.indexOf('=')
    if (i > 0) partes.set(parte.slice(0, i).trim(), parte.slice(i + 1).trim())
  }
  const tCrudo = partes.get('t') ?? ''
  const v1 = partes.get('v1') ?? ''
  if (!/^\d+$/.test(tCrudo) || !/^[0-9a-f]{64}$/i.test(v1)) return false
  const t = Number(tCrudo)
  if (Math.abs(ahoraSeg - t) > VENTANA_DE_FIRMA_SEG) return false

  const esperada = createHmac('sha256', secreto).update(`${tCrudo}.${cuerpo}`).digest()
  const recibida = Buffer.from(v1, 'hex')
  // Mismo largo garantizado por la regex (64 hex = 32 bytes); igual se chequea antes de
  // `timingSafeEqual`, que tira con largos distintos.
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada)
}

export type AvisoDePlan = { userId: string; plan: string }

export function leerAvisoDePlan(
  cuerpo: string,
): { ok: true; aviso: AvisoDePlan } | { ok: false; error: 'bad_json' | 'invalid_user_id' | 'invalid_plan' } {
  let parsed: unknown
  try {
    parsed = JSON.parse(cuerpo)
  } catch {
    return { ok: false, error: 'bad_json' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'bad_json' }
  const { user_id: userId, plan } = parsed as { user_id?: unknown; plan?: unknown }
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) return { ok: false, error: 'invalid_user_id' }
  // Nunca un plan que `authenticate` no conoce: quedaría como `plan_required` para siempre.
  if (typeof plan !== 'string' || !CLOUD_PLANS.has(plan)) return { ok: false, error: 'invalid_plan' }
  return { ok: true, aviso: { userId, plan } }
}

/**
 * Aplica el aviso. Idempotente: el mismo aviso dos veces deja lo mismo. El usuario que todavía
 * no registró ninguna máquina queda creado, así su primer registro ya lo encuentra pago.
 * Bajar a `free` NO lo saca de la allowlist (decisión 5: al cancelar se queda).
 */
export async function aplicarPlan(pool: Pool, aviso: AvisoDePlan): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      `insert into users (id, plan) values ($1, $2)
       on conflict (id) do update set plan = excluded.plan`,
      [aviso.userId, aviso.plan],
    )
    if (PLANES_PAGOS.has(aviso.plan)) {
      await client.query('insert into allowlist (user_id) values ($1) on conflict do nothing', [aviso.userId])
    }
    await client.query('commit')
  } catch (err) {
    await client.query('rollback').catch(() => { /* la conexión ya puede estar rota */ })
    throw err
  } finally {
    client.release()
  }
}
