import { describe, it, expect } from 'vitest'
import { pestanaDelHilo } from '../../lib/pestana-del-hilo'

describe('pestanaDelHilo', () => {
  it('sin repo no hay pestaña', () => {
    expect(pestanaDelHilo(null, { ready: true, enabled: true, cargaFallida: false })).toBe(false)
  })
  it('leyendo = no se sabe (null): la pestaña de la sesión no se cae', () => {
    expect(pestanaDelHilo('/r', { ready: false, enabled: false, cargaFallida: false })).toBeNull()
  })
  it('prendido y leído: sí; una lectura fallida: no', () => {
    expect(pestanaDelHilo('/r', { ready: true, enabled: true, cargaFallida: false })).toBe(true)
    expect(pestanaDelHilo('/r', { ready: true, enabled: true, cargaFallida: true })).toBe(false)
  })
})
