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

  // La comparacion del token es de tiempo constante. El tiempo no se testea
  // (seria flaky), pero si que la version manual acepta y rechaza exactamente
  // lo mismo que `===`: es facil escribir un XOR que devuelva true de mas.
  describe('comparacion del token', () => {
    const casos: Array<[string, string, boolean]> = [
      ['identicos', TOKEN, true],
      ['difiere solo en el ultimo caracter', TOKEN.slice(0, -1) + 'y', false],
      ['difiere solo en el primero', 'y' + TOKEN.slice(1), false],
      ['el recibido es un prefijo mas largo', TOKEN + 'y'.repeat(8), false],
      ['mismo largo, todo distinto', 'y'.repeat(TOKEN.length), false],
      ['acentos y no-ascii', 'ñ'.repeat(40), false],
    ]

    for (const [nombre, recibido, esperado] of casos) {
      it(`${nombre}: ${esperado ? 'acepta' : 'rechaza'}`, () => {
        const h = headers({ authorization: `Bearer ${recibido}` })
        expect(verificarAuth(h, TOKEN, false).ok).toBe(esperado)
      })
    }

    // Dos strings distintos con el mismo largo en bytes: si el acumulador
    // XOR estuviera mal armado, podrian colisionar.
    it('no colisiona con un token de los mismos bytes en otro orden', () => {
      const esperado = 'a'.repeat(20) + 'b'.repeat(20)
      const recibido = 'b'.repeat(20) + 'a'.repeat(20)
      const h = headers({ authorization: `Bearer ${recibido}` })
      expect(verificarAuth(h, esperado, false).ok).toBe(false)
    })
  })
})
