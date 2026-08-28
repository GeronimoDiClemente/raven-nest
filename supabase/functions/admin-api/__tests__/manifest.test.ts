import { describe, it, expect } from 'vitest'
import { MANIFEST } from '../manifest.ts'

describe('MANIFEST', () => {
  it('se identifica como nest y llama usuario a la cuenta', () => {
    expect(MANIFEST.product).toBe('nest')
    expect(MANIFEST.account_label).toEqual({ singular: 'usuario', plural: 'usuarios' })
  })

  it('declara accounts', () => {
    expect(MANIFEST.capabilities).toContain('accounts')
  })

  // El consumoSchema del core es de AiraMed (fx.mep_ars, credito_min, minutos):
  // declarar usage-index obligaría a inventar números que Nest no tiene.
  it('NO declara usage-index', () => {
    expect(MANIFEST.capabilities).not.toContain('usage-index')
  })

  it('no tiene flags: Nest no tiene flags de staff', () => {
    expect(MANIFEST.flags).toEqual([])
  })

  it('los meters traen key, label y unit', () => {
    expect(MANIFEST.usage_meters.length).toBeGreaterThan(0)
    for (const m of MANIFEST.usage_meters) {
      expect(typeof m.key).toBe('string')
      expect(typeof m.label).toBe('string')
      expect(typeof m.unit).toBe('string')
    }
  })

  it('las secciones traen key, label y module', () => {
    // Sin esto el test pasaba en vacío: con `sections: []` el for no itera y
    // el back-office se quedaba sin navegación sin que nadie lo notara.
    expect(MANIFEST.sections.length).toBeGreaterThan(0)
    for (const s of MANIFEST.sections) {
      expect(typeof s.key).toBe('string')
      expect(typeof s.label).toBe('string')
      expect(typeof s.module).toBe('string')
    }
  })
})
