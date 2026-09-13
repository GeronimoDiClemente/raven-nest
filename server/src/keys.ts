// Spec §5.3 camino B, del lado del servicio. Tres operaciones y ninguna mira adentro de
// nada: publicar la clave publica de una maquina, leer el estado de claves de la cuenta, y
// publicar envolturas de la maestra.
//
// Lo que el servicio SI vigila es la epoca. No puede validar que una envoltura contenga la
// maestra correcta — ese es justamente el punto — pero si puede impedir que un cliente
// confundido pise las envolturas de la maestra vigente con las de otra, que dejaria la
// memoria de la nube ilegible para siempre. De ahi el 409.
import { timingSafeEqual } from 'node:crypto'
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
  /**
   * Si el device cambia su clave publica, la envoltura que tenia deja de servir: fue sellada
   * para la clave vieja y su privada ya no existe. Se borra en la misma transaccion.
   *
   * Sin esto, `has_wrap` seguia dando `true` —mira si existe una fila, no si corresponde a
   * la publica actual— asi que la maquina NO aparecia en `pendingDevices` y la otra nunca
   * ofrecia autorizarla. La maquina quedaba afuera de forma permanente y en silencio,
   * justo despues de un evento que ya es feo de por si: un `keys.bin` corrupto, un llavero
   * restaurado, un par regenerado.
   */
  const client = await pool.connect()
  try {
    await client.query('begin')
    const { rows } = await client.query(
      'select public_key from device_keys where device_id = $1',
      [auth.deviceId]
    )
    const anterior = rows[0]?.public_key as string | undefined
    await client.query(
      `insert into device_keys (device_id, user_id, public_key)
       values ($1, $2, $3)
       on conflict (device_id) do update set public_key = excluded.public_key, updated_at = now()`,
      [auth.deviceId, auth.userId, publicKey]
    )
    if (anterior && anterior !== publicKey) {
      await client.query(
        'delete from key_wraps where user_id = $1 and slot = $2',
        [auth.userId, auth.deviceId]
      )
    }
    await client.query('commit')
  } catch (err) {
    await client.query('rollback').catch(() => { /* la conexion ya esta rota */ })
    throw err
  } finally {
    client.release()
  }
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
  body: {
    key_epoch?: unknown; wraps?: unknown; mode?: unknown
    /** El verificador de la epoca NUEVA: lo que se guarda para la proxima rotacion. */
    rotate_verifier?: unknown
    /** La prueba de tener la maestra VIGENTE: lo que se compara contra lo guardado. */
    rotate_proof?: unknown
  }
): Promise<{ ok: true; keyEpoch: number } | Fail<400> | Fail<403> | Fail<409>> {
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

    /**
     * ACTIVAR y AUTORIZAR son dos operaciones distintas y hasta el 2026-09-12 entraban por
     * el mismo camino, distinguidas sólo por comparar épocas. El empate las confundía:
     *
     * Dos máquinas activan casi a la vez. Las dos leen `key_epoch = 0`, las dos generan su
     * PROPIA maestra y publican época 1. El advisory lock las serializa pero no decide nada:
     * la primera rota a 1 y escribe sus envolturas; la segunda entra con `actual = 1` y
     * `keyEpoch = 1`, no es `<` (no hay 409) ni es `>` (no rota), así que cae al upsert —
     * suma su slot con SU maestra y **pisa el slot `recovery`** con el suyo. Quedan dos
     * maestras vivas en la misma época: cada máquina cuenta como ilegible lo que subió la
     * otra, el código de recuperación que se le mostró a la primera ya no abre nada, y si
     * esa máquina muere lo que subió es irrecuperable.
     *
     * Con la intención explícita, la segunda activación pide época 1 cuando ya hay 1 y se
     * lleva un 409 — que es lo que el cliente necesita para adoptar la que existe en vez de
     * crear otra.
     *
     * `mode` es OBLIGATORIO. Dejarlo opcional "por compatibilidad" hacía que las reglas
     * estrictas —la prueba de posesion incluida— sólo corrieran cuando el llamador las
     * pedia: una defensa que el atacante activa o no a gusto. Verificado contra Postgres: el
     * mismo request que el test rechaza, sin el campo `mode`, rotaba la epoca y borraba TODAS
     * las envolturas incluida la de recuperacion.
     *
     * No hay compatibilidad que romper: estas rutas nunca llegaron a produccion.
     */
    if (body?.mode !== 'activate' && body?.mode !== 'authorize') {
      await client.query('rollback')
      return { ok: false, status: 400, error: 'invalid_mode' }
    }
    const modo = body.mode

    /**
     * La coherencia de época se decide ANTES que la posesión, y el orden es parte del
     * contrato, no un detalle.
     *
     * Con el orden invertido, dos máquinas activando a la vez terminaban así: la segunda
     * pide época 1 cuando ya hay 1, la prueba de posesión mira su verificador (derivado de
     * SU maestra, que no es la que quedó) y contesta `403 not_authorized_to_rotate`. Pero
     * esa máquina no está intentando rotar nada: está perdiendo una carrera, y lo que el
     * cliente necesita oír es `409 stale_key_epoch`, que es su señal para ADOPTAR la maestra
     * que ya existe. Con el 403 se quedaba sin clave y sin camino de vuelta.
     *
     * No hay filtración en el cambio: la época ya se lee con un `GET /v1/keys`.
     */
    if (modo === 'activate' && keyEpoch !== actual + 1) {
      // Activar es SIEMPRE pasar de `actual` a `actual + 1`. Si otra maquina ya activo, esta
      // se entera aca y el cliente adopta la que existe en vez de crear una segunda.
      await client.query('rollback')
      return { ok: false, status: 409, error: 'stale_key_epoch' }
    }
    if (modo === 'authorize' && (keyEpoch !== actual || actual === 0)) {
      // Autorizar no rota: suma una envoltura a la maestra vigente. Con epoca 0 no hay
      // ninguna, y escribir envolturas huerfanas que nadie puede usar es peor que negarse.
      await client.query('rollback')
      return { ok: false, status: 409, error: actual === 0 ? 'not_activated' : 'stale_key_epoch' }
    }

    /**
     * La prueba de posesión, y por qué son DOS campos y no uno.
     *
     * `rotate_proof` prueba que el llamador tiene la maestra que está en vigor AHORA:
     * derivado de esa maestra y de la época actual. `rotate_verifier` es el valor que se
     * guarda para la próxima vez, derivado de la maestra NUEVA y de la época nueva.
     *
     * La primera versión usaba un solo campo para las dos cosas, y así rotar era imposible
     * para todo el mundo, incluido el dueño: el cliente manda el verificador de su maestra
     * nueva, el servidor lo compara contra el de la vieja, y no coinciden nunca — no pueden,
     * son de maestras distintas. Verificado contra Postgres el 2026-09-13: una cuenta
     * activada quedaba sin ninguna rotación posible.
     */
    const pruebaDePosesion = async (): Promise<boolean> => {
      const prueba = typeof body?.rotate_proof === 'string' ? body.rotate_proof : ''
      const { rows: esperado } = await client.query(
        'select rotate_verifier from users where id = $1',
        [auth.userId]
      )
      const guardado = (esperado[0]?.rotate_verifier as string | null) ?? null
      return Boolean(guardado) && prueba.length === guardado!.length &&
        timingSafeEqual(Buffer.from(prueba), Buffer.from(guardado!))
    }

    /**
     * Rotar DESTRUYE: borra todas las envolturas de la cuenta, incluida la de recuperación.
     * Hasta el 2026-09-12 lo único que hacía falta para eso era un token válido de la cuenta
     * — ni tener la maestra, ni haber sido autorizado nunca. Y era alcanzable SIN atacante:
     * un corte de red dejaba el estado en época 0, la tarjeta ofrecía "Activar" en una
     * máquina sin clave, y el clic borraba la clave de todas las demás.
     *
     * La primera activación (época 0) no tiene de dónde probar posesión y queda libre. De
     * ahí en adelante, rotar exige conocer la maestra vigente.
     *
     * La prueba no puede ser "existe una fila en `key_wraps` para mi slot": el propio sujeto
     * de la prueba puede escribirla. Verificado contra Postgres: un device sin la maestra
     * hacía `authorize` sobre su propio slot con un blob cualquiera y después `activate`, y
     * la fila que él mismo acababa de escribir le servía de prueba.
     */
    if (modo === 'activate' && actual > 0 && !(await pruebaDePosesion())) {
      await client.query('rollback')
      return { ok: false, status: 403, error: 'not_authorized_to_rotate' }
    }

    /**
     * `authorize` normalmente escribe el slot de OTRO device: sin esta regla, una máquina sin
     * la maestra se fabricaba su propia envoltura.
     *
     * La excepción es el camino D8 —"perdí todas mis máquinas"—: `recoverWithCode` abre la
     * copia de recuperación con el código y después se auto-autoriza, para que el próximo
     * arranque no vuelva a pedirlo. Esa máquina SÍ tiene la maestra en ese momento y lo puede
     * probar. Sin la excepción, la regla mataba el único camino de recuperación que hay —
     * verificado contra Postgres: `403 cannot_authorize_self`— justo el que el comentario de
     * arriba afirmaba dejar abierto.
     *
     * El slot `recovery` no se toca nunca por acá: pisarlo con un blob que no abre nada
     * invalida el código que el usuario tiene anotado. Rotar es el único camino, y rotar
     * publica una copia de recuperación nueva.
     */
    if (modo === 'authorize') {
      const tocaRecovery = wraps.some((w) => w.slot === 'recovery' || w.kind === 'recovery')
      if (tocaRecovery) {
        await client.query('rollback')
        return { ok: false, status: 403, error: 'cannot_overwrite_recovery' }
      }
      const tocaPropio = wraps.some((w) => w.slot === auth.deviceId)
      if (tocaPropio && !(await pruebaDePosesion())) {
        await client.query('rollback')
        return { ok: false, status: 403, error: 'cannot_authorize_self' }
      }
    }
    // Rotar es empezar de cero: las envolturas de la epoca vieja no sirven para la maestra
    // nueva y dejarlas seria ofrecerle al cliente una llave que no abre.
    if (keyEpoch > actual) {
      await client.query('delete from key_wraps where user_id = $1', [auth.userId])
      // El verificador de la epoca NUEVA viaja con la activacion: es lo que la proxima
      // rotacion va a tener que probar que conoce.
      await client.query(
        'update users set key_epoch = $2, rotate_verifier = $3 where id = $1',
        [auth.userId, keyEpoch, typeof body?.rotate_verifier === 'string' ? body.rotate_verifier : null]
      )
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
