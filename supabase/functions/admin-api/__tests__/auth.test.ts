import { describe, it, expect } from 'vitest'
import { verificarAuth, LARGO_MINIMO_TOKEN } from '../auth.ts'

const TOKEN = 'x'.repeat(40)

function headers(over: Record<string, string> = {}): Headers {
  return new Headers({
    authorization: `Bearer ${TOKEN}`,
    'x-admin-actor': 'staff-1',
    ...over,
  })
}

describe('verificarAuth', () => {
  it('acepta una lectura con token y actor', () => {
    const r = verificarAuth(headers(), TOKEN, false)
    expect(r).toEqual({ ok: true, actor: { id: 'staff-1', email: null, motivo: null } })
  })

  it('toma el email y el motivo cuando vienen', () => {
    const h = headers({ 'x-admin-actor-email': 'a@b.com', 'x-admin-motivo': 'soporte' })
    const r = verificarAuth(h, TOKEN, true)
    expect(r).toEqual({
      ok: true,
      actor: { id: 'staff-1', email: 'a@b.com', motivo: 'soporte' },
    })
  })

  it('rechaza sin header de authorization', () => {
    const h = new Headers({ 'x-admin-actor': 'staff-1' })
    expect(verificarAuth(h, TOKEN, false)).toEqual({
      ok: false, status: 401, error: 'No autorizado',
    })
  })

  it('rechaza un token que no coincide', () => {
    expect(verificarAuth(headers(), 'y'.repeat(40), false)).toEqual({
      ok: false, status: 401, error: 'No autorizado',
    })
  })

  // Fail-closed: un token corto se rechaza aunque el header lo repita igual.
  it('rechaza un token de 31 caracteres aunque coincida', () => {
    const corto = 'z'.repeat(31)
    const h = new Headers({ authorization: `Bearer ${corto}`, 'x-admin-actor': 'staff-1' })
    expect(verificarAuth(h, corto, false)).toEqual({
      ok: false, status: 401, error: 'No autorizado',
    })
  })

  it('rechaza cuando el server no tiene token configurado', () => {
    expect(verificarAuth(headers(), undefined, false)).toEqual({
      ok: false, status: 401, error: 'No autorizado',
    })
  })

  it('exige actor tambien en lecturas', () => {
    const h = new Headers({ authorization: `Bearer ${TOKEN}` })
    expect(verificarAuth(h, TOKEN, false)).toEqual({
      ok: false, status: 400, error: 'Falta X-Admin-Actor',
    })
  })

  it('exige motivo en escrituras', () => {
    expect(verificarAuth(headers(), TOKEN, true)).toEqual({
      ok: false, status: 400, error: 'Falta X-Admin-Motivo',
    })
  })

  it('un motivo en blanco no cuenta como motivo', () => {
    expect(verificarAuth(headers({ 'x-admin-motivo': '   ' }), TOKEN, true)).toEqual({
      ok: false, status: 400, error: 'Falta X-Admin-Motivo',
    })
  })

  it('expone el minimo de 32 que exige el contrato', () => {
    expect(LARGO_MINIMO_TOKEN).toBe(32)
  })
})
