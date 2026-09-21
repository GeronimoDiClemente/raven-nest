import { createHmac, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto'
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

  return identidadDelPayload(decodeSegment(payloadB64), now)
}

/**
 * Lo que se le exige al payload una vez que la FIRMA ya cerró. Es común a los dos algoritmos:
 * cambiar cómo se verifica la firma no puede aflojar qué tokens valen.
 */
function identidadDelPayload(payload: Record<string, unknown> | null, now: number): JwtIdentity | null {
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

/** De dónde salen las claves públicas del proyecto. La implementa `jwks.ts`. */
export interface ClavesDeFirma {
  /** La clave pública que el emisor publica para ese `kid`, o `null` si no la conoce. */
  paraKid(kid: string): Promise<JsonWebKey | null>
}

/** Con qué puede verificar este servicio un login. Los dos campos son opcionales a propósito. */
export interface EmisorDeLogin {
  /** El secreto simétrico legacy del proyecto (`SUPABASE_JWT_SECRET`). */
  secretoHs256?: string
  /** El JWKS del proyecto, para los que firman con claves asimétricas. */
  claves?: ClavesDeFirma
}

/**
 * Verifica un JWT de login de Supabase **sin importar cómo firme el proyecto**.
 *
 * Supabase movió la firma de un secreto simétrico compartido (HS256) a claves asimétricas
 * por proyecto (ES256 + un `kid` que resuelve contra `/auth/v1/.well-known/jwks.json`). El
 * proyecto de Nest ya está del lado nuevo —verificado el 2026-09-21 contra un token real de
 * la app y contra el JWKS publicado—, así que el camino HS256 solo rechazaba **todo** login
 * legítimo, y ningún valor de `SUPABASE_JWT_SECRET` lo arreglaba: ese secreto ya no firma.
 *
 * Los dos caminos conviven porque el secreto legacy sigue siendo válido en proyectos que no
 * migraron, y porque durante una rotación hay un rato con las dos cosas vivas.
 *
 * **El algoritmo lo decide lo que este servicio TIENE, no lo que el token dice.** Un token
 * ES256 no se mira si no hay JWKS configurado, y uno HS256 no se mira si no hay secreto. Esa
 * es la defensa contra la confusión de algoritmo: el JWKS es público, así que un atacante
 * conoce la clave pública y podría firmar un HS256 usándola de secreto.
 */
export async function verificarJwtDeSupabase(
  token: string,
  now: number,
  emisor: EmisorDeLogin
): Promise<JwtIdentity | null> {
  const partes = token.split('.')
  if (partes.length !== 3) return null
  const [headerB64, payloadB64, firmaB64] = partes

  const header = decodeSegment(headerB64)
  if (!header) return null

  if (header.alg === 'HS256') {
    return emisor.secretoHs256 ? verifySupabaseJwt(token, emisor.secretoHs256, now) : null
  }
  // Cualquier otro alg —`none`, `RS256`, lo que sea— cae acá y se rechaza: sólo se soportan
  // los dos que Supabase emite.
  if (header.alg !== 'ES256' || !emisor.claves) return null

  // Sin `kid` no se prueba con todas las claves: elegir clave a fuerza bruta convierte una
  // rotación a medio hacer en una ventana donde una clave retirada sigue sirviendo.
  const kid = header.kid
  if (typeof kid !== 'string' || kid === '') return null

  let jwk: JsonWebKey | null
  try {
    jwk = await emisor.claves.paraKid(kid)
  } catch {
    // Un JWKS que no contesta es un problema de red, y desde acá se ve igual que una
    // credencial inválida. Lo distingue el llamador, que sabe si hay emisor configurado.
    return null
  }
  if (!jwk) return null

  // La clave tiene que ser la que ESE alg necesita. Un JWKS que devolviera una RSA no
  // habilita un token que dice ES256: ahí la confusión la pondría el emisor, no el atacante.
  //
  // Honestidad sobre lo que prueban los tests: sacando este chequeo, el del `alg` de arriba y
  // el del largo de la firma —los tres a la vez— la suite sigue verde (medido el 2026-09-21).
  // O sea que quien rechaza el token de contrabando es la verificación ECDSA misma, y estas
  // tres líneas son defensa en profundidad, no la defensa. Se quedan porque el día que este
  // verificador acepte un segundo algoritmo pasan a ser lo único que separa a uno del otro.
  const forma = jwk as { kty?: string; crv?: string; alg?: string }
  if (forma.kty !== 'EC' || forma.crv !== 'P-256') return null
  if (forma.alg !== undefined && forma.alg !== 'ES256') return null

  const firma = Buffer.from(firmaB64, 'base64url')
  // JWS lleva la firma cruda R||S, 64 bytes para P-256. Node por defecto espera DER, de ahí
  // el `dsaEncoding`; el largo se chequea antes porque `verify` con basura tira.
  if (firma.length !== 64) return null

  let ok = false
  try {
    const clave = createPublicKey({ key: jwk, format: 'jwk' })
    ok = verify('sha256', Buffer.from(`${headerB64}.${payloadB64}`), { key: clave, dsaEncoding: 'ieee-p1363' }, firma)
  } catch {
    return null
  }
  if (!ok) return null

  return identidadDelPayload(decodeSegment(payloadB64), now)
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
 *
 * `supabaseJwt` es el mismo JWT que `verifySupabaseJwt` ya validó para esta request (lo
 * manda `http.ts`, que es quien lo tiene crudo). Se usa DESPUÉS de que el device quedó
 * registrado, para sincronizar `team_memberships` (Team Memory Layer 1, Parte 2) — nunca
 * antes, y nunca dentro de la misma transacción: es un fetch de red a Supabase, y colgar la
 * transacción de registro del device esperando esa red convertiría un timeout de Supabase
 * en un timeout del registro. Ver `syncTeamMemberships`.
 */
export async function registerDevice(
  pool: Pool,
  identity: JwtIdentity,
  device: { name: string; platform?: string | null },
  supabaseJwt?: string
): Promise<RegisterResult> {
  const client = await pool.connect()
  let result: RegisterResult
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
      // que devuelve `authenticate`, para que el cliente no tenga que aprender otro. Retorno
      // directo (no cae a la sincronización de equipos de más abajo): sin device no hay nada
      // que registrar y no tiene sentido gastar el fetch a Supabase.
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
    result = { ok: true, deviceId, token }
  } catch (err) {
    await client.query('rollback').catch(() => { /* la conexión ya puede estar rota */ })
    throw err
  } finally {
    client.release()
  }

  // Fuera del try/finally de arriba a propósito: `client` ya se liberó, y esto usa su propia
  // conexión y su propia transacción corta (ver `syncTeamMemberships`). Best-effort: nunca
  // lanza, así que nunca puede convertir un registro de device exitoso en uno fallido.
  await syncTeamMemberships(pool, identity.userId, supabaseJwt)
  return result
}

// --- Team Memory Layer 1, Parte 2 — sincronización de membresía ---------------------------

/** Timeout del fetch a Supabase REST: ni tan corto que rebote una red lenta, ni tan largo
 * que un Supabase caído demore la respuesta del registro de device más de lo razonable. */
const SUPABASE_MEMBERSHIPS_TIMEOUT_MS = 5000

export interface TeamMembership {
  teamId: string
  teamName: string | null
  role: string | null
}

/** La forma cruda que devuelve PostgREST para `select=team_id,role,teams(name)`. */
interface SupabaseTeamMemberRow {
  team_id?: unknown
  role?: unknown
  // PostgREST embebe una relación many-to-one como objeto ({name: "..."}), que es lo que
  // devuelve en la práctica y lo que testean los tests de este archivo. Se acepta también el
  // array por si la config de la FK del lado de Supabase cambiara la cardinalidad que
  // PostgREST infiere — defensivo, no ejercitado.
  teams?: { name?: unknown } | { name?: unknown }[] | null
}

/**
 * Trae las membresías ACTIVAS del usuario desde Supabase REST, autenticada con el MISMO JWT
 * que ya validó `verifySupabaseJwt` para esta request — nunca una service-role key, para que
 * la consulta quede sujeta a la misma RLS que vería el usuario si la hiciera él mismo.
 */
export async function fetchActiveTeamMemberships(
  supabaseUrl: string,
  anonKey: string,
  userId: string,
  jwt: string
): Promise<TeamMembership[]> {
  const url =
    `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/team_members` +
    `?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=team_id,role,teams(name)`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SUPABASE_MEMBERSHIPS_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    throw new Error(`supabase team_members respondió ${res.status}`)
  }

  const body = (await res.json()) as unknown
  if (!Array.isArray(body)) return []
  return body.map((row) => {
    const r = row as SupabaseTeamMemberRow
    const teamsField = Array.isArray(r.teams) ? r.teams[0] : r.teams
    const rawName =
      teamsField && typeof teamsField === 'object' ? (teamsField as { name?: unknown }).name : undefined
    return {
      teamId: String(r.team_id),
      teamName: typeof rawName === 'string' ? rawName : null,
      role: typeof r.role === 'string' ? r.role : null,
    }
  })
}

