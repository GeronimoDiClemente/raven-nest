import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'
import { hashToken } from './auth'

/**
 * §9.2 — la emisión del token, el único camino nuevo del servicio y el único aditivo:
 * todo lo demás (auth por token, tenancy por `user_id`, cuotas, allowlist) ya estaba
 * escrito y ejercitado desde el día uno por la cuenta única.
 *
 * La decisión que la spec dejaba abierta ("si el emisor verifica el JWT de Supabase o si
 * la identidad se muda también") queda tomada por lo barato: **se verifica el JWT de
 * Supabase**. La identidad sigue viviendo en Supabase; el servicio sólo comprueba que el
 * portador tiene un login válido y le abre una fila en `devices`. Mudar la identidad es un
 * cambio posterior que no obliga a reescribir esto: lo único que cambiaría es esta función.
 */
export interface JwtIdentity {
  userId: string
  email: string | null
}

function decodeSegment(seg: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(seg, 'base64url').toString('utf8')
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Verifica un JWT de login de Supabase (HS256 con el secreto del proyecto) y devuelve la
 * identidad, o `null` si no lo es. Nunca lanza: cualquier entrada mal formada es un `null`.
 *
 * `now` se inyecta en vez de leer el reloj adentro para que el vencimiento se pueda testear
 * sin fake timers.
 */
export function verifySupabaseJwt(token: string, secret: string, now: number): JwtIdentity | null {
  // Un secreto vacío verificaría contra HMAC(''), que cualquiera puede calcular. Es un
  // error de configuración, no una credencial inválida, pero el modo seguro es el mismo.
  if (!secret) return null

  const partes = token.split('.')
  if (partes.length !== 3) return null
  const [headerB64, payloadB64, firmaB64] = partes

  const header = decodeSegment(headerB64)
  // Sólo HS256. `none` y cualquier otro alg se rechazan explícitamente: aceptar el alg que
  // dice el token es la confusión de algoritmo clásica, y con `none` la firma sobra.
  if (!header || header.alg !== 'HS256') return null

  const esperada = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest()
  let recibida: Buffer
  try {
    recibida = Buffer.from(firmaB64, 'base64url')
  } catch {
    return null
  }
  // timingSafeEqual exige el mismo largo, así que la comparación de largos va primero y por
  // separado — no filtra nada que el atacante no controle ya.
  if (recibida.length !== esperada.length) return null
  if (!timingSafeEqual(recibida, esperada)) return null

  const payload = decodeSegment(payloadB64)
  if (!payload) return null

  // El rol es el chequeo que más importa acá: la ANON KEY de Supabase es un JWT firmado con
  // ESTE MISMO secreto y es pública (viaja en el bundle de cualquier cliente). Sin esto,
  // cualquiera con la anon key se registra un device. `service_role` se rechaza por lo
  // mismo desde el otro lado: es una credencial de servidor, no un usuario.
  if (payload.role !== 'authenticated') return null

  // Un token sin vencimiento no es un login, es una llave permanente.
  if (typeof payload.exp !== 'number') return null
  if (payload.exp * 1000 <= now) return null

  const sub = payload.sub
  if (typeof sub !== 'string' || sub === '') return null

  return { userId: sub, email: typeof payload.email === 'string' ? payload.email : null }
}

/** Mismo formato que emitía la edge function `memory-token`: `nmk_` + 32 bytes al azar. */
export function generateDeviceToken(): string {
  return `nmk_${randomBytes(32).toString('base64url')}`
}

export type RegisterResult =
  | { ok: true; deviceId: string; token: string }
  | { ok: false; status: 403; error: string }

/**
 * Crea (o reusa) el usuario, verifica el allowlist y abre una fila en `devices`. Devuelve
 * el token UNA sola vez: el servicio guarda el hash y nada más (§9.1).
 *
 * Sobre el plan: el JWT de Supabase no lo trae, así que un usuario nuevo entra como `free`
 * y un `users.plan` ya existente NO se pisa. `free` es un plan de nube válido a propósito
 * (ver `CLOUD_PLANS` en auth.ts): le corresponde 1 proyecto. Mantener el plan sincronizado
 * con Supabase es otro camino — hoy no existe y está anotado como pendiente.
 *
 * El tope de máquinas por plan NO se aplica acá: lo aplica `authenticate` en cada request,
 * que es donde ya está testeado y donde el cliente sabe leer `device_limit_reached`.
 * Registrar siempre y fallar al sincronizar mantiene una sola fuente de esa regla.
 */
export async function registerDevice(
  pool: Pool,
  identity: JwtIdentity,
  device: { name: string; platform?: string | null }
): Promise<RegisterResult> {
  const client = await pool.connect()
  try {
    await client.query('begin')

    // El email se refresca en cada registro (el usuario pudo cambiarlo en Supabase); el
    // plan no se toca, porque acá no lo sabemos y pisarlo con 'free' degradaría a un pago.
    await client.query(
      `insert into users (id, email) values ($1, $2)
       on conflict (id) do update set email = coalesce(excluded.email, users.email)`,
      [identity.userId, identity.email]
    )

    const { rows: permitido } = await client.query(
      'select 1 from allowlist where user_id = $1',
      [identity.userId]
    )
    if (permitido.length === 0) {
      // Rollback y no 401: la credencial es buena, lo que falta es el beta. El mismo código
      // que devuelve `authenticate`, para que el cliente no tenga que aprender otro.
      await client.query('rollback')
      return { ok: false, status: 403, error: 'not_in_beta' }
    }

    const token = generateDeviceToken()
    // `devices.id` es `uuid primary key` SIN default en 001_init.sql, asi que el id se
    // genera acá — no lo pone Postgres.
    const deviceId = randomUUID()
    await client.query(
      `insert into devices (id, user_id, name, platform, token_hash)
       values ($1, $2, $3, $4, $5)`,
      [deviceId, identity.userId, device.name, device.platform ?? null, hashToken(token)]
    )

    await client.query('commit')
    return { ok: true, deviceId, token }
  } catch (err) {
    await client.query('rollback').catch(() => { /* la conexión ya puede estar rota */ })
    throw err
  } finally {
    client.release()
  }
}

export type RevokeResult =
  | { ok: true; revoked: number }
  | { ok: false; status: 401; error: string }

/**
 * Revoca la credencial de un device. Es el gemelo de `registerDevice`: sin él, un token
 * emitido vive para siempre y desconectar una máquina no invalida nada del lado del
 * servicio — que es exactamente lo que pasaba, porque el cliente "revocaba" contra una edge
 * function de Supabase que nunca se deployó.
 *
 * Autentica con el token `nmk_` en vez del JWT del login: es lo único que tiene la máquina
 * que se está desconectando, y alcanza — un token identifica un device sin ambigüedad.
 *
 * **No pasa por `authenticate`, y es a propósito.** `authenticate` rechaza con 403 a quien
 * quedó fuera del allowlist o del plan, y esa gente tiene que poder revocar igual: es la
 * misma razón por la que la UI ofrece Disconnect desde los estados `plan_required` y
 * `error`. Poder cerrar una credencial no puede depender de seguir siendo cliente.
 *
 * Un token ya revocado devuelve 401 igual que uno inventado: no hay nada que decirle a
 * alguien que trae una credencial muerta, y distinguir los dos casos filtra si existió.
 */
export async function revokeDevices(
  pool: Pool,
  token: string,
  opts: { all?: boolean } = {}
): Promise<RevokeResult> {
  const limpio = (token ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!limpio) return { ok: false, status: 401, error: 'unauthorized' }

  const { rows } = await pool.query(
    'select id, user_id from devices where token_hash = $1 and revoked_at is null',
    [hashToken(limpio)]
  )
  if (rows.length === 0) return { ok: false, status: 401, error: 'unauthorized' }

  // `all` es para un "cerrar sesión en todas las máquinas". El default revoca sólo la que
  // llama: desconectar una máquina no tiene por qué dejar al resto afuera.
  const { rowCount } = opts.all
    ? await pool.query(
        'update devices set revoked_at = now() where user_id = $1 and revoked_at is null',
        [rows[0].user_id]
      )
    : await pool.query(
        'update devices set revoked_at = now() where id = $1 and revoked_at is null',
        [rows[0].id]
      )

  return { ok: true, revoked: rowCount ?? 0 }
}
