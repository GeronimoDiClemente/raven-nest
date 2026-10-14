import type { Pool } from 'pg'

export interface TeamKeysAuth {
  deviceId: string
  userId: string
}

/** Único chequeo de rol que usan activate/authorize/recrypt — nunca inferido del client. */
export async function isTeamLeader(pool: Pool, userId: string, teamId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1 from team_memberships
      where user_id = $1 and team_id = $2 and role = 'leader' and status = 'active'`,
    [userId, teamId]
  )
  return rows.length > 0
}

async function esMiembroActivo(pool: Pool, userId: string, teamId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1 from team_memberships where user_id = $1 and team_id = $2 and status = 'active'`,
    [userId, teamId]
  )
  return rows.length > 0
}

export interface TeamKeyState {
  activated: boolean
  wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null
  pendingDevices: Array<{ deviceId: string; name: string; publicKey: string }>
}

type Fail<S extends number> = { ok: false; status: S; error: string }

/**
 * `pendingDevices` cruza TODOS los miembros activos del equipo (no sólo los devices de QUIEN
 * llama, a diferencia de `getKeyState` personal) — es lo que el leader necesita ver para
 * autorizar a gente, no sólo a sí mismo.
 */
export async function getTeamKeyState(
  pool: Pool,
  auth: TeamKeysAuth,
  teamId: string,
  slot?: string
): Promise<TeamKeyState | Fail<403>> {
  if (!(await esMiembroActivo(pool, auth.userId, teamId))) {
    return { ok: false, status: 403, error: 'not_a_team_member' }
  }

  const { rows: activatedRows } = await pool.query(
    'select 1 from team_keys where team_id = $1', [teamId]
  )
  const activated = activatedRows.length > 0

  const { rows: pendingRows } = await pool.query(
    `select dk.device_id, d.name, dk.public_key
       from team_memberships tm
       join device_keys dk on dk.user_id = tm.user_id
       join devices d on d.id = dk.device_id and d.revoked_at is null
       left join team_key_wraps w on w.team_id = $1 and w.slot = dk.device_id::text
      where tm.team_id = $1 and tm.status = 'active' and w.slot is null
      order by d.created_at, d.id`,
    [teamId]
  )

  const { rows: wrapRows } = await pool.query(
    `select wrapped, wrap_meta from team_key_wraps
      where team_id = $1 and slot = $2`,
    [teamId, slot && slot.trim() !== '' ? slot : auth.deviceId]
  )

  return {
    activated,
    wrap: wrapRows.length > 0
      ? { wrapped: String(wrapRows[0].wrapped), wrapMeta: wrapRows[0].wrap_meta ?? null }
      : null,
    pendingDevices: pendingRows.map((r) => ({
      deviceId: String(r.device_id),
      name: String(r.name),
      publicKey: String(r.public_key),
    })),
  }
}
