import { describe, it, expect } from 'vitest'
import { normalizarCodigo, copyDeErrorDeVinculacion } from '../../lib/codigo-de-vinculacion'

describe('normalizarCodigo', () => {
  it('acepta el código tal como se muestra', () => {
    expect(normalizarCodigo('WXYZ-1234')).toEqual({ ok: true, codigo: 'WXYZ-1234' })
  })

  it('acepta minúsculas: nadie tipea en mayúsculas', () => {
    expect(normalizarCodigo('wxyz-1234')).toEqual({ ok: true, codigo: 'WXYZ-1234' })
  })

  it('acepta sin el guión', () => {
    expect(normalizarCodigo('WXYZ1234')).toEqual({ ok: true, codigo: 'WXYZ-1234' })
  })

  it('acepta con espacios, que es como queda al copiar de una terminal', () => {
    expect(normalizarCodigo('  WXYZ 1234 ')).toEqual({ ok: true, codigo: 'WXYZ-1234' })
  })

  it('un código a medias no es un error todavía: el usuario está tipeando', () => {
    expect(normalizarCodigo('WXY')).toEqual({ ok: false, motivo: 'incompleto' })
  })

  it('vacío tampoco es un error', () => {
    expect(normalizarCodigo('   ')).toEqual({ ok: false, motivo: 'incompleto' })
  })

  it('de más sí es un error', () => {
    expect(normalizarCodigo('WXYZ-12345')).toEqual({ ok: false, motivo: 'largo' })
  })

  it('un símbolo que no es alfanumérico es un error', () => {
    expect(normalizarCodigo('WXYZ-12/4')).toEqual({ ok: false, motivo: 'simbolo' })
  })

  it('NO valida contra el alfabeto del servidor', () => {
    // `O`, `I` y `S` no están en el alfabeto con el que el servidor genera códigos, pero el
    // cliente igual los deja pasar: duplicar ese alfabeto acá crea una segunda verdad, y el
    // día que el servidor la cambie el cliente rechazaría códigos válidos — que es un modo
    // de falla peor que mandar uno inválido y que el servidor lo diga.
    expect(normalizarCodigo('OOOO-IIII')).toEqual({ ok: true, codigo: 'OOOO-IIII' })
  })
})

describe('copyDeErrorDeVinculacion', () => {
  it('traduce los códigos del servicio a algo que se puede leer', () => {
    expect(copyDeErrorDeVinculacion('unknown_code')).toMatch(/expired|exist/i)
    expect(copyDeErrorDeVinculacion('expired')).toMatch(/expired/i)
    expect(copyDeErrorDeVinculacion('already_approved')).toMatch(/already/i)
  })

  it('un código que no conoce se muestra igual, no se traga', () => {
    // Tragarse un error desconocido deja al usuario sin nada que buscar ni que reportar.
    expect(copyDeErrorDeVinculacion('algo_nuevo_del_servidor')).toContain('algo_nuevo_del_servidor')
  })

  it('está en inglés, como toda la app', () => {
    for (const c of ['unknown_code', 'expired', 'already_approved', 'not_in_beta']) {
      expect(copyDeErrorDeVinculacion(c)).not.toMatch(/[áéíóúñ¿¡]/i)
    }
  })
})
