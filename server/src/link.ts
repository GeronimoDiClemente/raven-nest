// Vincular una máquina sin navegador (spec del paquete portátil §7, paso 6).
//
// El §7 dibuja este flujo del lado del cliente —«Abrí esto para conectar tu cuenta»— pero el
// servicio no tenía nada que lo sostuviera: `/v1/devices` exige un JWT de Supabase, o sea una
// sesión de navegador, y un `npx` en una terminal remota no tiene dónde abrirlo. Esto es esa
// mitad faltante, con la forma de siempre para el caso: código corto en la máquina que no
// puede autenticar, aprobación en la que sí, y espera del lado del que pidió.
//
// **Lo que NO es esto**: la página web donde el usuario aprueba. La API está; la cara que la
// llama —una página, o una pantalla de Nest— se decide aparte.
//
// El gate de beta y de plan es el MISMO que el de `/v1/devices`, por construcción: el token
// lo emite `registerDevice` y no este archivo. Un camino nuevo que emitiera credenciales por
// su cuenta sería una puerta de atrás a los controles que el viejo ya aplica.
import { randomBytes, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { hashToken } from './auth'
import { registerDevice, elegibilidadDeMaquinaNueva, aplicarPlanPagoDeSupabase, type JwtIdentity } from './devices'
import type { Elegibilidad } from './elegibilidad'

/**
 * El alfabeto del código que ve el usuario.
 *
 * Sin `O`/`0`, `I`/`1`, `S`/`5` ni `B`/`8`: alguien va a leer esto de una pantalla y tipearlo
 * en otra, y esos cuatro pares son la forma clásica de que ese trámite falle y el usuario
 * concluya que el sistema está roto. Quedan 28 símbolos y 8 posiciones, o sea 38 bits — de
 * sobra para un código que vive diez minutos y que además no sirve para reclamar el token.
 */
export const ALFABETO_DEL_CODIGO = 'ACDEFGHJKLMNPQRTUVWXYZ234679'

/** Cuánto vive un pedido de vinculación. */
export const VIGENCIA_MS = 10 * 60 * 1000

/** Cada cuánto puede preguntar el cliente. Más seguido que esto se le contesta `muy-seguido`. */
export const INTERVALO_MS = 2000

/** Bytes del secreto con el que se reclama el token. */
const BYTES_DEL_CODIGO_DE_DISPOSITIVO = 32

export function generarCodigoDeUsuario(): string {
  const n = ALFABETO_DEL_CODIGO.length
  // `randomBytes` y no `Math.random`: es una credencial de corta vida, no un identificador
  // cosmético. El módulo se toma sobre un rango recortado para no sesgar hacia los primeros
  // símbolos del alfabeto.
  const limite = Math.floor(256 / n) * n
  const salida: string[] = []
  while (salida.length < 8) {
    for (const b of randomBytes(16)) {
      if (b >= limite) continue
      salida.push(ALFABETO_DEL_CODIGO[b % n]!)
      if (salida.length === 8) break
    }
  }
  return `${salida.slice(0, 4).join('')}-${salida.slice(4).join('')}`
}

/** Largo máximo del nombre de la máquina que manda la CLI al arrancar (spec §3). */
export const LARGO_MAXIMO_DEL_NOMBRE = 100

/**
 * Los `process.platform` que la CLI manda y la página sabe nombrar. Otra cosa se guarda como
 * null: el campo se MUESTRA a alguien que decide si aprobar, y un texto libre ahí es un lugar
 * donde el que pidió el código escribe lo que quiera.
 */
export const PLATAFORMAS_CONOCIDAS: ReadonlySet<string> = new Set(['win32', 'darwin', 'linux'])

export interface DatosDelPedido {
  nombre: string | null
  plataforma: string | null
}

/** Lo que `/v1/link/start` acepta del cuerpo. Nunca lanza: lo que no sirve es null. */
export function leerDatosDelPedido(body: Record<string, unknown>): DatosDelPedido {
  const nombre = typeof body.name === 'string'
    // eslint-disable-next-line no-control-regex
    ? body.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, LARGO_MAXIMO_DEL_NOMBRE).trim()
    : ''
  const plataforma = typeof body.platform === 'string' && PLATAFORMAS_CONOCIDAS.has(body.platform)
    ? body.platform
    : null
  return { nombre: nombre === '' ? null : nombre, plataforma }
}

export interface VinculacionIniciada {
  /** El que se muestra en pantalla. */
  codigoDeUsuario: string
  /** El secreto con el que se reclama el token. Nunca se muestra ni se guarda en claro. */
  codigoDeDispositivo: string
  /** Milisegundos de vida. */
  venceEn: number
  /** Cada cuánto conviene preguntar. */
  intervalo: number
}

