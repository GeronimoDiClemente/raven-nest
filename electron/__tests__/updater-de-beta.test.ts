import { describe, it, expect } from 'vitest'
import { esVersionBeta, feedDeBeta, headersDeBeta } from '../updater-de-beta'

describe('updater de la beta', () => {
  it('sólo una -beta.N se actualiza desde el servicio', () => {
    expect(esVersionBeta('1.6.0-beta.1')).toBe(true)
    // Una estable con este camino buscaría updates donde no hay: dejaría de actualizarse.
    for (const v of ['1.6.0', '1.5.0', '1.6.0-rc.1', '1.6.0-beta']) expect(esVersionBeta(v)).toBe(false)
  })

  it('el feed cuelga de la base de sync, con barra final para que el updater resuelva relativo', () => {
    expect(feedDeBeta('https://sync.example.com')).toBe('https://sync.example.com/v1/beta/update/')
    expect(feedDeBeta('https://sync.example.com//')).toBe('https://sync.example.com/v1/beta/update/')
  })

  it('sin token no hay chequeo', () => {
    expect(headersDeBeta(null)).toBeNull()
    expect(headersDeBeta('')).toBeNull()
  })

  it('el header va en minúscula: es el que electron-updater saca al redirigir a R2', () => {
    expect(Object.keys(headersDeBeta('nmk_x')!)).toEqual(['authorization'])
    expect(headersDeBeta('nmk_x')!.authorization).toBe('Bearer nmk_x')
  })
})
