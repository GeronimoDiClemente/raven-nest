import { describe, it, expect } from 'vitest'
import { PaneTokenRegistry } from '../orchestration/pane-tokens'

describe('PaneTokenRegistry', () => {
  it('issue+resolve devuelve el paneId', () => {
    const reg = new PaneTokenRegistry()
    const token = reg.issue('pane-1')
    expect(reg.resolve(token)).toBe('pane-1')
  })

  it('resolve de un token inventado da null', () => {
    const reg = new PaneTokenRegistry()
    reg.issue('pane-1')
    expect(reg.resolve('inventado')).toBeNull()
    expect(reg.resolve('')).toBeNull()
  })

  it('revoke invalida el token', () => {
    const reg = new PaneTokenRegistry()
    const token = reg.issue('pane-1')
    reg.revoke('pane-1')
    expect(reg.resolve(token)).toBeNull()
  })

  it('reissue invalida el anterior', () => {
    const reg = new PaneTokenRegistry()
    const viejo = reg.issue('pane-1')
    const nuevo = reg.issue('pane-1')
    expect(nuevo).not.toBe(viejo)
    expect(reg.resolve(viejo)).toBeNull()
    expect(reg.resolve(nuevo)).toBe('pane-1')
  })

  it('revokeAll invalida todos', () => {
    const reg = new PaneTokenRegistry()
    const a = reg.issue('a')
    const b = reg.issue('b')
    reg.revokeAll()
    expect(reg.resolve(a)).toBeNull()
    expect(reg.resolve(b)).toBeNull()
  })

  it('no guarda el token en claro', () => {
    const reg = new PaneTokenRegistry()
    const token = reg.issue('pane-1')
    const hashes = reg._hashesForTest()
    expect(hashes).toHaveLength(1)
    expect(hashes).not.toContain(token)
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/)
  })
})
