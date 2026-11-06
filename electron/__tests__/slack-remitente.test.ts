// Sólo quien conectó Nest a Slack lo maneja desde ahí (electron/integrations/slack-remitente.ts).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { autorizarRemitente, respuestaSinPermiso } from '../integrations/slack-remitente'

describe('autorizarRemitente', () => {
  it('el dueño sí', () => {
    expect(autorizarRemitente('U_DUENO', 'U_DUENO')).toEqual({ ok: true })
  })

  it('el ataque de la auditoría: otro miembro del workspace no', () => {
    expect(autorizarRemitente('U_OTRO', 'U_DUENO')).toEqual({ ok: false, motivo: 'otro-usuario' })
  })

  it('un evento sin usuario no pasa, aunque el dueño tampoco esté', () => {
    expect(autorizarRemitente('', 'U_DUENO')).toEqual({ ok: false, motivo: 'otro-usuario' })
    expect(autorizarRemitente('', null)).toEqual({ ok: false, motivo: 'sin-dueno' })
  })

  it('una instalación de antes de guardar el dueño no obedece a nadie', () => {
    expect(autorizarRemitente('U_CUALQUIERA', null)).toEqual({ ok: false, motivo: 'sin-dueno' })
  })

  it('la respuesta no dice quién es el dueño', () => {
    expect(respuestaSinPermiso('otro-usuario')).not.toMatch(/U_/)
    expect(respuestaSinPermiso('sin-dueno')).toMatch(/[Rr]econnect/)
  })
})

describe('main.ts', () => {
  const src = readFileSync(resolve(__dirname, '../main.ts'), 'utf8')

  it('chequea el remitente ANTES de mandar la mención al renderer y al bot', () => {
    const bloque = src.slice(src.indexOf('onAppMention: (m) =>'), src.indexOf('onBlockAction:'))
    expect(bloque.indexOf('autorizarRemitente(')).toBeGreaterThan(-1)
    expect(bloque.indexOf('autorizarRemitente(')).toBeLessThan(bloque.indexOf("'slack:mention'"))
    expect(bloque.indexOf('autorizarRemitente(')).toBeLessThan(bloque.indexOf('handleMention('))
  })

  it('y antes de mandar un click de botón', () => {
    const bloque = src.slice(src.indexOf('onBlockAction:'), src.indexOf("'slack:action'"))
    expect(bloque).toContain('autorizarRemitente(')
  })

  it('el OAuth guarda a quien instaló la app como dueño', () => {
    expect(src).toMatch(/setToken\(CREDENCIAL_DEL_DUENO, json\.authed_user\.id\)/)
  })
})
