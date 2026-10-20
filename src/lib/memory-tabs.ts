// Las pestañas del centro de Memories. Graph es la primera y fija; Team thread, fija, aparece
// sólo si el repo activo tiene el hilo prendido. Puro: el hook sólo lo envuelve.
export type MemoryTab =
  | { kind: 'graph' }
  | { kind: 'thread' }
  | { kind: 'note'; syncId: string }
  | { kind: 'new'; key: string; titulo: string }

export interface TabsState { tabs: MemoryTab[]; activeId: string }

export type TabsAction =
  | { type: 'open'; tab: MemoryTab; background?: boolean }
  | { type: 'close'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'replace'; id: string; tab: MemoryTab }
  | { type: 'setThread'; on: boolean }

export function tabId(t: MemoryTab): string {
  switch (t.kind) {
    case 'graph': return 'graph'
    case 'thread': return 'thread'
    case 'note': return `note:${t.syncId}`
    case 'new': return `new:${t.key}`
  }
}

export function esFija(t: MemoryTab): boolean { return t.kind === 'graph' || t.kind === 'thread' }

export const ESTADO_INICIAL: TabsState = { tabs: [{ kind: 'graph' }], activeId: 'graph' }

export function tabsReducer(s: TabsState, a: TabsAction): TabsState {
  switch (a.type) {
    case 'open': {
      const id = tabId(a.tab)
      const ya = s.tabs.some((t) => tabId(t) === id)
      const tabs = ya ? s.tabs : [...s.tabs, a.tab]
      return { tabs, activeId: a.background ? s.activeId : id }
    }
    case 'close': {
      const i = s.tabs.findIndex((t) => tabId(t) === a.id)
      if (i === -1 || esFija(s.tabs[i])) return s
      const tabs = s.tabs.filter((_, j) => j !== i)
      const activeId = s.activeId === a.id ? tabId(tabs[Math.max(0, i - 1)]) : s.activeId
      return { tabs, activeId }
    }
    case 'activate':
      return s.tabs.some((t) => tabId(t) === a.id) ? { ...s, activeId: a.id } : s
    case 'replace': {
      const i = s.tabs.findIndex((t) => tabId(t) === a.id)
      if (i === -1) return s
      const nuevoId = tabId(a.tab)
      const tabs = s.tabs.filter((t, j) => j === i || tabId(t) !== nuevoId).map((t) => (tabId(t) === a.id ? a.tab : t))
      return { tabs, activeId: s.activeId === a.id ? nuevoId : s.activeId }
    }
    case 'setThread': {
      const tiene = s.tabs.some((t) => t.kind === 'thread')
      if (a.on === tiene) return s
      if (a.on) return { ...s, tabs: [s.tabs[0], { kind: 'thread' }, ...s.tabs.slice(1)] }
      return { tabs: s.tabs.filter((t) => t.kind !== 'thread'), activeId: s.activeId === 'thread' ? 'graph' : s.activeId }
    }
  }
}
