import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import { limitsFor } from './limits'

export type AuthResult =
  | { ok: true; deviceId: string; userId: string; plan: string }
  | { ok: false; status: 401 | 403; error: string }

/** The service stores only this, never the token (§9.1). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Plans that include cloud sync. Checked server-side because the renderer's own check is a
// release blocker: anything enforced only in the client is not enforced (§9.3).
//
// 'free' is here on purpose: the pricing spec (§4) gives Free 1 project in the cloud — the
// product's central hook, the moment someone opens a second machine and finds the first
// one's memory. What bounds Free isn't this gate, it's the limits already built on top of it
// (1 project, 100 MB, a 15-minute poll interval). Excluding 'free' from this set made that
// free project unreachable and left the whole project cap built for it dead code.
//
// 'cloud' is here for the same reason 'pro' is: it's the plan's actual current name (the
// pro -> cloud rename landed in limits.ts's BY_PLAN table), and a paying Cloud-tier user
// with that literal plan value could not authenticate at all without it.
const CLOUD_PLANS = new Set(['free', 'cloud', 'pro', 'team', 'enterprise'])

export async function authenticate(pool: Pool, header: string | undefined): Promise<AuthResult> {
  const token = (header ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, status: 401, error: 'unauthorized' }

  const { rows } = await pool.query(
    `select d.id as device_id, d.user_id, u.plan,
            (a.user_id is not null) as allowed
       from devices d
       join users u on u.id = d.user_id
       left join allowlist a on a.user_id = d.user_id
      where d.token_hash = $1 and d.revoked_at is null`,
    [hashToken(token)]
  )
  if (rows.length === 0) return { ok: false, status: 401, error: 'unauthorized' }

  const row = rows[0]
  if (!row.allowed) return { ok: false, status: 403, error: 'not_in_beta' }
  if (!CLOUD_PLANS.has(row.plan)) return { ok: false, status: 403, error: 'plan_required' }

  // El orden es por antigüedad: las primeras N máquinas registradas son las que sincronizan.
  // Determinístico, y no le saca la nube a una máquina que ya la tenía porque el usuario
  // registró otra. Las revocadas no ocupan lugar: si lo ocuparan, revocar y volver a
  // registrar dejaría al usuario afuera de su propia cuenta para siempre.
  //
  // Ronda de arreglo 1: created_at por si solo no da un orden total — dos devices con el
  // mismo instante exacto no se cuentan como "mas viejo" uno al otro bajo `<` estricto, y
  // ambos pasaban el gate. Se desempata comparando la tupla (created_at, id): Postgres la
  // compara lexicograficamente, asi que ante un empate de timestamp gana el id menor,
  // siempre el mismo id, en cualquier corrida.
  const { rows: olderRows } = await pool.query(
    `select count(*)::int as n
       from devices
      where user_id = $1
        and revoked_at is null
        and (created_at, id) < (select created_at, id from devices where id = $2)`,
    [row.user_id, row.device_id]
  )
  if (olderRows[0].n >= limitsFor(row.plan).maxDevices) {
    return { ok: false, status: 403, error: 'device_limit_reached' }
  }

  // Best-effort liveness stamp; never let it fail the request.
  pool
    .query('update devices set last_seen_at = now() where id = $1', [row.device_id])
    .catch(() => {})

  return { ok: true, deviceId: row.device_id, userId: row.user_id, plan: row.plan }
}