export async function iniciarVinculacion(
  pool: Pool,
  ahora: number,
  datos: DatosDelPedido = { nombre: null, plataforma: null }
): Promise<VinculacionIniciada> {
  const codigoDeUsuario = generarCodigoDeUsuario()
  const codigoDeDispositivo = randomBytes(BYTES_DEL_CODIGO_DE_DISPOSITIVO).toString('base64url')
  await pool.query(
    `insert into link_requests (id, user_code, device_code_hash, created_at, expires_at, device_name, platform)
     values ($1, $2, $3, to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0), $6, $7)`,
    [randomUUID(), codigoDeUsuario, hashToken(codigoDeDispositivo), ahora, ahora + VIGENCIA_MS, datos.nombre, datos.plataforma]
  )
  return { codigoDeUsuario, codigoDeDispositivo, venceEn: VIGENCIA_MS, intervalo: INTERVALO_MS }
}

/** Cómo se busca un código que alguien tipeó: sin espacios alrededor y en mayúsculas. */
export function limpiarCodigoDeUsuario(codigo: string): string {
  return codigo.trim().toUpperCase()
}

/** Los tres "no" de un código tipeado, compartidos por `approve` y `check`. */
type CodigoNoUsable = { ok: false; status: 400 | 404 | 409; error: 'unknown_code' | 'expired' | 'already_approved' }

interface PedidoPendiente {
  userCode: string
  deviceName: string | null
  platform: string | null
  createdAt: Date
  expiresAt: Date
}

/**
 * Busca el pedido de un código tipeado y lo deja pasar sólo si sigue vivo y sin dueño. Una
 * sola escalera (404, 400, 409, en ese orden) para `approve` y `check`: así una página que
 * consulta y después aprueba nunca ve dos respuestas distintas para el mismo código.
 */
async function pedidoPendiente(
  pool: Pool,
  codigoDeUsuario: string,
  ahora: number
): Promise<{ ok: true; pedido: PedidoPendiente } | CodigoNoUsable> {
  const userCode = limpiarCodigoDeUsuario(codigoDeUsuario)
  const { rows } = await pool.query(
    `select user_id, device_name, platform, created_at, expires_at from link_requests where user_code = $1`,
    [userCode]
  )
  const fila = rows[0]
  if (!fila) return { ok: false, status: 404, error: 'unknown_code' }
  const expiresAt = new Date(fila.expires_at)
  if (expiresAt.getTime() <= ahora) return { ok: false, status: 400, error: 'expired' }
  // Aprobar dos veces con cuentas distintas no cambia de dueño. Sin esto, alguien que vea el
  // código en pantalla podría re-aprobarlo a su nombre y quedarse con la máquina del otro.
  if (fila.user_id) return { ok: false, status: 409, error: 'already_approved' }
  return {
    ok: true,
    pedido: {
      userCode,
      deviceName: fila.device_name ?? null,
      platform: fila.platform ?? null,
      createdAt: new Date(fila.created_at),
      expiresAt,
    },
  }
}

export type ResultadoDeAprobar = { ok: true } | CodigoNoUsable

/**
 * El usuario, desde una máquina donde SÍ tiene sesión, dice «ese código es mío».
 *
 * No emite nada: sólo ata el pedido a una cuenta. El token se emite recién cuando la otra
 * máquina lo reclama, y con los mismos controles que cualquier otro registro.
 *
 * Con `supabaseJwt`, antes de atar el pedido aplica la red de seguridad del plan pago tal
 * como `registerDevice` (Ruling P1): el claim corre sin JWT y no podría leer Supabase, así que
 * lo que `check` dio por bueno gracias a esa red tiene que quedar escrito acá.
 */
export async function aprobarVinculacion(
  pool: Pool,
  identidad: JwtIdentity,
  codigoDeUsuario: string,
  ahora: number,
  supabaseJwt?: string
): Promise<ResultadoDeAprobar> {
  const r = await pedidoPendiente(pool, codigoDeUsuario, ahora)
  if (!r.ok) return r

  await aplicarPlanPagoDeSupabase(pool, identidad, supabaseJwt)
  const { rowCount } = await pool.query(
    `update link_requests set user_id = $1, email = $2, approved_at = to_timestamp($3 / 1000.0)
      where user_code = $4 and user_id is null`,
    [identidad.userId, identidad.email, ahora, r.pedido.userCode]
  )
  // Otra aprobación concurrente pasó `pedidoPendiente` a la par y ató el pedido primero: ésta
  // no puede contestar ok, porque la página diría "connected" con la máquina en otra cuenta.
  if (rowCount === 0) return { ok: false, status: 409, error: 'already_approved' }
  return { ok: true }
}

