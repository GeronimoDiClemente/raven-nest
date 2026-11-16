import { describe, it, expect } from 'vitest'
import { cabecerasCors, origenesDeVinculacion, ORIGENES_POR_DEFECTO } from '../src/cors'

describe('origenesDeVinculacion', () => {
  it('sin la variable valen nestmux.com y el astro dev local', () => {
    expect(origenesDeVinculacion(undefined)).toEqual(['https://nestmux.com', 'http://localhost:4321'])
    expect(origenesDeVinculacion('  ')).toEqual([...ORIGENES_POR_DEFECTO])
  })

  it('con la variable manda SÓLO la lista: así se saca localhost en producción', () => {
    expect(origenesDeVinculacion('https://nestmux.com')).toEqual(['https://nestmux.com'])
    expect(origenesDeVinculacion(' https://a.com/ , https://b.com ')).toEqual(['https://a.com', 'https://b.com'])
  })
})

describe('cabecerasCors', () => {
  const permitidos = ['https://nestmux.com']

  it('a un origen permitido le devuelve ESE origen, sólo POST y los dos headers', () => {
    expect(cabecerasCors('https://nestmux.com', permitidos)).toEqual({
      'Access-Control-Allow-Origin': 'https://nestmux.com',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    })
  })

  it('a otro origen (también www. o http://) no le abre nada (Review Focus 5)', () => {
    for (const o of ['https://evil.example', 'https://www.nestmux.com', 'http://nestmux.com', 'null', undefined]) {
      const h = cabecerasCors(o, permitidos)
      expect(h['Access-Control-Allow-Origin']).toBeUndefined()
      expect(h.Vary).toBe('Origin')
    }
  })

  it('nunca habilita credenciales: el JWT viaja en Authorization, no en cookies', () => {
    expect(cabecerasCors('https://nestmux.com', permitidos)['Access-Control-Allow-Credentials']).toBeUndefined()
  })
})
