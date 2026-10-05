import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Pool } from 'pg'
import { AwsClient } from 'aws4fetch'
import { authenticate } from './auth'
import { getObject, type R2Config } from './r2'

/**
 * La beta cerrada de Nest se reparte desde acá y no desde GitHub (2026-10-05).
 *
 * El repo es público: una prerelease de GitHub la ve cualquiera. Los instaladores van a un
 * bucket PRIVADO de R2 (`R2_BETAS_BUCKET`, distinto del de backups: aquél tiene una regla de
 * ciclo de vida que borraría las betas) y este servicio los entrega sólo a cuentas que están
 * en el allowlist — el mismo que decide quién usa la nube.
 *
 * Dos puertas, una por momento:
 *
 * - **La primera instalación** no tiene Nest todavía, así que no tiene token. Gero le manda a
 *   cada tester un LINK PERSONAL (`/beta/<link>`), firmado con `BETA_LINK_SECRET`, atado a su
 *   cuenta y con vencimiento. El allowlist se mira al usarlo, no al firmarlo: sacar a alguien
 *   de la lista corta su link en el acto.
 * - **Las actualizaciones** las pide la app instalada, con el token de su device
 *   (`/v1/beta/update/<archivo>`), que `authenticate` ya valida contra el allowlist.
 *
 * Ninguna de las dos pasa los instaladores por este proceso: los `.yml` del canal (unos pocos
 * KB) se leen y se devuelven, y los binarios son un 302 a una URL prefirmada de R2 que vence
 * en minutos. electron-updater saca solo el header `authorization` cuando el destino de un
 * redirect trae `X-Amz-Credential`, así que el token del device no viaja a R2.
 */

export type BetasConfig = R2Config & { linkSecret: string }

/** `null` cuando falta algo: sin bucket o sin secreto la beta no se reparte, y el resto del servicio anda igual. */
export function betasConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BetasConfig | null {
  const accountId = env.R2_ACCOUNT_ID
  const accessKeyId = env.R2_ACCESS_KEY_ID
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY
  const bucket = env.R2_BETAS_BUCKET
  const linkSecret = env.BETA_LINK_SECRET ?? ''
  // Un secreto corto se adivina por fuerza bruta offline a partir de un link cualquiera.
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || linkSecret.length < 32) return null
  return { accountId, accessKeyId, secretAccessKey, bucket, linkSecret }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function firma(secreto: string, cuerpo: string): string {
  return createHmac('sha256', secreto).update(`nest-beta-link:${cuerpo}`).digest('base64url')
}

/** El link personal: `<userId>.<vence en ms>.<hmac>`. Sin nada secreto adentro: el userId no es una credencial. */
export function firmarLinkDeBeta(secreto: string, userId: string, venceMs: number): string {
  if (!UUID.test(userId)) throw new Error('userId tiene que ser el uuid de la cuenta')
  const cuerpo = `${userId.toLowerCase()}.${Math.floor(venceMs)}`
  return `${cuerpo}.${firma(secreto, cuerpo)}`
}

/** El userId del link, o `null` si está mal formado, adulterado o vencido. */
export function verificarLinkDeBeta(secreto: string, link: string, ahoraMs: number): string | null {
  const partes = link.split('.')
  if (partes.length !== 3) return null
  const [userId, vence, mac] = partes
  if (!UUID.test(userId) || !/^\d{1,15}$/.test(vence)) return null
  const esperada = Buffer.from(firma(secreto, `${userId}.${vence}`))
  const recibida = Buffer.from(mac)
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null
  if (Number(vence) <= ahoraMs) return null
  return userId
}

/**
 * Los archivos que el canal puede servir. Un nombre plano, sin barras: lo que llega en la URL
 * se usa como clave del bucket, y una clave con `../` o `/` podría salir del canal.
 */
export function esArchivoDeBeta(nombre: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(nombre) && !nombre.includes('..')
}

