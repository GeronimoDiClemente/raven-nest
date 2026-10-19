import { describe, it, expect } from 'vitest'
import { servicioDelPaquete } from '../servicio-del-paquete'
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
