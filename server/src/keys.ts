// Spec §5.3 camino B, del lado del servicio. Tres operaciones y ninguna mira adentro de
// nada: publicar la clave publica de una maquina, leer el estado de claves de la cuenta, y
// publicar envolturas de la maestra.
//
// Lo que el servicio SI vigila es la epoca. No puede validar que una envoltura contenga la
// maestra correcta — ese es justamente el punto — pero si puede impedir que un cliente
// confundido pise las envolturas de la maestra vigente con las de otra, que dejaria la
// memoria de la nube ilegible para siempre. De ahi el 409.
import type { Pool } from 'pg'

export interface KeysAuth {
  deviceId: string
  userId: string
}

export interface DeviceKeyRow {
  deviceId: string
  name: string
  publicKey: string
  hasWrap: boolean
}

export interface KeyState {
  keyEpoch: number
  /** La envoltura de ESTE device, o null si todavia no fue autorizado. */
  wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null
  devices: DeviceKeyRow[]
}

export interface WrapInput {
  slot: string
  kind: 'device' | 'recovery'
  wrapped: string
  wrap_meta?: Record<string, unknown> | null
}

type Fail<S extends number> = { ok: false; status: S; error: string }

export async function enrollDeviceKey(
  pool: Pool,
  auth: KeysAuth,
  body: { public_key?: unknown }
): Promise<{ ok: true } | Fail<400>> {
  const publicKey = body?.public_key
  if (typeof publicKey !== 'string' || publicKey.trim() === '') {
    return { ok: false, status: 400, error: 'invalid_public_key' }
  }
  await pool.query(
    `insert into device_keys (device_id, user_id, public_key)
     values ($1, $2, $3)
     on conflict (device_id) do update set public_key = excluded.public_key, updated_at = now()`,
    [auth.deviceId, auth.userId, publicKey]
  )
  return { ok: true }
}

/**
 * `slot` explicito para el camino de recuperacion (§5.3 camino B, D8): una maquina que
 * arranca sin ninguna otra viva no puede pedir "mi envoltura" —todavia no tiene ninguna—
 * sino la de recuperacion, que es la unica que su codigo puede abrir. Sin este parametro
 * `recoverWithCode` recibe siempre `wrap: null` y la recuperacion no existe en la practica.
 *
 * No amplia lo que el llamador puede ver: sigue acotado a SU `user_id`, y lo que devuelve
 * es un blob que el servidor no puede abrir en ninguno de los dos casos.
 */
export async function getKeyState(pool: Pool, auth: KeysAuth, slot?: string): Promise<KeyState> {
  const { rows: epochRows } = await pool.query(
    'select key_epoch from users where id = $1',
    [auth.userId]
  )
  const keyEpoch = Number(epochRows[0]?.key_epoch ?? 0)

  // Las revocadas no se listan: ofrecerle al usuario autorizar una maquina que ya no puede
  // sincronizar seria mentirle sobre lo que va a pasar.
  const { rows: deviceRows } = await pool.query(
    `select k.device_id, d.name, k.public_key,
            (w.slot is not null) as has_wrap
       from device_keys k
       join devices d on d.id = k.device_id and d.revoked_at is null
       left join key_wraps w
              on w.user_id = k.user_id and w.slot = k.device_id::text and w.key_epoch = $2
      where k.user_id = $1
      order by d.created_at, d.id`,
    [auth.userId, keyEpoch]
  )

  const { rows: wrapRows } = await pool.query(
    `select wrapped, wrap_meta from key_wraps
      where user_id = $1 and slot = $2 and key_epoch = $3`,
    [auth.userId, slot && slot.trim() !== '' ? slot : auth.deviceId, keyEpoch]
  )

  return {
    keyEpoch,
    wrap: wrapRows.length > 0
      ? { wrapped: String(wrapRows[0].wrapped), wrapMeta: wrapRows[0].wrap_meta ?? null }
      : null,
    devices: deviceRows.map((r) => ({
      deviceId: String(r.device_id),
      name: String(r.name),
      publicKey: String(r.public_key),
      hasWrap: Boolean(r.has_wrap),
    })),
  }
}

export async function publishWraps(
  pool: Pool,
  auth: KeysAuth,
  body: { key_epoch?: unknown; wraps?: unknown }
): Promise<{ ok: true; keyEpoch: number } | Fail<400> | Fail<409>> {
  const keyEpoch = Number(body?.key_epoch)
  if (!Number.isInteger(keyEpoch) || keyEpoch < 1) {
    return { ok: false, status: 400, error: 'invalid_key_epoch' }
  }
  const wraps = Array.isArray(body?.wraps) ? (body.wraps as WrapInput[]) : []
  if (wraps.length === 0) return { ok: false, status: 400, error: 'no_wraps' }
  for (const w of wraps) {
    if (typeof w?.slot !== 'string' || w.slot.trim() === '') {
      return { ok: false, status: 400, error: 'invalid_slot' }
    }
    if (w.kind !== 'device' && w.kind !== 'recovery') {
      return { ok: false, status: 400, error: 'invalid_kind' }
    }
    if (typeof w?.wrapped !== 'string' || w.wrapped.trim() === '') {
      return { ok: false, status: 400, error: 'invalid_wrapped' }
    }
  }

  const client = await pool.connect()
  try {
    await client.query('begin')
    // Serializa a dos maquinas de la MISMA cuenta activando el cifrado a la vez: sin esto,
    // las dos leen epoca 0, las dos escriben epoca 1 con maestras distintas, y la que
    // comitea segunda deja a la primera con datos que ya no puede leer.
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `keys:${auth.userId}`,
    ])

    const { rows } = await client.query(
      'select key_epoch from users where id = $1 for update',
      [auth.userId]
    )
    const actual = Number(rows[0]?.key_epoch ?? 0)
    if (keyEpoch < actual) {
      await client.query('rollback')
      return { ok: false, status: 409, error: 'stale_key_epoch' }
    }

    // Rotar es empezar de cero: las envolturas de la epoca vieja no sirven para la maestra
    // nueva y dejarlas seria ofrecerle al cliente una llave que no abre.
    if (keyEpoch > actual) {
      await client.query('delete from key_wraps where user_id = $1', [auth.userId])
      await client.query('update users set key_epoch = $2 where id = $1', [auth.userId, keyEpoch])
    }

    for (const w of wraps) {
      await client.query(
        `insert into key_wraps (user_id, slot, kind, key_epoch, wrapped, wrap_meta)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (user_id, slot) do update set
           kind = excluded.kind, key_epoch = excluded.key_epoch,
           wrapped = excluded.wrapped, wrap_meta = excluded.wrap_meta`,
        [auth.userId, w.slot, w.kind, keyEpoch, w.wrapped, w.wrap_meta ?? null]
      )
    }

    await client.query('commit')
    return { ok: true, keyEpoch }
  } catch (err) {
    await client.query('rollback').catch(() => { /* la conexión ya puede estar rota */ })
    throw err
  } finally {
    client.release()
  }
}
