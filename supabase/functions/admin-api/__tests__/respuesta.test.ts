import { describe, it, expect } from 'vitest'
import { sobre } from '../respuesta.ts'
import { MANIFEST } from '../manifest.ts'

describe('sobre', () => {
  // El bug que este modulo existe para cerrar: el back-office descarta toda
  // respuesta sin `ok: true` y muestra "Error 200" sobre datos correctos.
  it('agrega ok: true a una respuesta exitosa', () => {
    expect(sobre({ accounts: [], truncado: false }, 200)).toEqual({
      ok: true, accounts: [], truncado: false,
    })
  })

  it('conserva todos los campos del cuerpo', () => {
    const r = sobre({ equipo: { id: 't1' }, auditado: false }, 200) as Record<string, unknown>
    expect(r.equipo).toEqual({ id: 't1' })
    expect(r.auditado).toBe(false)
    expect(r.ok).toBe(true)
  })

  it('envuelve el manifest sin perder lo que declara', () => {
    const r = sobre(MANIFEST, 200) as Record<string, unknown>
    expect(r.ok).toBe(true)
    expect(r.product).toBe('nest')
    expect(r.sections).toEqual(MANIFEST.sections)
    expect(r.capabilities).toEqual(MANIFEST.capabilities)
  })

  // Envolver un error lo convertiria en un exito para el cliente, que decide
  // por el campo y no solo por el status.
  it('no envuelve los errores', () => {
    expect(sobre({ error: 'Cuenta no encontrada' }, 404)).toEqual({ error: 'Cuenta no encontrada' })
    expect(sobre({ error: 'No autorizado' }, 401)).toEqual({ error: 'No autorizado' })
    expect(sobre({ error: 'Error interno' }, 500)).toEqual({ error: 'Error interno' })
  })

  it('no envuelve un 400, que tambien es rechazo', () => {
    expect(sobre({ error: 'Falta X-Admin-Motivo' }, 400)).toEqual({ error: 'Falta X-Admin-Motivo' })
  })

  it('deja pasar un cuerpo que no es objeto plano en vez de romperlo', () => {
    expect(sobre(null, 200)).toBeNull()
    expect(sobre([1, 2], 200)).toEqual([1, 2])
    expect(sobre('texto', 200)).toBe('texto')
  })

  it('un ok propio del cuerpo gana sobre el del sobre', () => {
    expect(sobre({ ok: false, detalle: 'x' }, 200)).toEqual({ ok: false, detalle: 'x' })
  })
})
