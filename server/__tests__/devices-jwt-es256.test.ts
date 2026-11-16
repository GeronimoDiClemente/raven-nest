// El JWT de Supabase cuando el proyecto firma con CLAVES ASIMÉTRICAS.
//
// `devices-jwt.test.ts` cubre el camino HS256, que es el que Supabase usaba cuando se
// escribió el servicio. El proyecto real ya no firma así: los tokens de sesión que emite
// `qkqlsytxtshgjxwmafpw.supabase.co` traen `alg: ES256` y un `kid` que resuelve contra
// `/auth/v1/.well-known/jwks.json`. Verificado el 2026-09-21 contra un token real de la app y
// contra el JWKS publicado.
//
// O sea que sin esto `/v1/devices` y `/v1/link/approve` rechazan TODO login legítimo, y no
// hay secreto que lo arregle: el secreto simétrico ya no firma nada.
import { describe, it, expect } from 'vitest'
import { createHmac, createSign, generateKeyPairSync, type JsonWebKey, type KeyObject } from 'node:crypto'
import { verificarJwtDeSupabase, type ClavesDeFirma } from '../src/devices'

const NOW = 1_756_900_000_000 // ms
const SECRET = 'super-secret-jwt-secret-de-prueba'

const par = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const otroPar = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const parRsa = generateKeyPairSync('rsa', { modulusLength: 2048 })

const KID = 'ec318fd8-53a0-440c-914f-b5167db93c5f'

function jwkDe(clave: KeyObject, kid: string, extra: Record<string, unknown> = {}): JsonWebKey {
  return { ...clave.export({ format: 'jwk' }), kid, use: 'sig', alg: 'ES256', ...extra } as JsonWebKey
}

/** Un emisor que conoce una sola clave, como el JWKS de un proyecto sin rotación en curso. */
function clavesCon(jwk: JsonWebKey | null): ClavesDeFirma {
  return { paraKid: async (kid) => (jwk && (jwk as { kid?: string }).kid === kid ? jwk : null) }
}

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function firmarEs256(
  payload: Record<string, unknown>,
  opts: { clave?: KeyObject; kid?: string | null; alg?: string } = {},
): string {
  const cabecera: Record<string, unknown> = { alg: opts.alg ?? 'ES256', typ: 'JWT' }
  if (opts.kid !== null) cabecera.kid = opts.kid ?? KID
  const header = b64url(cabecera)
  const body = b64url(payload)
  const firma = createSign('SHA256')
    .update(`${header}.${body}`)
    // JWS usa la firma cruda R||S (64 bytes), no el DER que Node emite por defecto.
    .sign({ key: opts.clave ?? par.privateKey, dsaEncoding: 'ieee-p1363' }, 'base64url')
  return `${header}.${body}.${firma}`
}

