// El callback de login: sólo un `?code=` se canjea; los tokens en la URL nunca instalan una sesión.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { leerDeepLinkDeAuth, esCanjeDeRecuperacion, LINK_NO_VALIDO } from '../../lib/auth-deeplink'

describe('leerDeepLinkDeAuth', () => {
  it('el callback de PKCE se canjea', () => {
    expect(leerDeepLinkDeAuth('nest://auth/callback?code=abc-123')).toEqual({ tipo: 'canjear', code: 'abc-123' })
  })

  it('el ataque de la auditoría: tokens de otra cuenta en el fragmento NO instalan sesión', () => {
    expect(leerDeepLinkDeAuth('nest://auth/callback#access_token=A&refresh_token=B')).toEqual({ tipo: 'error', mensaje: LINK_NO_VALIDO })
    expect(leerDeepLinkDeAuth('nest://auth/callback#access_token=A&refresh_token=B&type=recovery')).toEqual({ tipo: 'error', mensaje: LINK_NO_VALIDO })
  })

  it('otra ruta nest:// ni se mira, aunque traiga tokens o un code', () => {
    expect(leerDeepLinkDeAuth('nest://x#access_token=A&refresh_token=B')).toEqual({ tipo: 'ignorar' })
    expect(leerDeepLinkDeAuth('nest://otra?code=abc')).toEqual({ tipo: 'ignorar' })
  })

  it('los errores del proveedor se muestran, y el conflicto de identidad con su texto', () => {
    expect(leerDeepLinkDeAuth('nest://auth/callback?error=access_denied&error_description=User+denied')).toEqual({ tipo: 'error', mensaje: 'User denied' })
    const conflicto = leerDeepLinkDeAuth('nest://auth/callback?error_code=identity_already_exists')
    expect(conflicto.tipo === 'error' && conflicto.mensaje).toContain('already linked')
  })

  it('un callback vacío no hace nada', () => {
    expect(leerDeepLinkDeAuth('nest://auth/callback')).toEqual({ tipo: 'ignorar' })
  })
})

describe('esCanjeDeRecuperacion', () => {
  it('lee la marca que auth-js guarda (en JSON) al pedir el reset', () => {
    expect(esCanjeDeRecuperacion(JSON.stringify('verif/PASSWORD_RECOVERY'))).toBe(true)
    expect(esCanjeDeRecuperacion(JSON.stringify('verif'))).toBe(false)
    expect(esCanjeDeRecuperacion(null)).toBe(false)
    expect(esCanjeDeRecuperacion('no es json')).toBe(false)
  })
})

describe('el cliente', () => {
  it('usa PKCE: sin eso el callback vuelve a traer los tokens en la URL', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(resolve(here, '../../lib/supabase.ts'), 'utf8')
    expect(src).toMatch(/flowType:\s*'pkce'/)
  })

  it('main.tsx no hace setSession con nada que venga de un link', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(resolve(here, '../../main.tsx'), 'utf8')
    expect(src).not.toMatch(/auth\.setSession\(/)
    expect(src).toMatch(/exchangeCodeForSession\(/)
  })
})