export interface PedidoConsultado {
  deviceName: string | null
  platform: string | null
  createdAt: string
  expiresAt: string
  /** Segundos que le quedan, medidos con el reloj del SERVIDOR: el del navegador puede estar corrido. */
  expiresIn: number
  eligibility: Elegibilidad
  /** El plan efectivo de la cuenta (Ruling P3): la página adapta el copy del tope de máquinas. */
  plan: string
}

export type ResultadoDeConsultar = { ok: true; pedido: PedidoConsultado } | CodigoNoUsable

/**
 * `POST /v1/link/check`: lo que la página muestra ANTES de aprobar (spec §3 y §4.2). No toca
 * la fila ni crea nada; los errores salen de la misma escalera que en `aprobarVinculacion`.
 */
export async function consultarVinculacion(
  pool: Pool,
  identidad: JwtIdentity,
  codigoDeUsuario: string,
  ahora: number,
  supabaseJwt?: string
): Promise<ResultadoDeConsultar> {
  const r = await pedidoPendiente(pool, codigoDeUsuario, ahora)
  if (!r.ok) return r

  const { eligibility, plan } = await elegibilidadDeMaquinaNueva(pool, identidad, supabaseJwt)
  const { pedido } = r
  return {
    ok: true,
    pedido: {
      deviceName: pedido.deviceName,
      platform: pedido.platform,
      createdAt: pedido.createdAt.toISOString(),
      expiresAt: pedido.expiresAt.toISOString(),
      expiresIn: Math.max(0, Math.floor((pedido.expiresAt.getTime() - ahora) / 1000)),
      eligibility,
      plan,
    },
  }
}

export type ResultadoDeReclamar =
  | { estado: 'pendiente' }
  | { estado: 'muy-seguido' }
  /** Vencido, desconocido o ya consumido: los tres se contestan igual a propósito. */
  | { estado: 'vencido' }
  /** Aprobado por alguien que no pasa los controles (beta, plan, límite de dispositivos). */
  | { estado: 'rechazado'; error: string }
  | { estado: 'vinculado'; token: string; deviceId: string }

export async function reclamarVinculacion(
  pool: Pool,
  codigoDeDispositivo: string,
  ahora: number,
  nombreDelDispositivo = 'nest-memory (CLI)',
  /** La misma columna que llena `/v1/devices`. Opcional: un cliente viejo no la manda. */
  plataforma: string | null = null
): Promise<ResultadoDeReclamar> {
  const { rows } = await pool.query(
    `select id, user_id, email, consumed_at, last_polled_at, expires_at
       from link_requests where device_code_hash = $1`,
    [hashToken(codigoDeDispositivo)]
  )
  const fila = rows[0]
  // Un código que no existe se contesta igual que uno vencido: decir «ese no existe» le
  // confirma a quien esté probando al azar cuáles sí, y no le sirve de nada a un cliente
  // legítimo, que tiene el suyo.
  if (!fila) return { estado: 'vencido' }
  if (fila.consumed_at) return { estado: 'vencido' }
  if (new Date(fila.expires_at).getTime() <= ahora) return { estado: 'vencido' }

  const ultima = fila.last_polled_at ? new Date(fila.last_polled_at).getTime() : null
  if (ultima !== null && ahora - ultima < INTERVALO_MS) return { estado: 'muy-seguido' }
  await pool.query('update link_requests set last_polled_at = to_timestamp($1 / 1000.0) where id = $2', [ahora, fila.id])

  if (!fila.user_id) return { estado: 'pendiente' }

  const alta = await registerDevice(
    pool,
    { userId: fila.user_id, email: fila.email ?? null },
    { name: nombreDelDispositivo, platform: plataforma }
  )
  if (!alta.ok) return { estado: 'rechazado', error: alta.error }

  // Se marca consumido DESPUÉS de emitir: si el alta falla, el pedido sigue vivo y el usuario
  // puede reintentar sin volver a empezar. Y se emite una sola vez, porque un código que
  // entrega tokens indefinidamente es una credencial permanente con nombre de temporal.
  await pool.query('update link_requests set consumed_at = to_timestamp($1 / 1000.0) where id = $2', [ahora, fila.id])
  return { estado: 'vinculado', token: alta.token, deviceId: alta.deviceId }
}

/** Barre los pedidos vencidos. No es crítico: la unicidad la dan los índices, no la limpieza. */
export async function barrerVinculacionesVencidas(pool: Pool, ahora: number): Promise<number> {
  const r = await pool.query('delete from link_requests where expires_at <= to_timestamp($1 / 1000.0)', [ahora])
  return r.rowCount ?? 0
}
