import { describe, it, expect } from 'vitest'
import {
  TEMAS, TEMA_NEST, temaPorId, contraste, peorContraste, ajustarContraste, aXterm,
  CONTRASTE_MINIMO,
} from '../lib/terminal-themes'

describe('el catálogo', () => {
  it('trae los trece y el propio va primero', () => {
    expect(TEMAS).toHaveLength(13)
    expect(TEMAS[0].id).toBe('nest')
  })

  it('ningún id repetido', () => {
    expect(new Set(TEMAS.map((t) => t.id)).size).toBe(TEMAS.length)
  })

  it('todos tienen los 16 ANSI y todo hex válido', () => {
    for (const t of TEMAS) {
      expect(t.ansi, t.id).toHaveLength(16)
      for (const c of [t.background, t.foreground, t.cursor, ...t.ansi]) {
        expect(c, `${t.id} · ${c}`).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })

  it('un id que no existe cae al propio, no a undefined', () => {
    expect(temaPorId('no-existe')).toBe(TEMA_NEST)
    expect(temaPorId(null)).toBe(TEMA_NEST)
    expect(temaPorId('')).toBe(TEMA_NEST)
  })
})

/**
 * El arreglo del tema propio. `brightBlack` —el gris de los comentarios— estaba en `#4c4c4c`,
 * que contra el fondo negro da 2.45:1: nuestro propio terminal no pasaba el guard de 3:1 que
 * el repo le exige a toda la interfaz.
 */
describe('el tema propio', () => {
  it('el gris de los comentarios pasa el piso, con margen', () => {
    const gris = TEMA_NEST.ansi[8]
    const r = contraste(gris, TEMA_NEST.background)
    expect(r).toBeGreaterThanOrEqual(CONTRASTE_MINIMO)
    // Margen real, no raspando: `#5c5c5c` ya pasaba con 3.14 y quedaba a 0.14 de fallar.
    expect(r).toBeGreaterThan(3.4)
  })

  it('sigue siendo secundario: muy por debajo del texto normal', () => {
    const gris = contraste(TEMA_NEST.ansi[8], TEMA_NEST.background)
    const texto = contraste(TEMA_NEST.foreground, TEMA_NEST.background)
    expect(gris).toBeLessThan(texto / 3)
  })

  it('ningún color de texto queda por debajo del piso', () => {
    expect(peorContraste(TEMA_NEST)).toBeGreaterThanOrEqual(CONTRASTE_MINIMO)
  })
})

describe('contraste', () => {
  it('los extremos dan los valores conocidos', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contraste('#000000', '#000000')).toBeCloseTo(1, 5)
  })
  it('es simétrico', () => {
    expect(contraste('#123456', '#abcdef')).toBeCloseTo(contraste('#abcdef', '#123456'), 10)
  })
})

/**
 * El ajuste es lo que vuelve ofrecible el catálogo. Ocho de los trece tienen algún color por
 * debajo de 3:1 contra su propio fondo —TokyoNight deja los comentarios en 1.91— y sin esto
 * el usuario importa su tema, no lee la mitad, y le echa la culpa a Nest.
 */
describe('ajustarContraste', () => {
  it('deja TODO el catálogo por encima del piso', () => {
    for (const t of TEMAS) {
      expect(peorContraste(ajustarContraste(t)), t.id).toBeGreaterThanOrEqual(CONTRASTE_MINIMO)
    }
  })

  it('no toca lo que ya pasaba', () => {
    const ya = ajustarContraste(TEMA_NEST)
    expect(ya.ansi).toEqual(TEMA_NEST.ansi)
    expect(ya.foreground).toBe(TEMA_NEST.foreground)
  })

  // El ANSI negro es un color de FONDO. "Arreglarlo" contra el fondo lo volvería un gris que
  // no sirve para lo único que hace.
  it('no toca el negro ANSI', () => {
    for (const t of TEMAS) {
      expect(ajustarContraste(t).ansi[0], t.id).toBe(t.ansi[0])
    }
  })

  /**
   * Lo decisivo: un tema ajustado tiene que seguir PARECIÉNDOSE al original. Si subiéramos
   * los tres canales RGB por igual, el color se lava hacia el blanco y un rojo tenue termina
   * rosa — el usuario importó su tema justo para reconocerlo.
   */
  it('conserva el tono: un rojo sigue siendo rojo', () => {
    const tono = (hex: string): number => {
      const h = hex.replace('#', '')
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min
      if (d === 0) return -1
      let t = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      t *= 60; if (t < 0) t += 360
      return t
    }
    const oscuro = { ...TEMA_NEST, id: 'p', nombre: 'p', background: '#000000',
      ansi: [...TEMA_NEST.ansi] }
    oscuro.ansi[1] = '#3a0d0d'   // un rojo muy tenue: 1.3:1, hay que subirlo mucho
    const ajustado = ajustarContraste(oscuro)
    expect(contraste(ajustado.ansi[1], '#000000')).toBeGreaterThanOrEqual(CONTRASTE_MINIMO)
    const antes = tono(oscuro.ansi[1]); const despues = tono(ajustado.ansi[1])
    expect(Math.abs(antes - despues), `${oscuro.ansi[1]} -> ${ajustado.ansi[1]}`).toBeLessThan(12)
  })

  it('sobre un tema de fondo claro baja en vez de subir', () => {
    const claro = { id: 'c', nombre: 'c', background: '#ffffff', foreground: '#f0f0f0',
      cursor: '#000000', selection: '#cccccc', ansi: Array(16).fill('#f5f5f5') }
    const ajustado = ajustarContraste(claro)
    expect(contraste(ajustado.foreground, '#ffffff')).toBeGreaterThanOrEqual(CONTRASTE_MINIMO)
  })
})

describe('aXterm', () => {
  it('mapea los 16 a los nombres que espera xterm', () => {
    const x = aXterm(TEMA_NEST)
    expect(x.background).toBe(TEMA_NEST.background)
    expect(x.black).toBe(TEMA_NEST.ansi[0])
    expect(x.brightWhite).toBe(TEMA_NEST.ansi[15])
    expect(x.blue).toBe(TEMA_NEST.ansi[4])
    expect(x.brightBlack).toBe(TEMA_NEST.ansi[8])
  })
})
