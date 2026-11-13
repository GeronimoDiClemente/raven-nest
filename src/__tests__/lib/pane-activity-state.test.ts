import { describe, it, expect } from 'vitest'
import { conPaneOcupado, conActividadDePane, mismosPuertos } from '../../lib/pane-activity-state'

describe('conPaneOcupado', () => {
  it('agrega el pane que se puso a trabajar', () => {
    const next = conPaneOcupado(new Set<string>(), 'p1', true)
    expect([...next]).toEqual(['p1'])
  })

  it('devuelve el MISMO set si el pane ya estaba ocupado', () => {
    const prev = new Set(['p1'])
    expect(conPaneOcupado(prev, 'p1', true)).toBe(prev)
  })

  it('saca el pane que dejó de trabajar', () => {
    const next = conPaneOcupado(new Set(['p1', 'p2']), 'p1', false)
    expect([...next]).toEqual(['p2'])
  })

  it('devuelve el MISMO set si el pane que se apaga no estaba', () => {
    const prev = new Set(['p2'])
    expect(conPaneOcupado(prev, 'p1', false)).toBe(prev)
  })

  it('no toca el set anterior cuando sí cambia', () => {
    const prev = new Set(['p1'])
    const next = conPaneOcupado(prev, 'p2', true)
    expect(next).not.toBe(prev)
    expect([...prev]).toEqual(['p1'])
  })
})

describe('conActividadDePane', () => {
  it('marca el pane activo en su pestaña', () => {
    const next = conActividadDePane(new Map(), 'tab1', 'p1', true)
    expect([...(next.get('tab1') ?? [])]).toEqual(['p1'])
  })

  it('devuelve el MISMO mapa si ese pane ya estaba marcado en esa pestaña', () => {
    const prev = new Map([['tab1', new Set(['p1'])]])
    expect(conActividadDePane(prev, 'tab1', 'p1', true)).toBe(prev)
  })

  it('el mismo pane activo en OTRA pestaña sí cambia', () => {
    const prev = new Map([['tab1', new Set(['p1'])]])
    const next = conActividadDePane(prev, 'tab2', 'p1', true)
    expect(next).not.toBe(prev)
    expect([...(next.get('tab2') ?? [])]).toEqual(['p1'])
    expect([...(next.get('tab1') ?? [])]).toEqual(['p1'])
  })

  it('devuelve el MISMO mapa al apagar un pane que no estaba marcado', () => {
    const prev = new Map([['tab1', new Set(['p1'])]])
    expect(conActividadDePane(prev, 'tab1', 'p2', false)).toBe(prev)
  })

  it('devuelve el MISMO mapa al apagar en una pestaña que no existe', () => {
    const prev = new Map<string, Set<string>>()
    expect(conActividadDePane(prev, 'tab1', 'p1', false)).toBe(prev)
  })

  it('apaga el pane sin tocar a los demás de la pestaña', () => {
    const prev = new Map([['tab1', new Set(['p1', 'p2'])]])
    const next = conActividadDePane(prev, 'tab1', 'p1', false)
    expect([...(next.get('tab1') ?? [])]).toEqual(['p2'])
    expect([...(prev.get('tab1') ?? [])]).toEqual(['p1', 'p2'])
  })
})

describe('mismosPuertos', () => {
  it('dos lecturas idénticas son iguales aunque sean objetos distintos', () => {
    expect(mismosPuertos({ p1: [3000, 5173] }, { p1: [3000, 5173] })).toBe(true)
  })

  it('dos vacías son iguales', () => {
    expect(mismosPuertos({}, {})).toBe(true)
  })

  it('un puerto que aparece cambia', () => {
    expect(mismosPuertos({ p1: [3000] }, { p1: [3000, 5173] })).toBe(false)
  })

  it('un puerto distinto en la misma posición cambia', () => {
    expect(mismosPuertos({ p1: [3000] }, { p1: [3001] })).toBe(false)
  })

  it('un pane nuevo cambia', () => {
    expect(mismosPuertos({ p1: [3000] }, { p1: [3000], p2: [8080] })).toBe(false)
  })

  it('un pane que desaparece cambia', () => {
    expect(mismosPuertos({ p1: [3000], p2: [8080] }, { p1: [3000] })).toBe(false)
  })

  it('el mismo puerto en OTRO pane cambia', () => {
    expect(mismosPuertos({ p1: [3000] }, { p2: [3000] })).toBe(false)
  })
})
