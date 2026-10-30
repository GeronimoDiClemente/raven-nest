import { describe, it, expect } from 'vitest'
import {
  decidirColor, crearEstilo, marca, acortarHome, recortar, hace, grupoDeTipo, barraDeGrupos,
} from '../estilo-del-paquete'

const ANSI = /\x1b\[/

describe('decidirColor', () => {
  it('colorea sólo en una terminal', () => {
    expect(decidirColor({}, true)).toBe(true)
    expect(decidirColor({}, false)).toBe(false)
  })

  it('NO_COLOR gana siempre, también sobre FORCE_COLOR', () => {
    expect(decidirColor({ NO_COLOR: '1' }, true)).toBe(false)
    expect(decidirColor({ NO_COLOR: '1', FORCE_COLOR: '1' }, true)).toBe(false)
  })

  it('FORCE_COLOR fuerza fuera de una terminal, salvo FORCE_COLOR=0', () => {
    expect(decidirColor({ FORCE_COLOR: '1' }, false)).toBe(true)
    expect(decidirColor({ FORCE_COLOR: '0' }, true)).toBe(false)
  })

  it('TERM=dumb no recibe color', () => {
    expect(decidirColor({ TERM: 'dumb' }, true)).toBe(false)
  })
})

describe('estilo', () => {
  it('sin color no emite ningún código ANSI', () => {
    const e = crearEstilo(false)
    const todo = [e.negrita('a'), e.tenue('b'), e.ok('c'), e.aviso('d'), e.falla('f'), e.acento('g'), marca(e, 'status')].join('')
    expect(todo).not.toMatch(ANSI)
    expect(barraDeGrupos(e, { decisions: 2, fixes: 1 }).join('')).not.toMatch(ANSI)
  })

  it('la marca es la línea del logo, con el subcomando', () => {
    expect(marca(crearEstilo(false), 'doctor')).toBe('> nest memory_ / doctor')
    expect(marca(crearEstilo(false), 'search', '3 results')).toBe('> nest memory_ / search · 3 results')
  })
})

describe('acortarHome', () => {
  it('cambia el home por ~ y corta el uuid de la cuenta', () => {
    expect(acortarHome('/Users/ana/.raven-nest/memory/10663452-fd04-401f-8e92-f5927f503703/memory.db', ['/Users/ana']))
      .toBe('~/.raven-nest/memory/10663452…/memory.db')
  })

  it('no confunde un home que es prefijo de otra carpeta', () => {
    expect(acortarHome('/Users/anabel/x', ['/Users/ana'])).toBe('/Users/anabel/x')
  })
})

describe('recortar y hace', () => {
  it('recortar junta los espacios y corta con elipsis', () => {
    expect(recortar('una  línea\ncon saltos', 100)).toBe('una línea con saltos')
    expect(recortar('abcdefghij', 5)).toBe('abcd…')
  })

  it('hace da la antigüedad en una columna corta', () => {
    const ahora = Date.UTC(2026, 9, 29)
    expect(hace(ahora - 30_000, ahora)).toBe('now')
    expect(hace(ahora - 5 * 60_000, ahora)).toBe('5m')
    expect(hace(ahora - 3 * 3_600_000, ahora)).toBe('3h')
    expect(hace(ahora - 4 * 86_400_000, ahora)).toBe('4d')
    expect(hace(ahora - 65 * 86_400_000, ahora)).toBe('2mo')
  })
})

describe('grupos de tipo', () => {
  it('agrupa los tipos del protocolo en los cinco de la leyenda', () => {
    expect(grupoDeTipo('bugfix')).toBe('fixes')
    expect(grupoDeTipo('pattern')).toBe('conventions')
    expect(grupoDeTipo('handoff')).toBe('sessions')
    expect(grupoDeTipo('algo-nuevo')).toBe('discoveries')
  })

  it('la barra ocupa el ancho exacto y un grupo chico no desaparece', () => {
    const [barra, leyenda] = barraDeGrupos(crearEstilo(false), { decisions: 200, fixes: 1 }, 40)
    expect(barra.trim()).toHaveLength(40)
    expect(leyenda).toContain('fixes 1')
  })

  it('sin memorias no hay barra', () => {
    expect(barraDeGrupos(crearEstilo(false), {})).toEqual([])
  })
})

describe('barra con redondeo corto', () => {
  it('tres grupos iguales siguen llenando el ancho', () => {
    const [barra] = barraDeGrupos(crearEstilo(false), { decisions: 1, fixes: 1, conventions: 1 }, 40)
    expect(barra.trim()).toHaveLength(40)
  })
})