/**
 * Reemplaza (delete + insert) las filas de `team_memberships` de un usuario, en una sola
 * transacción — nunca un insert incremental: la respuesta de Supabase es el set completo de
 * membresías activas de ESTE momento, así que lo que ya no viene ahí ya no es cierto.
 */
async function replaceTeamMemberships(
  pool: Pool,
  userId: string,
  memberships: TeamMembership[]
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('delete from team_memberships where user_id = $1', [userId])
    for (const m of memberships) {
      await client.query(
        `insert into team_memberships (user_id, team_id, team_name, role, status, synced_at)
         values ($1, $2, $3, $4, 'active', now())`,
        [userId, m.teamId, m.teamName, m.role]
      )
    }
    await client.query('commit')
  } catch (err) {
    await client.query('rollback').catch(() => { /* la conexión ya puede estar rota */ })
    throw err
  } finally {
    client.release()
  }
}

/**
 * Sincroniza `team_memberships` desde Supabase — BEST EFFORT, siempre.
 *
 * Sin `SUPABASE_URL`, sin `SUPABASE_ANON_KEY`, o sin el JWT del login (los tres hacen
 * falta), simplemente no hace nada: es el caso de test/dev sin Supabase configurado, y el
 * registro de device tiene que seguir funcionando exactamente igual que antes de que esto
 * existiera. Un fallo del fetch o de la escritura tampoco propaga — sólo se loguea como
 * warning — porque nada de esto puede tumbar un registro de device por un problema ajeno
 * (Supabase caído, un 500, la red). El estado que YA hubiera en `team_memberships` para ese
 * usuario queda tal cual quedó la última vez que esto sí funcionó.
 */
export async function syncTeamMemberships(
  pool: Pool,
  userId: string,
  supabaseJwt: string | undefined
): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey || !supabaseJwt) return

  try {
    const memberships = await fetchActiveTeamMemberships(supabaseUrl, anonKey, userId, supabaseJwt)
    await replaceTeamMemberships(pool, userId, memberships)
  } catch (err) {
    console.warn('[devices] no se pudo sincronizar team_memberships', err)
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
