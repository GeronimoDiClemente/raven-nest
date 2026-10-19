import { describe, it, expect } from 'vitest'
import { servicioDelPaquete, avisoDeServicioDistinto } from '../servicio-del-paquete'
import { BASE_DE_SYNC_POR_DEFECTO } from '../base-de-sync'

describe('a qué servicio le habla el paquete', () => {
  it('sin nada configurado, el mismo default que Nest', () => {
    // Antes devolvía null y `login` cortaba con «No sync service configured»: un `npx` en
    // una máquina nueva no podía conectarse sin que el usuario supiera una URL.
    expect(servicioDelPaquete({ env: undefined, guardada: null })).toBe(BASE_DE_SYNC_POR_DEFECTO)
  })

  it('la variable de entorno le gana a todo', () => {
    expect(servicioDelPaquete({ env: 'http://127.0.0.1:8099/', guardada: 'https://otra.example' }))
      .toBe('http://127.0.0.1:8099')
  })

  it('sin variable, la del login', () => {
    expect(servicioDelPaquete({ env: '', guardada: 'https://sync-staging.example' }))
      .toBe('https://sync-staging.example')
  })

  it('una variable que no es una URL no apaga la nube: se saltea', () => {
    expect(servicioDelPaquete({ env: 'nada', guardada: null })).toBe(BASE_DE_SYNC_POR_DEFECTO)
  })
})

// Review final de rama, A: `servicioDelPaquete` deja ganar al env A PROPÓSITO — pero el
// token sólo vale en el servicio que lo emitió, y antes de esto nada avisaba cuando los dos
// difieren. El fallo que produce (401/403 contra un servicio que nunca vio ese token) no
// explicaba por qué.
describe('avisoDeServicioDistinto', () => {
  it('sin env no hay conflicto que avisar', () => {
    expect(avisoDeServicioDistinto({ env: undefined, guardada: 'https://a.example' })).toBeNull()
  })

  it('sin credencial guardada tampoco (recién instalado, todavía sin login)', () => {
    expect(avisoDeServicioDistinto({ env: 'https://a.example', guardada: null })).toBeNull()
  })

  it('las dos iguales: nada que avisar', () => {
    expect(avisoDeServicioDistinto({ env: 'https://a.example/', guardada: 'https://a.example' })).toBeNull()
  })

  it('env distinto de donde se hizo login: avisa los dos valores', () => {
    const aviso = avisoDeServicioDistinto({ env: 'https://staging.example', guardada: 'https://a.example' })
    expect(aviso).toContain('https://staging.example')
    expect(aviso).toContain('https://a.example')
    expect(aviso).toMatch(/auth error/)
  })

  it('un env que no es URL no cuenta como conflicto', () => {
    expect(avisoDeServicioDistinto({ env: 'nada', guardada: 'https://a.example' })).toBeNull()
  })
})
