import { describe, it, expect } from 'vitest'
import { rutaDe } from '../router.ts'

describe('rutaDe', () => {
  // El back-office pega a `${baseUrl}/api/internal/...` y baseUrl ya incluye
  // /functions/v1/admin-api, así que el path real trae ese prefijo.
  it('reconoce el manifest con el prefijo de la function', () => {
    expect(rutaDe('/admin-api/api/internal/manifest')).toEqual({ nombre: 'manifest' })
  })

  it('reconoce el manifest sin prefijo', () => {
    expect(rutaDe('/api/internal/manifest')).toEqual({ nombre: 'manifest' })
  })

  it('reconoce la lista de cuentas', () => {
    expect(rutaDe('/api/internal/accounts')).toEqual({ nombre: 'accounts' })
  })

  it('reconoce la ficha y saca el id', () => {
    expect(rutaDe('/api/internal/accounts/u1')).toEqual({ nombre: 'account', id: 'u1' })
  })

  it('reconoce la ruta de plan', () => {
    expect(rutaDe('/api/internal/accounts/u1/plan')).toEqual({ nombre: 'plan', id: 'u1' })
  })

  it('ignora la barra final', () => {
    expect(rutaDe('/api/internal/accounts/')).toEqual({ nombre: 'accounts' })
  })

  it('una ruta desconocida es null', () => {
    expect(rutaDe('/api/internal/otra')).toBe(null)
    expect(rutaDe('/api/internal/accounts/u1/otra')).toBe(null)
    expect(rutaDe('/')).toBe(null)
  })
})
