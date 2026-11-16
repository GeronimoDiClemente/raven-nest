import { firmarAviso, type ConfigDeAviso } from '../_shared/aviso-de-plan.ts'
import { TRIAL_DIAS } from './pricing.ts'

/**
 * `GET /api/internal/metrics`: las métricas de producto, sacadas sólo de lo que ya se guarda.
 *
 * Dos fuentes, y cada una dice lo suyo:
 * - Supabase: cuentas, uso de la app (`user_last_activity`) y conversión de trial (`profiles`).
 * - El servicio de sync: activación, segunda máquina y vuelta (`POST /internal/metrics`).
 *
 * El sync puede no contestar (sin config, caído): esa parte vuelve `null` con el motivo y el
 * resto se responde igual. Un cero ahí diría "nadie activó", que es mentira.
 */

const DIA_MS = 24 * 60 * 60 * 1000

/** Los planes que se cobran. `free` es el único que no. */
const PLANES_PAGOS: ReadonlySet<string> = new Set(['cloud', 'pro', 'team', 'enterprise'])

/** Meses de cohorte de trial que se devuelven, el más nuevo primero. */
export const MESES_DE_TRIAL = 6

export interface PerfilDeTrial {
  plan: string | null
  trial_started_at: string | null
}

export interface CohorteDeTrial {
  /** `YYYY-MM` (UTC) del inicio del trial. */
  mes: string
  empezaron: number
  /** Los que ya terminaron los 15 días: el denominador honesto de la conversión. */
  terminaron: number
  /** De los que terminaron, los que hoy están en un plan pago. */
  pagan: number
}

export interface Conversion {
  en_trial: number
  terminaron: number
  pagan: number
  /** `pagan / terminaron`, o `null` sin trials terminados (0% sería otra afirmación). */
  tasa: number | null
  cohortes: CohorteDeTrial[]
}

/**
 * Puro. La conversión mira el plan de HOY: quien pagó y canceló ya no cuenta, y quien pagó sin
 * pasar por un trial (perfil sin `trial_started_at`) no entra en ningún denominador.
 */
export function resumirConversion(perfiles: PerfilDeTrial[], ahora: Date): Conversion {
  const plazo = TRIAL_DIAS * DIA_MS
  const conTrial = perfiles.flatMap((p) => {
    if (!p.trial_started_at) return []
    const inicio = new Date(p.trial_started_at)
    if (Number.isNaN(inicio.getTime())) return []
    return [{
      inicio,
      termino: ahora.getTime() - inicio.getTime() >= plazo,
      paga: PLANES_PAGOS.has(p.plan ?? 'free'),
    }]
  })

  const cohortes: CohorteDeTrial[] = []
  for (let i = 0; i < MESES_DE_TRIAL; i++) {
    const desde = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - i, 1)
    const hasta = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - i + 1, 1)
    const de = conTrial.filter((t) => t.inicio.getTime() >= desde && t.inicio.getTime() < hasta)
    const terminados = de.filter((t) => t.termino)
    cohortes.push({
      mes: new Date(desde).toISOString().slice(0, 7),
      empezaron: de.length,
      terminaron: terminados.length,
      pagan: terminados.filter((t) => t.paga).length,
    })
  }

  const terminaron = conTrial.filter((t) => t.termino)
  const pagan = terminaron.filter((t) => t.paga).length
  return {
    // Un trial corriendo de alguien que ya pagó no está "en trial": ya convirtió.
    en_trial: conTrial.filter((t) => !t.termino && !t.paga).length,
    terminaron: terminaron.length,
    pagan,
    tasa: terminaron.length > 0 ? pagan / terminaron.length : null,
    cohortes,
  }
}

export interface UsoDeLaApp {
  cuentas: number
  activas_7d: number
  activas_30d: number
}

/** Puro. `ultimos` son los `last_refresh_at` de `user_last_activity`, uno por cuenta. */
export function resumirUso(cuentas: number, ultimos: (string | null)[], ahora: Date): UsoDeLaApp {
  const desde = (dias: number) => ahora.getTime() - dias * DIA_MS
  const activas = (dias: number) => ultimos.filter((u) => {
    if (!u) return false
    const t = new Date(u).getTime()
    return !Number.isNaN(t) && t >= desde(dias)
  }).length
  return { cuentas, activas_7d: activas(7), activas_30d: activas(30) }
}

const TIMEOUT_MS = 10_000

export type ResultadoDelSync =
  | { ok: true; metricas: Record<string, unknown> }
  | { ok: false; motivo: string }

/**
 * Le pide los agregados al servicio de sync, firmado igual que el aviso de plan. El cuerpo
 * `{"consulta":"metricas"}` es lo que el servidor exige para esta ruta: ata la firma a esta
 * consulta y no a cualquier ruta interna.
 */
export async function pedirMetricasDelSync(
  fetchImpl: typeof fetch,
  config: ConfigDeAviso | null,
  ahoraSeg: number,
): Promise<ResultadoDelSync> {
  if (!config) return { ok: false, motivo: 'sin_config' }
  const cuerpo = JSON.stringify({ consulta: 'metricas' })
  try {
    const res = await fetchImpl(`${config.url.replace(/\/+$/, '')}/internal/metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Nest-Signature': await firmarAviso(config.secreto, cuerpo, ahoraSeg) },
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false, motivo: `HTTP ${res.status}` }
    const body = await res.json().catch(() => null) as { metricas?: unknown } | null
    const metricas = body?.metricas
    if (!metricas || typeof metricas !== 'object' || Array.isArray(metricas)) {
      return { ok: false, motivo: 'respuesta_invalida' }
    }
    return { ok: true, metricas: metricas as Record<string, unknown> }
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) }
  }
}