function firmarHs256(payload: Record<string, unknown>, secreto = SECRET, kid?: string): string {
  // El `kid` es opcional porque un HS256 de verdad no lo lleva, pero el token de contrabando
  // SÍ tiene que llevarlo: sin él lo frenaría el chequeo de `kid` y nunca se sabría si el
  // chequeo de algoritmo existe.
  const header = b64url(kid ? { alg: 'HS256', kid, typ: 'JWT' } : { alg: 'HS256', typ: 'JWT' })
  const body = b64url(payload)
  const firma = createHmac('sha256', secreto).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${firma}`
}

const VALIDO = {
  sub: '10663452-fd04-401f-8e92-f5927f503703',
  role: 'authenticated',
  email: 'gerodc06@gmail.com',
  exp: Math.floor(NOW / 1000) + 3600,
}

const CLAVES = clavesCon(jwkDe(par.publicKey, KID))

describe('verificarJwtDeSupabase — proyecto con claves asimétricas', () => {
  it('acepta un login ES256 firmado con la clave que publica el JWKS', async () => {
    expect(await verificarJwtDeSupabase(firmarEs256(VALIDO), NOW, { claves: CLAVES })).toEqual({
      userId: '10663452-fd04-401f-8e92-f5927f503703',
      email: 'gerodc06@gmail.com',
    })
  })

  it('rechaza una firma hecha con otra clave EC', async () => {
    const ajeno = firmarEs256(VALIDO, { clave: otroPar.privateKey })
    expect(await verificarJwtDeSupabase(ajeno, NOW, { claves: CLAVES })).toBeNull()
  })

  it('rechaza un kid que el emisor no conoce: es una clave que nunca firmó nada nuestro', async () => {
    const otroKid = firmarEs256(VALIDO, { kid: 'kid-que-no-existe' })
    expect(await verificarJwtDeSupabase(otroKid, NOW, { claves: CLAVES })).toBeNull()
  })

  it('rechaza un token sin kid en vez de probar con todas las claves', async () => {
    expect(await verificarJwtDeSupabase(firmarEs256(VALIDO, { kid: null }), NOW, { claves: CLAVES })).toBeNull()
  })

  // La confusión de algoritmo clásica, en su versión asimétrica: el atacante conoce la clave
  // PÚBLICA —el JWKS es público— y firma un HS256 usándola de secreto. Si el verificador
  // eligiera el algoritmo por lo que dice el token, cerraría.
  it('rechaza un HS256 firmado con la clave pública de contrabando', async () => {
    const jwk = jwkDe(par.publicKey, KID) as { x?: string; y?: string }
    const comoSecreto = `${jwk.x}${jwk.y}`
    expect(await verificarJwtDeSupabase(firmarHs256(VALIDO, comoSecreto, KID), NOW, { claves: CLAVES })).toBeNull()
  })

  // Y su reverso: un JWKS que devolviera una clave RSA no habilita un token que dice ES256.
  it('rechaza cuando el alg del token no es el de la clave que el emisor publicó', async () => {
    const rsa = clavesCon({ ...(parRsa.publicKey.export({ format: 'jwk' }) as object), kid: KID, alg: 'RS256' } as JsonWebKey)
    expect(await verificarJwtDeSupabase(firmarEs256(VALIDO), NOW, { claves: rsa })).toBeNull()
  })

  it('valida el payload igual que el camino simétrico: rol, vencimiento y sub', async () => {
    const anon = firmarEs256({ ...VALIDO, role: 'anon' })
    const vencido = firmarEs256({ ...VALIDO, exp: Math.floor(NOW / 1000) - 1 })
    const sinSub = firmarEs256({ ...VALIDO, sub: '' })
    expect(await verificarJwtDeSupabase(anon, NOW, { claves: CLAVES })).toBeNull()
    expect(await verificarJwtDeSupabase(vencido, NOW, { claves: CLAVES })).toBeNull()
    expect(await verificarJwtDeSupabase(sinSub, NOW, { claves: CLAVES })).toBeNull()
  })
})

describe('verificarJwtDeSupabase — los dos caminos conviven', () => {
  it('sigue aceptando un HS256 legítimo cuando hay secreto configurado', async () => {
    expect(await verificarJwtDeSupabase(firmarHs256(VALIDO), NOW, { secretoHs256: SECRET })).toEqual({
      userId: '10663452-fd04-401f-8e92-f5927f503703',
      email: 'gerodc06@gmail.com',
    })
  })

  it('rechaza un ES256 cuando el servicio sólo tiene secreto simétrico', async () => {
    expect(await verificarJwtDeSupabase(firmarEs256(VALIDO), NOW, { secretoHs256: SECRET })).toBeNull()
  })

  it('rechaza un HS256 cuando el servicio sólo tiene JWKS: no hay con qué verificarlo', async () => {
    expect(await verificarJwtDeSupabase(firmarHs256(VALIDO), NOW, { claves: CLAVES })).toBeNull()
  })

  it('sin secreto y sin claves no acepta nada', async () => {
    expect(await verificarJwtDeSupabase(firmarEs256(VALIDO), NOW, {})).toBeNull()
    expect(await verificarJwtDeSupabase(firmarHs256(VALIDO), NOW, {})).toBeNull()
  })
})
