import { describe, it, expect } from 'vitest'
import { ACCOUNT_ALLOWED_KEYS, clavesNoPermitidas } from '../allowlist.ts'

describe('clavesNoPermitidas', () => {
  const permitidas = new Set(['id', 'name', 'meters', 'key', 'used'])

  it('un objeto limpio no reporta nada', () => {
    expect(clavesNoPermitidas({ id: '1', name: 'a' }, permitidas)).toEqual([])
  })

  it('encuentra una clave no declarada', () => {
    expect(clavesNoPermitidas({ id: '1', github_token: 'ghp_x' }, permitidas))
      .toEqual(['github_token'])
  })

  // El árbol entero, no sólo el primer nivel: un token escondido tres niveles
  // abajo se serializa igual que uno en la raíz.
  it('baja por objetos anidados', () => {
    const arbol = { id: '1', meters: [{ key: 'seats', used: 2, gitlab_token: 'glpat' }] }
    expect(clavesNoPermitidas(arbol, permitidas)).toEqual(['gitlab_token'])
  })

  it('no confunde los indices de un array con claves', () => {
    expect(clavesNoPermitidas({ meters: [{ key: 'a', used: 1 }] }, permitidas)).toEqual([])
  })

  it('reporta cada clave una sola vez', () => {
    const arbol = { meters: [{ github_token: 'a' }, { github_token: 'b' }] }
    expect(clavesNoPermitidas(arbol, permitidas)).toEqual(['github_token'])
  })

  it('null y primitivos no rompen', () => {
    expect(clavesNoPermitidas(null, permitidas)).toEqual([])
    expect(clavesNoPermitidas('texto', permitidas)).toEqual([])
    expect(clavesNoPermitidas({ id: null }, permitidas)).toEqual([])
  })
})

describe('ACCOUNT_ALLOWED_KEYS', () => {
  it('no permite ninguno de los dos tokens', () => {
    expect(ACCOUNT_ALLOWED_KEYS.has('github_token')).toBe(false)
    expect(ACCOUNT_ALLOWED_KEYS.has('gitlab_token')).toBe(false)
  })

  it('permite lo que el contrato declara', () => {
    for (const k of ['id', 'name', 'plan', 'plan_label', 'status', 'created_at',
                     'trial_ends_at', 'voz_suspendida', 'meters', 'health',
                     'flags', 'onboarding']) {
      expect(ACCOUNT_ALLOWED_KEYS.has(k)).toBe(true)
    }
  })
})
