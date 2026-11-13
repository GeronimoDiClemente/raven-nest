import { describe, it, expect } from 'vitest'
import { esVersionBeta, nubeDeMemoriaDisponible, textoDeErrorDeMemoria } from '../../lib/beta-de-memoria'

describe('esVersionBeta', () => {
  it('reconoce el sufijo que usa el canal beta de release.yml', () => {
    expect(esVersionBeta('1.6.0-beta.1')).toBe(true)
    expect(esVersionBeta('1.6.0-beta.12')).toBe(true)
  })

  it('una estable, otro sufijo o nada no es beta', () => {
    // Un falso positivo acá le regala la nube a todo Free en una release pública.
    for (const v of ['1.6.0', '1.6.0-rc.1', '1.6.0-beta', '1.6.0-beta.1.2', 'beta', '', undefined, null]) {
      expect(esVersionBeta(v)).toBe(false)
    }
  })
})

describe('nubeDeMemoriaDisponible', () => {
  it('en un build estable manda el plan', () => {
    expect(nubeDeMemoriaDisponible(false, false)).toBe(false)
    expect(nubeDeMemoriaDisponible(true, false)).toBe(true)
  })

  it('en una beta se ofrece aunque el plan sea Free: quién entra lo decide el allowlist', () => {
    expect(nubeDeMemoriaDisponible(false, true)).toBe(true)
  })

  it('en los tests no hay versión horneada, así que el default es estable', () => {
    expect(nubeDeMemoriaDisponible(false)).toBe(false)
  })
})

describe('textoDeErrorDeMemoria', () => {
  it('not_in_beta se explica, no se muestra crudo', () => {
    const t = textoDeErrorDeMemoria('not_in_beta')
    expect(t).not.toContain('not_in_beta')
    expect(t).toMatch(/closed beta/)
    expect(t).toMatch(/keeps working on this machine/)
  })

  it('lo que no conoce pasa tal cual', () => {
    expect(textoDeErrorDeMemoria('HTTP 502')).toBe('HTTP 502')
  })
})