/** Los metadatos del canal (`latest.yml`, `latest-mac.yml`, ...): se devuelven, no se redirigen. */
export function esFeedDelUpdater(nombre: string): boolean {
  return /^latest(-[a-z0-9]+)*\.yml$/.test(nombre)
}

/** Una URL de R2 que deja bajar UN objeto durante `segundos`, sin credenciales. */
export async function urlPrefirmada(cfg: R2Config, key: string, segundos = 300): Promise<string> {
  const url = new URL(`https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${key}`)
  url.searchParams.set('X-Amz-Expires', String(segundos))
  const firmada = await new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    region: 'auto',
  }).sign(url.toString(), { method: 'GET', aws: { signQuery: true } })
  return firmada.url
}

/** Lo que CI deja junto a los instaladores para armar la página de descarga. */
export type ManifiestoDeBeta = {
  version: string
  files: Array<{ name: string; os: 'windows' | 'mac' | 'linux'; label: string }>
}

export function parsearManifiesto(bytes: Uint8Array): ManifiestoDeBeta | null {
  try {
    const m = JSON.parse(Buffer.from(bytes).toString('utf8'))
    if (typeof m?.version !== 'string' || !Array.isArray(m.files)) return null
    const files = m.files.filter(
      (f: unknown): f is ManifiestoDeBeta['files'][number] =>
        typeof (f as { name?: unknown })?.name === 'string' &&
        esArchivoDeBeta((f as { name: string }).name) &&
        ['windows', 'mac', 'linux'].includes((f as { os?: string }).os ?? '') &&
        typeof (f as { label?: unknown }).label === 'string'
    )
    return { version: m.version, files }
  } catch {
    return null
  }
}

