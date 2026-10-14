import type { Pool } from 'pg'

export interface TeamKeysAuth {
  deviceId: string
  userId: string
}

export interface TeamWrapInput {
  slot: string
  kind: 'device' | 'recovery'
  wrapped: string
  wrap_meta?: Record<string, unknown> | null
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

export async function activateTeamKey(
  pool: Pool,
  auth: TeamKeysAuth,
  teamId: string,
  body: { wraps?: unknown }
): Promise<{ ok: true } | Fail<400> | Fail<403> | Fail<409>> {
  if (!(await isTeamLeader(pool, auth.userId, teamId))) {
    return { ok: false, status: 403, error: 'leader_required' }
  }
  const wraps = Array.isArray(body?.wraps) ? (body.wraps as TeamWrapInput[]) : []
  if (wraps.length === 0) return { ok: false, status: 400, error: 'no_wraps' }
  for (const w of wraps) {
    if (typeof w?.slot !== 'string' || w.slot.trim() === '') return { ok: false, status: 400, error: 'invalid_slot' }
    if (w.kind !== 'device' && w.kind !== 'recovery') return { ok: false, status: 400, error: 'invalid_kind' }
    if (typeof w?.wrapped !== 'string' || w.wrapped.trim() === '') return { ok: false, status: 400, error: 'invalid_wrapped' }
  }

  const client = await pool.connect()
  try {
    await client.query('begin')
    // Serializa dos devices del mismo leader activando casi a la vez (Review Focus): el
    // segundo ve la fila ya insertada por el primero y sale con 409 ANTES de tocar wraps.
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`team-key:${teamId}`])

    const { rows: existing } = await client.query(
      'select 1 from team_keys where team_id = $1 for update', [teamId]
    )
    if (existing.length > 0) {
      await client.query('rollback')
      return { ok: false, status: 409, error: 'already_activated' }
    }

    await client.query(
      'insert into team_keys (team_id, activated_by) values ($1, $2)', [teamId, auth.userId]
    )
    for (const w of wraps) {
      await client.query(
        `insert into team_key_wraps (team_id, slot, kind, wrapped, wrap_meta)
         values ($1, $2, $3, $4, $5)`,
        [teamId, w.slot, w.kind, w.wrapped, w.wrap_meta ?? null]
      )
    }
    await client.query('commit')
    return { ok: true }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
