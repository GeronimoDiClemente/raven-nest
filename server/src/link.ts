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
import { registerDevice, type JwtIdentity } from './devices'

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

export async function iniciarVinculacion(pool: Pool, ahora: number): Promise<VinculacionIniciada> {
  const codigoDeUsuario = generarCodigoDeUsuario()
  const codigoDeDispositivo = randomBytes(BYTES_DEL_CODIGO_DE_DISPOSITIVO).toString('base64url')
  await pool.query(
    `insert into link_requests (id, user_code, device_code_hash, created_at, expires_at)
     values ($1, $2, $3, to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0))`,
    [randomUUID(), codigoDeUsuario, hashToken(codigoDeDispositivo), ahora, ahora + VIGENCIA_MS]
  )
  return { codigoDeUsuario, codigoDeDispositivo, venceEn: VIGENCIA_MS, intervalo: INTERVALO_MS }
}

export type ResultadoDeAprobar =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; error: 'unknown_code' | 'expired' | 'already_approved' }

/**
 * El usuario, desde una máquina donde SÍ tiene sesión, dice «ese código es mío».
 *
 * No emite nada: sólo ata el pedido a una cuenta. El token se emite recién cuando la otra
 * máquina lo reclama, y con los mismos controles que cualquier otro registro.
 */
export async function aprobarVinculacion(
  pool: Pool,
  identidad: JwtIdentity,
  codigoDeUsuario: string,
  ahora: number
): Promise<ResultadoDeAprobar> {
  const { rows } = await pool.query(
    `select user_id, expires_at from link_requests where user_code = $1`,
    [codigoDeUsuario.trim().toUpperCase()]
  )
  const fila = rows[0]
  if (!fila) return { ok: false, status: 404, error: 'unknown_code' }
  if (new Date(fila.expires_at).getTime() <= ahora) return { ok: false, status: 400, error: 'expired' }
  // Aprobar dos veces con cuentas distintas no cambia de dueño. Sin esto, alguien que vea el
  // código en pantalla podría re-aprobarlo a su nombre y quedarse con la máquina del otro.
  if (fila.user_id) return { ok: false, status: 409, error: 'already_approved' }

  await pool.query(
    `update link_requests set user_id = $1, email = $2, approved_at = to_timestamp($3 / 1000.0)
      where user_code = $4 and user_id is null`,
    [identidad.userId, identidad.email, ahora, codigoDeUsuario.trim().toUpperCase()]
  )
  return { ok: true }
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
  nombreDelDispositivo = 'nest-memory (CLI)'
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
    { name: nombreDelDispositivo }
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
