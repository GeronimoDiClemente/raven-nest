import type { Pool } from 'pg'

/**
 * Las métricas de producto del back-office (punto 8 de la revisión del 06-nov), sacadas sólo de
 * lo que la base ya guarda: no hay un evento nuevo ni un dato más del usuario. Lo que sale de
 * acá son CONTEOS — ningún id, email ni contenido viaja en la respuesta.
 *
 * La actividad se mide con `devices.last_seen_at`, que `authenticate` toca en cada request de
 * sync. No hay historial de actividad, sólo la última vez: "volvió a los N días" significa que
 * la cuenta todavía se usaba N días después de registrar su primera máquina, no que se usó el
 * día N. Es una cota de supervivencia, y es lo más honesto que se puede decir sin telemetría.
 */

const DIA_MS = 24 * 60 * 60 * 1000

/** Las marcas de "volvió": al día siguiente, a la semana y al mes. */
export const VUELTAS_DIAS = [1, 7, 30] as const

/** Cuántas cohortes semanales se devuelven, la más nueva primero. */
export const SEMANAS_DE_COHORTE = 8

/** Una cuenta, como la ve la consulta. El id no sale de este módulo: `resumirMetricas` sólo cuenta. */
export type FilaDeCuenta = {
  userId: string
  primera: Date
  ultima: Date | null
  ultimaActiva: Date | null
  maquinas: number
  guardoMemoria: boolean
}

/** `elegibles` son las cuentas que ya tuvieron N días para volver; `volvieron`, las que lo hicieron. */
export type Vuelta = { dias: number; elegibles: number; volvieron: number }

export type Cohorte = {
  /** El lunes (UTC) de la semana en que la cuenta registró su primera máquina. */
  semana: string
  cuentas: number
  activadas: number
  segunda_maquina: number
  vueltas: Vuelta[]
}

export type MetricasDelSync = {
  generado_at: string
  /** Cuentas con al menos una máquina registrada en la nube. */
  cuentas: number
  /** De ésas, las que subieron al menos una memoria. */
  activadas: number
  /** Las que registraron dos máquinas o más (revocadas incluidas: fueron una segunda máquina). */
  segunda_maquina: number
  /** Cuentas con una máquina no revocada que habló con el servicio en los últimos 7 / 30 días. */
  activas_7d: number
  activas_30d: number
  vueltas: Vuelta[]
  cohortes: Cohorte[]
}

/** El lunes 00:00 UTC de la semana de `d`. */
export function lunesDe(d: Date): Date {
  const dia = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const desdeLunes = (dia.getUTCDay() + 6) % 7
  return new Date(dia.getTime() - desdeLunes * DIA_MS)
}

function vueltas(filas: FilaDeCuenta[], ahora: Date): Vuelta[] {
  return VUELTAS_DIAS.map((dias) => {
    const plazo = dias * DIA_MS
    // Una cuenta de ayer no "dejó de volver a la semana": todavía no tuvo la semana.
    const elegibles = filas.filter((f) => ahora.getTime() - f.primera.getTime() >= plazo)
    const volvieron = elegibles.filter((f) => f.ultima && f.ultima.getTime() - f.primera.getTime() >= plazo)
    return { dias, elegibles: elegibles.length, volvieron: volvieron.length }
  })
}

/** Puro: de las filas por cuenta a los agregados. Todo lo que se decide se decide acá. */
export function resumirMetricas(filas: FilaDeCuenta[], ahora: Date): MetricasDelSync {
  const hace = (dias: number) => ahora.getTime() - dias * DIA_MS
  const activasDesde = (desde: number) =>
    filas.filter((f) => f.ultimaActiva && f.ultimaActiva.getTime() >= desde).length

  const lunesActual = lunesDe(ahora).getTime()
  const cohortes: Cohorte[] = []
  for (let i = 0; i < SEMANAS_DE_COHORTE; i++) {
    const inicio = lunesActual - i * 7 * DIA_MS
    const fin = inicio + 7 * DIA_MS
    const de = filas.filter((f) => f.primera.getTime() >= inicio && f.primera.getTime() < fin)
    cohortes.push({
      semana: new Date(inicio).toISOString().slice(0, 10),
      cuentas: de.length,
      activadas: de.filter((f) => f.guardoMemoria).length,
      segunda_maquina: de.filter((f) => f.maquinas >= 2).length,
      vueltas: vueltas(de, ahora),
    })
  }

  return {
    generado_at: ahora.toISOString(),
    cuentas: filas.length,
    activadas: filas.filter((f) => f.guardoMemoria).length,
    segunda_maquina: filas.filter((f) => f.maquinas >= 2).length,
    activas_7d: activasDesde(hace(7)),
    activas_30d: activasDesde(hace(30)),
    vueltas: vueltas(filas, ahora),
    cohortes,
  }
}

/**
 * Una fila por cuenta con máquina. La cuenta que sólo existe por un aviso de plan (pagó y
 * nunca conectó una máquina) no entra: para el sync todavía no empezó.
 *
 * `guardoMemoria` mira `author_id` sin filtrar borrados: una memoria que después se borró
 * igual prueba que la cuenta llegó a guardar. El `distinct` va en una subconsulta aparte para
 * recorrer `observations` una sola vez y no una por cuenta.
 */
export async function filasPorCuenta(pool: Pool): Promise<FilaDeCuenta[]> {
  const { rows } = await pool.query(
    `with autores as (select distinct author_id from observations)
     select d.user_id,
            min(d.created_at) as primera,
            max(d.last_seen_at) as ultima,
            max(d.last_seen_at) filter (where d.revoked_at is null) as ultima_activa,
            count(*)::int as maquinas,
            bool_or(a.author_id is not null) as guardo_memoria
       from devices d
       left join autores a on a.author_id = d.user_id
      group by d.user_id`,
  )
  return rows.map((r) => ({
    userId: r.user_id,
    primera: new Date(r.primera),
    ultima: r.ultima ? new Date(r.ultima) : null,
    ultimaActiva: r.ultima_activa ? new Date(r.ultima_activa) : null,
    maquinas: r.maquinas,
    guardoMemoria: r.guardo_memoria === true,
  }))
}

export async function calcularMetricas(pool: Pool, ahora = new Date()): Promise<MetricasDelSync> {
  return resumirMetricas(await filasPorCuenta(pool), ahora)
}

/**
 * Lo que tiene que decir el cuerpo firmado de `POST /internal/metrics`. Sin esto, la firma de un
 * `{}` vale para cualquier ruta interna que acepte un cuerpo vacío: el campo ata la firma a
 * esta consulta.
 */
export const PEDIDO_DE_METRICAS = 'metricas'

export function esPedidoDeMetricas(cuerpo: string): boolean {
  try {
    const parsed = JSON.parse(cuerpo) as { consulta?: unknown } | null
    return parsed !== null && typeof parsed === 'object' && parsed.consulta === PEDIDO_DE_METRICAS
  } catch {
    return false
  }
}
