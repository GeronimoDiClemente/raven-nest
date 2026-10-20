import { describe, it, expect } from 'vitest'
import { tabsReducer, ESTADO_INICIAL, tabId } from '../../lib/memory-tabs'

const nota = (syncId: string) => ({ kind: 'note' as const, syncId })

describe('tabsReducer', () => {
  it('abrir agrega y activa; abrir una ya abierta solo la enfoca', () => {
    let s = tabsReducer(ESTADO_INICIAL, { type: 'open', tab: nota('a') })
    s = tabsReducer(s, { type: 'open', tab: nota('b') })
    s = tabsReducer(s, { type: 'open', tab: nota('a') })
    expect(s.tabs.map(tabId)).toEqual(['graph', 'note:a', 'note:b'])
    expect(s.activeId).toBe('note:a')
  })
  it('abrir en segundo plano no cambia la activa', () => {
    const s = tabsReducer(ESTADO_INICIAL, { type: 'open', tab: nota('a'), background: true })
    expect(s.activeId).toBe('graph')
    expect(s.tabs.map(tabId)).toEqual(['graph', 'note:a'])
  })
  it('cerrar la activa activa la de la izquierda', () => {
    let s = tabsReducer(ESTADO_INICIAL, { type: 'open', tab: nota('a') })
    s = tabsReducer(s, { type: 'open', tab: nota('b') })
    s = tabsReducer(s, { type: 'close', id: 'note:b' })
    expect(s.activeId).toBe('note:a')
  })
  it('Graph y Team thread no se cierran', () => {
    let s = tabsReducer(ESTADO_INICIAL, { type: 'setThread', on: true })
    s = tabsReducer(s, { type: 'close', id: 'graph' })
    s = tabsReducer(s, { type: 'close', id: 'thread' })
    expect(s.tabs.map(tabId)).toEqual(['graph', 'thread'])
  })
  it('setThread inserta el hilo despues de Graph y lo saca al apagarse', () => {
    let s = tabsReducer(ESTADO_INICIAL, { type: 'open', tab: nota('a') })
    s = tabsReducer(s, { type: 'setThread', on: true })
    expect(s.tabs.map(tabId)).toEqual(['graph', 'thread', 'note:a'])
    s = tabsReducer(s, { type: 'activate', id: 'thread' })
    s = tabsReducer(s, { type: 'setThread', on: false })
    expect(s.tabs.map(tabId)).toEqual(['graph', 'note:a'])
    expect(s.activeId).toBe('graph')
  })
  it('replace cambia la pestaña de New memory por la memoria guardada, en el mismo lugar', () => {
    let s = tabsReducer(ESTADO_INICIAL, { type: 'open', tab: { kind: 'new', key: 'k1', titulo: '' } })
    s = tabsReducer(s, { type: 'replace', id: 'new:k1', tab: nota('z') })
    expect(s.tabs.map(tabId)).toEqual(['graph', 'note:z'])
    expect(s.activeId).toBe('note:z')
  })
})
