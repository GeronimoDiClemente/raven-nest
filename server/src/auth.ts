import { createHash } from 'node:crypto'
import type { Pool } from 'pg'

export type AuthResult =
  | { ok: true; deviceId: string; userId: string; plan: string }
  | { ok: false; status: 401 | 403; error: string }

/** The service stores only this, never the token (§9.1). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Plans that include cloud sync. Checked server-side because the renderer's own check is a
// release blocker: anything enforced only in the client is not enforced (§9.3).
const CLOUD_PLANS = new Set(['pro', 'team', 'enterprise'])

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

  // Best-effort liveness stamp; never let it fail the request.
  pool
    .query('update devices set last_seen_at = now() where id = $1', [row.device_id])
    .catch(() => {})

  return { ok: true, deviceId: row.device_id, userId: row.user_id, plan: row.plan }
}