function escapar(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const SISTEMAS: Record<ManifiestoDeBeta['files'][number]['os'], string> = {
  windows: 'Windows',
  mac: 'macOS',
  linux: 'Linux',
}

/** La página del link personal. Sin scripts y sin nada externo: sólo links. */
export function htmlDeDescarga(manifiesto: ManifiestoDeBeta, link: string): string {
  const filas = (['windows', 'mac', 'linux'] as const)
    .map((os) => {
      const archivos = manifiesto.files.filter((f) => f.os === os)
      if (archivos.length === 0) return ''
      const items = archivos
        .map((f) => `<li><a href="/beta/${escapar(link)}/${escapar(f.name)}">${escapar(f.label)}</a> <span>${escapar(f.name)}</span></li>`)
        .join('')
      return `<h2>${SISTEMAS[os]}</h2><ul>${items}</ul>`
    })
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Nest beta</title><style>
:root{color-scheme:light dark;--bg:#fafafa;--fg:#111;--muted:#666;--line:#ddd}
@media (prefers-color-scheme:dark){:root{--bg:#0d0d0d;--fg:#eee;--muted:#999;--line:#333}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:560px;margin:0 auto;padding:40px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px}
p{color:var(--muted);margin:0}ul{list-style:none;padding:0;margin:0}li{padding:10px 0;border-top:1px solid var(--line)}
a{color:inherit;font-weight:600}span{display:block;color:var(--muted);font-size:13px;word-break:break-all}
</style></head><body><main><h1>Nest ${escapar(manifiesto.version)}</h1><p>Private beta. This link is yours — please don't share it.</p>${filas}</main></body></html>`
}

function responder(res: ServerResponse, status: number, cuerpo: string, tipo: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    ...extra,
    'Content-Type': tipo,
    'Content-Length': Buffer.byteLength(cuerpo),
    // Nada de esto se cachea en el camino: la respuesta depende de quién pide y de si sigue en la lista.
    'Cache-Control': 'no-store',
  })
  res.end(cuerpo)
}

async function estaEnElAllowlist(pool: Pool, userId: string): Promise<boolean> {
  const { rows } = await pool.query('select 1 from allowlist where user_id = $1', [userId])
  return rows.length > 0
}

/** Un archivo del canal: el feed se devuelve, el resto es un 302 a R2. */
async function servirArchivo(cfg: BetasConfig, nombre: string, res: ServerResponse, deps: DepsDeBetas): Promise<void> {
  if (esFeedDelUpdater(nombre)) {
    const bytes = await deps.leer(cfg, nombre)
    if (!bytes) return responder(res, 404, 'not found', 'text/plain')
    return responder(res, 200, Buffer.from(bytes).toString('utf8'), 'text/yaml; charset=utf-8')
  }
  res.writeHead(302, { Location: await deps.prefirmar(cfg, nombre), 'Cache-Control': 'no-store' })
  res.end()
}

export interface DepsDeBetas {
  config: () => BetasConfig | null
  ahora: () => number
  /** El objeto, o `null` si no existe. */
  leer: (cfg: BetasConfig, key: string) => Promise<Uint8Array | null>
  prefirmar: (cfg: BetasConfig, key: string) => Promise<string>
}

export const depsDeBetasReales: DepsDeBetas = {
  config: () => betasConfigFromEnv(),
  ahora: () => Date.now(),
  leer: async (cfg, key) => {
    try {
      return await getObject(cfg, key)
    } catch (err) {
      // Un 404 de R2 es "todavía no hay beta publicada", no una falla del servicio.
      if (err instanceof Error && /\b404\b/.test(err.message)) return null
      throw err
    }
  },
  prefirmar: (cfg, key) => urlPrefirmada(cfg, key),
}

/**
 * `/beta/<link>`, `/beta/<link>/<archivo>` y `/v1/beta/update/<archivo>`. Devuelve `false` si
 * la ruta no es de la beta, para que `handleRequest` siga con las demás.
 *
 * Toda negativa es un 404 igual: un link vencido, adulterado o de alguien que salió de la
 * lista no le dice a quien lo prueba cuál de las tres cosas falló.
 */
export async function handleBeta(
  pool: Pool,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  deps: DepsDeBetas = depsDeBetasReales
): Promise<boolean> {
  const update = path.match(/^\/v1\/beta\/update\/([^/]+)$/)
  const pagina = path.match(/^\/beta\/([^/]+)\/?$/)
  const descarga = path.match(/^\/beta\/([^/]+)\/([^/]+)$/)
  if (!update && !pagina && !descarga) return false

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    responder(res, 405, 'method not allowed', 'text/plain', { Allow: 'GET' })
    return true
  }
  const cfg = deps.config()
  if (!cfg) {
    responder(res, 503, 'beta distribution is not configured', 'text/plain')
    return true
  }
  const noEncontrado = () => responder(res, 404, 'not found', 'text/plain')

  if (update) {
    const nombre = decodeURIComponent(update[1])
    if (!esArchivoDeBeta(nombre)) { noEncontrado(); return true }
    const auth = await authenticate(pool, req.headers.authorization)
    if (!auth.ok) {
      responder(res, auth.status, auth.error, 'text/plain')
      return true
    }
    await servirArchivo(cfg, nombre, res, deps)
    return true
  }

  const link = decodeURIComponent((pagina ?? descarga)![1])
  const userId = verificarLinkDeBeta(cfg.linkSecret, link, deps.ahora())
  if (!userId || !(await estaEnElAllowlist(pool, userId))) { noEncontrado(); return true }

  if (descarga) {
    const nombre = decodeURIComponent(descarga[2])
    if (!esArchivoDeBeta(nombre)) { noEncontrado(); return true }
    await servirArchivo(cfg, nombre, res, deps)
    return true
  }

  const bytes = await deps.leer(cfg, 'manifest.json')
  const manifiesto = bytes ? parsearManifiesto(bytes) : null
  if (!manifiesto) {
    responder(res, 503, 'No beta has been published yet. Check back soon.', 'text/plain')
    return true
  }
  responder(res, 200, htmlDeDescarga(manifiesto, link), 'text/html; charset=utf-8')
  return true
}
