import { createHash, timingSafeEqual } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'

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
  /**
   * SHA-256 de la prueba de posesión de la maestra (Task 15, C2). Se muestra a todo miembro
   * activo a propósito: es lo que le permite al cliente comprobar que la maestra que desenvolvió
   * es LA del equipo antes de adoptarla. No sirve como prueba: el servidor compara el hash de lo
   * que le mandan contra esto, y sacar la prueba del hash es invertir SHA-256.
   */
  verifier: string | null
  wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null
  pendingDevices: Array<{ deviceId: string; name: string; publicKey: string }>
  /**
   * Task 15b (Minor 3): si quien pregunta es el leader del equipo. Es lo que le deja al cliente
   * NO pedir `recrypt-pending` siendo member: era un 403 seguro que además gastaba el limiter
   * de recrypt. Sólo informa; cada ruta de leader lo vuelve a chequear con `isTeamLeader`.
   */
  isLeader: boolean
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
  const isLeader = await isTeamLeader(pool, auth.userId, teamId)

  const { rows: activatedRows } = await pool.query(
    'select verifier from team_keys where team_id = $1', [teamId]
  )
  const activated = activatedRows.length > 0
  const verifier = activated ? ((activatedRows[0].verifier as string | null) ?? null) : null

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
    verifier,
    wrap: wrapRows.length > 0
      ? { wrapped: String(wrapRows[0].wrapped), wrapMeta: wrapRows[0].wrap_meta ?? null }
      : null,
    pendingDevices: pendingRows.map((r) => ({
      deviceId: String(r.device_id),
      name: String(r.name),
      publicKey: String(r.public_key),
    })),
    isLeader,
  }
}

export async function activateTeamKey(
  pool: Pool,
  auth: TeamKeysAuth,
  teamId: string,
  body: { wraps?: unknown; verifier?: unknown }
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
  /**
   * Activar es: UNA envoltura para el device que activa, y la de recuperación. Nada más.
   *
   * Antes entraba cualquier lista: un slot de device ajeno (una envoltura plantada para otro
   * device en el momento de activar, sin pasar por `authorize` ni por su prueba) o ninguna
   * envoltura de recuperación — un equipo sin código, irrecuperable si el leader pierde su
   * máquina, sin que nadie lo hubiera decidido.
   */
  const recuperacion = wraps.filter((w) => w.kind === 'recovery' || w.slot === 'recovery')
  if (recuperacion.length !== 1 || recuperacion[0].slot !== 'recovery' || recuperacion[0].kind !== 'recovery') {
    return { ok: false, status: 400, error: 'missing_recovery' }
  }
  const deDevice = wraps.filter((w) => w.kind === 'device')
  if (deDevice.length !== 1 || deDevice[0].slot !== auth.deviceId) {
    return { ok: false, status: 400, error: 'invalid_slot' }
  }
  // Sin verificador el equipo quedaría sin forma de probar posesión nunca más: ni autorizar
  // otra máquina ni migrar lo viejo (las dos rutas lo exigen). Es el único momento en que se
  // puede derivar, igual que `rotate_verifier` al activar el personal.
  if (typeof body?.verifier !== 'string' || !/^[0-9a-f]{64}$/.test(body.verifier)) {
    return { ok: false, status: 400, error: 'missing_verifier' }
  }
  const verifier = body.verifier

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
      'insert into team_keys (team_id, activated_by, verifier) values ($1, $2, $3)', [teamId, auth.userId, verifier]
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

export async function authorizeTeamDevice(
  pool: Pool,
  auth: TeamKeysAuth,
  teamId: string,
  body: { wraps?: unknown; proof?: unknown }
): Promise<{ ok: true } | Fail<400> | Fail<403> | Fail<404>> {
  if (!(await isTeamLeader(pool, auth.userId, teamId))) {
    return { ok: false, status: 403, error: 'leader_required' }
  }
  const { rows: activatedRows } = await pool.query('select 1 from team_keys where team_id = $1', [teamId])
  if (activatedRows.length === 0) return { ok: false, status: 404, error: 'not_activated' }
  /**
   * C2 (review final): ser leader no alcanza. Un leader sin la maestra —existe por diseño:
   * transferir el rol no transfiere la clave (spec §6)— sellaba SU maestra para la pública de
   * cualquier device del equipo (sellar no requiere ningún secreto) y pisaba su envoltura con
   * este upsert. El device la readoptaba solo en el arranque siguiente y desde ahí cifraba
   * para el atacante. Mismo agujero que `publishWraps` personal cerró con `rotate_proof`.
   *
   * Con la prueba, quien escribe una envoltura tiene la maestra. Por eso el upsert se queda:
   * re-envolver para un device que regeneró su par es un caso legítimo, y el cliente igual
   * verifica contra el verificador la maestra que adopta.
   */
  if (!(await pruebaDePosesionValida(pool, teamId, body?.proof))) {
    return { ok: false, status: 403, error: 'must_hold_team_key' }
  }

  const wraps = Array.isArray(body?.wraps) ? (body.wraps as TeamWrapInput[]) : []
  if (wraps.length === 0) return { ok: false, status: 400, error: 'no_wraps' }
  // El slot de recuperación sólo se escribe al activar: pisarlo acá invalidaría el código que
  // el leader ya tiene anotado, sin que nadie se lo pidiera (spec §6).
  if (wraps.some((w) => w.slot === 'recovery' || w.kind === 'recovery')) {
    return { ok: false, status: 400, error: 'cannot_overwrite_recovery' }
  }
  for (const w of wraps) {
    if (typeof w?.slot !== 'string' || w.slot.trim() === '') return { ok: false, status: 400, error: 'invalid_slot' }
    if (w.kind !== 'device') return { ok: false, status: 400, error: 'invalid_kind' }
    if (typeof w?.wrapped !== 'string' || w.wrapped.trim() === '') return { ok: false, status: 400, error: 'invalid_wrapped' }
  }

  const client = await pool.connect()
  try {
    await client.query('begin')
    for (const w of wraps) {
      await client.query(
        `insert into team_key_wraps (team_id, slot, kind, wrapped, wrap_meta)
         values ($1, $2, 'device', $3, $4)
         on conflict (team_id, slot) do update set wrapped = excluded.wrapped, wrap_meta = excluded.wrap_meta`,
        [teamId, w.slot, w.wrapped, w.wrap_meta ?? null]
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

/**
 * ¿`proof` prueba tener la maestra de ESTE equipo? Compara el SHA-256 de la prueba contra el
 * verificador guardado al activar. Un equipo sin verificador (sólo posible en una base de
 * desarrollo anterior a la migración 010) no puede probar nada: falla cerrado.
 *
 * Se comparan buffers de bytes y no strings: `timingSafeEqual` lanza con longitudes distintas.
 * El hash hex siempre mide 64, pero se chequea igual en vez de confiar en eso — misma lección
 * que `pruebaDePosesion` de keys.ts (un 500 en vez de un 403 con una entrada multibyte).
 */
export async function pruebaDePosesionValida(
  db: Pool | PoolClient,
  teamId: string,
  proof: unknown
): Promise<boolean> {
  if (typeof proof !== 'string' || proof === '') return false
  const { rows } = await db.query('select verifier from team_keys where team_id = $1', [teamId])
  const guardado = (rows[0]?.verifier as string | null | undefined) ?? null
  if (!guardado) return false
  const a = Buffer.from(createHash('sha256').update(proof, 'utf8').digest('hex'), 'utf8')
  const b = Buffer.from(guardado, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}
