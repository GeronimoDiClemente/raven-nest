import { describe, it, expect } from 'vitest'
import {
  descripcionDeProyectosEnLaNube as desc, descripcionSobreElTope, lineaSoloLocales, proyectoQueSigue, soloLocales, tieneTope,
} from '../../lib/proyectos-en-la-nube'

const p = (projectKey: string, name = projectKey) => ({ projectKey, name })

describe('tieneTope', () => {
  it('un tope chico y conocido sí; Cloud (100), desconocido o infinito no', () => {
    expect(tieneTope(1)).toBe(true)
    expect(tieneTope(99)).toBe(true)
    expect(tieneTope(100)).toBe(false)
    expect(tieneTope(null)).toBe(false)
    expect(tieneTope(Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('descripcionDeProyectosEnLaNube (spec 2b-1 §4.7)', () => {
  it('con tope: «N of M · nombres»', () => {
    expect(desc([p('k', 'raven-nest')], 1)).toBe('1 of 1 · raven-nest')
    expect(desc([p('a'), p('b')], 3)).toBe('2 of 3 · a, b')
  })
  it('con tope y nada arriba todavía: «0 of 1», sin el punto (D5)', () => {
    expect(desc([], 1)).toBe('0 of 1')
  })
  it('sin tope: «N projects», con singular', () => {
    expect(desc([p('a'), p('b')], 100)).toBe('2 projects')
    expect(desc([p('a')], 100)).toBe('1 project')
    expect(desc([], 100)).toBe('0 projects')
  })
  it('tope desconocido (servicio viejo): como sin tope (D3)', () => {
    expect(desc([p('a')], null)).toBe('1 project')
  })
})

describe('soloLocales', () => {
  it('saca los que la nube ya tiene, por key (Review Focus 3)', () => {
    expect(soloLocales([p('k1', 'api'), p('k2', 'web')], [p('k2', 'web')])).toEqual(['api'])
  })
})

describe('lineaSoloLocales', () => {
  it('el copy del spec', () => {
    expect(lineaSoloLocales(['api', 'web'])).toBe('Local only: api, web — Cloud syncs all your projects.')
  })
})

describe('por encima del tope (spec 2b-2 §4.8)', () => {
  it('la descripción', () => {
    expect(descripcionSobreElTope(1, 3)).toBe('Your plan syncs 1 of 3 projects.')
  })

  it('sigue el elegido; si no está en el roster (o no hay), el primero = el más viejo (D2)', () => {
    const roster = [{ projectKey: 'k-a', name: 'a' }, { projectKey: 'k-b', name: 'b' }]
    expect(proyectoQueSigue(roster, 'k-b')).toBe('k-b')
    expect(proyectoQueSigue(roster, null)).toBe('k-a')
    expect(proyectoQueSigue(roster, 'k-borrado')).toBe('k-a')
    expect(proyectoQueSigue([], null)).toBeNull()
  })
})
