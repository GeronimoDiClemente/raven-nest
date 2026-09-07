import { AwsClient } from 'aws4fetch'

/**
 * Cloudflare R2 por su API compatible con S3. Elegido sobre Supabase Storage por radio de
 * daño: el token de R2 se acota a un solo bucket, mientras que la `service_role` de Supabase
 * —la única credencial que sirve para subir ahí— abre todo Supabase, y meterla en un
 * contenedor es regalar las llaves.
 *
 * Se firma con `aws4fetch` (65 KB, cero dependencias) en vez del SDK de AWS, en un contenedor
 * que hoy tiene dos dependencias en total.
 */
export type R2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

/** `null` —no una excepción— cuando R2 no está configurado: no tenerlo es un estado válido. */
export function r2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID
  const accessKeyId = env.R2_ACCESS_KEY_ID
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY
  const bucket = env.R2_BUCKET
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return { accountId, accessKeyId, secretAccessKey, bucket }
}

function clientFor(cfg: R2Config): AwsClient {
  // `region: 'auto'` es lo que R2 espera; el servicio tiene que ser 's3' para que aws4fetch
  // calcule y mande `x-amz-content-sha256`, que R2 exige en toda request con cuerpo.
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    region: 'auto',
  })
}

function bucketUrl(cfg: R2Config): string {
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}`
}

/** El cuerpo del error viaja en el mensaje: sin él, un 403 de R2 no dice si es el token, el bucket o la firma. */
async function ensureOk(res: Response, que: string): Promise<void> {
  if (res.ok) return
  const cuerpo = await res.text().catch(() => '')
  throw new Error(`R2 ${que} falló: ${res.status} ${res.statusText} ${cuerpo}`.trim())
}

export async function putObject(
  cfg: R2Config,
  key: string,
  body: Uint8Array,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch
  const req = await clientFor(cfg).sign(`${bucketUrl(cfg)}/${key}`, {
    method: 'PUT',
    // `BodyInit` exige un `Uint8Array<ArrayBuffer>` y rechaza el `ArrayBufferLike` genérico,
    // porque ese incluye `SharedArrayBuffer`, que efectivamente no se puede mandar por red.
    // Todo lo que llega acá sale de `pg_dump` o de `readFile`: siempre un ArrayBuffer común.
    body: body as Uint8Array<ArrayBuffer>,
    headers: { 'content-type': 'application/octet-stream' },
  })
  await ensureOk(await doFetch(req), `PUT ${key}`)
}

export async function getObject(
  cfg: R2Config,
  key: string,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<Uint8Array> {
  const doFetch = opts.fetchImpl ?? fetch
  const req = await clientFor(cfg).sign(`${bucketUrl(cfg)}/${key}`, { method: 'GET' })
  const res = await doFetch(req)
  await ensureOk(res, `GET ${key}`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Las claves ordenadas lexicográficamente, que —por cómo se nombran, con el timestamp
 * adelante— es lo mismo que ordenadas por fecha.
 *
 * Una respuesta truncada TIRA en vez de devolver la primera página. Con 30 días de retención
 * nunca deberíamos acercarnos a las 1000 claves de un page, pero si algún día pasa, devolver
 * media lista significa que "el último backup" sería el último de la primera página: se
 * restauraría un dump viejo creyendo que es el de anoche. Ese error es peor que un fallo.
 */
export async function listKeys(
  cfg: R2Config,
  prefix: string,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<string[]> {
  const doFetch = opts.fetchImpl ?? fetch
  const url = `${bucketUrl(cfg)}?list-type=2&prefix=${encodeURIComponent(prefix)}`
  const req = await clientFor(cfg).sign(url, { method: 'GET' })
  const res = await doFetch(req)
  await ensureOk(res, `LIST ${prefix}`)
  const xml = await res.text()
  if (/<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml)) {
    throw new Error(`R2 LIST ${prefix}: la respuesta vino truncada; "el último backup" sería incorrecto`)
  }
  return [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1]).sort()
}
