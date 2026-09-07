// §9.2: la emisión del token. El único camino nuevo del servicio, y es aditivo — recibe el
// JWT del login que Nest ya tiene, verifica la firma y crea la fila en `devices`.
//
// Esta mitad es pura y no toca la base: es la verificación del JWT. Se testea sola porque
// es la única superficie del servicio que acepta una credencial que NO emitimos nosotros,
// así que es donde un error se paga caro.
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifySupabaseJwt } from '../src/devices'

const SECRET = 'super-secret-jwt-secret-de-prueba'
const NOW = 1_756_900_000_000  // ms

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function mint(payload: Record<string, unknown>, opts: { secret?: string; alg?: string } = {}): string {
  const header = b64url({ alg: opts.alg ?? 'HS256', typ: 'JWT' })
  const body = b64url(payload)
  const firma = createHmac('sha256', opts.secret ?? SECRET).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${firma}`
}

const VALIDO = {
  sub: '11111111-2222-3333-4444-555555555555',
  role: 'authenticated',
  email: 'gero@nestmux.com',
  exp: Math.floor(NOW / 1000) + 3600,
}

describe('verifySupabaseJwt', () => {
  it('acepta un JWT de login valido y devuelve la identidad', () => {
    expect(verifySupabaseJwt(mint(VALIDO), SECRET, NOW)).toEqual({
      userId: '11111111-2222-3333-4444-555555555555',
      email: 'gero@nestmux.com',
    })
  })

  it('acepta uno sin email: el claim es opcional', () => {
    const { email: _, ...sinEmail } = VALIDO
    expect(verifySupabaseJwt(mint(sinEmail), SECRET, NOW)).toEqual({
      userId: '11111111-2222-3333-4444-555555555555',
      email: null,
    })
  })

  it('rechaza una firma que no cierra', () => {
    expect(verifySupabaseJwt(mint(VALIDO, { secret: 'otro-secreto' }), SECRET, NOW)).toBeNull()
  })

  it('rechaza un token vencido', () => {
    expect(verifySupabaseJwt(mint({ ...VALIDO, exp: Math.floor(NOW / 1000) - 1 }), SECRET, NOW)).toBeNull()
  })

  it('rechaza un token sin exp: un token eterno no es un login', () => {
    const { exp: _, ...sinExp } = VALIDO
    expect(verifySupabaseJwt(mint(sinExp), SECRET, NOW)).toBeNull()
  })

  // El de mas cuidado de todos. La ANON KEY de Supabase es un JWT firmado con ESTE MISMO
  // secreto, y es publica: viaja en el bundle de cualquier cliente. Sin chequear el rol,
  // cualquiera con la anon key podria registrarse un device.
  it('rechaza la anon key, que esta firmada con el mismo secreto pero no es un login', () => {
    const anon = { iss: 'supabase', role: 'anon', exp: Math.floor(NOW / 1000) + 3600 }
    expect(verifySupabaseJwt(mint(anon), SECRET, NOW)).toBeNull()
  })

  it('rechaza un service_role: es una credencial de servidor, no un usuario', () => {
    const svc = { role: 'service_role', sub: 'x', exp: Math.floor(NOW / 1000) + 3600 }
    expect(verifySupabaseJwt(mint(svc), SECRET, NOW)).toBeNull()
  })

  it('rechaza alg: none, aunque el payload sea perfecto', () => {
    const header = b64url({ alg: 'none', typ: 'JWT' })
    const body = b64url(VALIDO)
    expect(verifySupabaseJwt(`${header}.${body}.`, SECRET, NOW)).toBeNull()
  })

  it('rechaza un sub vacio', () => {
    expect(verifySupabaseJwt(mint({ ...VALIDO, sub: '' }), SECRET, NOW)).toBeNull()
  })

  it('rechaza cualquier cosa que no tenga tres partes', () => {
    expect(verifySupabaseJwt('', SECRET, NOW)).toBeNull()
    expect(verifySupabaseJwt('a.b', SECRET, NOW)).toBeNull()
    expect(verifySupabaseJwt('a.b.c.d', SECRET, NOW)).toBeNull()
    expect(verifySupabaseJwt('no-es-un-jwt', SECRET, NOW)).toBeNull()
  })

  it('rechaza un secreto vacio en vez de aceptar todo', () => {
    expect(verifySupabaseJwt(mint(VALIDO, { secret: '' }), '', NOW)).toBeNull()
  })
})
