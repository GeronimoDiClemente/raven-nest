import { describe, it, expect } from 'vitest'
import { tabsReducer, ESTADO_INICIAL, tabId, esFija, SECCIONES_DE_SETTINGS } from '../../lib/memory-tabs'

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

describe('pestaña Settings', () => {
  it('openSettings la agrega al final, la activa y arranca en Sync', () => {
    let s = tabsReducer(ESTADO_INICIAL, { type: 'open', tab: { kind: 'note', syncId: 'a' } })
    s = tabsReducer(s, { type: 'openSettings' })
    expect(s.tabs[s.tabs.length - 1]).toEqual({ kind: 'settings', section: 'sync' })
    expect(s.activeId).toBe('settings')
  })

  it('si ya existe la activa sin duplicarla, y cambia de sección si se pide una', () => {
    let s = tabsReducer(ESTADO_INICIAL, { type: 'openSettings', section: 'disk' })
    s = tabsReducer(s, { type: 'activate', id: 'graph' })
    s = tabsReducer(s, { type: 'openSettings' })
    expect(s.tabs.filter((t) => t.kind === 'settings')).toEqual([{ kind: 'settings', section: 'disk' }])
    expect(s.activeId).toBe('settings')
    s = tabsReducer(s, { type: 'openSettings', section: 'advanced' })
    expect(s.tabs.filter((t) => t.kind === 'settings')).toEqual([{ kind: 'settings', section: 'advanced' }])
  })

  it('se cierra como una común: no es fija y la activa pasa a la de la izquierda', () => {
    const tab = { kind: 'settings' as const, section: 'sync' as const }
    expect(tabId(tab)).toBe('settings')
    expect(esFija(tab)).toBe(false)
    let s = tabsReducer(ESTADO_INICIAL, { type: 'openSettings' })
    s = tabsReducer(s, { type: 'close', id: 'settings' })
    expect(s.tabs.some((t) => t.kind === 'settings')).toBe(false)
    expect(s.activeId).toBe('graph')
  })

  it('las secciones van en el orden del spec, sin números', () => {
    expect(SECCIONES_DE_SETTINGS.map((x) => x.titulo)).toEqual(['Sync', 'Encryption', 'Editor & graph', 'This project', 'Notes on disk', 'Advanced'])
  })
})
