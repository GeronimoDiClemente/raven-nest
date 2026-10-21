/**
 * Spec 2b-2 §4.4/§4.5: el aviso al servidor de sync. Puro salvo por el `fetch` que se inyecta:
 * WebCrypto (`crypto.subtle`) existe igual en Deno y en Node, así que se testea con vitest.
 *
 * Se manda lo que quedó en `profiles`, no lo que dice el evento: aunque Stripe entregue
 * eventos repetidos o desordenados, cada aviso lleva la verdad del momento y el servidor
 * converge a Supabase.
 */
export interface ConfigDeAviso {
  /** La BASE del servicio de sync (D5); acá se le suma `/internal/plan`. */
  url: string
  secreto: string
}

/** `status` sólo cuando el servidor contestó (no-2xx); sin él fue red, timeout o similar. */
export type ResultadoDeAviso = { ok: true } | { ok: false; motivo: string; status?: number }

/** Qué hacer con el evento de Stripe según cómo salió el aviso (ruling P9). */
export type Desenlace = 'ok' | 'reintentar' | 'descartar'

export function configDeAviso(env: { PLAN_SYNC_URL?: string; PLAN_SYNC_SECRET?: string }): ConfigDeAviso | null {
  const url = env.PLAN_SYNC_URL?.trim()
  const secreto = env.PLAN_SYNC_SECRET?.trim()
  if (!url || !secreto) return null
  return { url, secreto }
}

/** `t=<t>,v1=<hex de HMAC-SHA256(secreto, "<t>.<cuerpo>")>`. */
export async function firmarAviso(secreto: string, cuerpo: string, t: number): Promise<string> {
  const codificador = new TextEncoder()
  const clave = await crypto.subtle.importKey('raw', codificador.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const firma = await crypto.subtle.sign('HMAC', clave, codificador.encode(`${t}.${cuerpo}`))
  const hex = [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `t=${t},v1=${hex}`
}

const TIMEOUT_MS = 10_000

export async function avisarPlan(
  fetchImpl: typeof fetch,
  config: ConfigDeAviso,
  userId: string,
  plan: string,
  ahoraSeg: number,
): Promise<ResultadoDeAviso> {
  // Se firma exactamente el string que viaja como body: el servidor verifica sobre los bytes crudos.
  const cuerpo = JSON.stringify({ user_id: userId, plan })
  try {
    const res = await fetchImpl(`${config.url.replace(/\/+$/, '')}/internal/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Nest-Signature': await firmarAviso(config.secreto, cuerpo, ahoraSeg) },
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.ok ? { ok: true } : { ok: false, motivo: `HTTP ${res.status}`, status: res.status }
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Ruling P9 (desvío acotado del spec §4.4): un 400 es un dato determinísticamente inválido
 * (user_id que no es uuid, plan desconocido) y reintentarlo durante días no lo arregla: se
 * descarta (el llamador lo loguea y le contesta 200 a Stripe). Todo lo demás —401/404 (config
 * mal puesta, se arregla dentro de la ventana de reintentos), 5xx, red, timeout y la falta de
 * config (`null`)— se reintenta: un pago que no llega a la nube no se traga en silencio.
 */
export function clasificarAviso(r: ResultadoDeAviso | null): Desenlace {
  if (r === null) return 'reintentar'
  if (r.ok) return 'ok'
  return r.status === 400 ? 'descartar' : 'reintentar'
}

/**
 * Ruling T5a: la baja a free se hace en dos pasos para que el reintento de Stripe vuelva a
 * encontrar las filas. Primero se baja `plan` CONSERVANDO `stripe_subscription_id`, se avisa a
 * cada usuario y sólo si ningún aviso pide reintento se limpia la suscripción. Si alguno pide
 * reintento: 500 sin limpiar, y la próxima entrega repite todo (los pasos son idempotentes).
 * Sin filas afectadas no hay nada que avisar ni limpiar: 200.
 */
export function resolverBaja(desenlaces: Desenlace[]): { limpiar: boolean; status: 200 | 500 } {
  if (desenlaces.length === 0) return { limpiar: false, status: 200 }
  if (desenlaces.includes('reintentar')) return { limpiar: false, status: 500 }
  return { limpiar: true, status: 200 }
}
