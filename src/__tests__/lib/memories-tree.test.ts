import { describe, it, expect } from 'vitest'
import { armarArbol } from '../../lib/memories-tree'
import type { MemoryGraphNode } from '../../types'

const n = (o: Partial<MemoryGraphNode> & { syncId: string }): MemoryGraphNode => ({
  projectKey: 'p1', projectDisplayName: 'raven-nest', tags: [], title: o.syncId, type: 'decision',
  scope: 'personal', topicKey: null, gitBranch: null, originAi: null, authorDisplay: null,
  updatedAt: 1, superseded: false, ...o,
})

describe('armarArbol', () => {
  it('Global primero, proyectos por nombre, Team al final', () => {
    const arbol = armarArbol([
      n({ syncId: 'a', projectKey: 'p2', projectDisplayName: 'zeta' }),
      n({ syncId: 'b', projectKey: '__global__', projectDisplayName: '__global__' }),
      n({ syncId: 'c', scope: 'team' }),
      n({ syncId: 'd', projectKey: 'p1', projectDisplayName: 'alfa' }),
    ], null)
    expect(arbol.map((c) => c.nombre)).toEqual(['Global', 'alfa', 'zeta', 'Team'])
    expect(arbol.map((c) => c.id)).toEqual(['global', 'project:p1', 'project:p2', 'team'])
  })
  it('saca huecos y reemplazadas, y ordena por fecha descendente', () => {
    const [c] = armarArbol([
      n({ syncId: 'viejo', updatedAt: 1 }), n({ syncId: 'nuevo', updatedAt: 5 }),
      n({ syncId: 'hueco', pending: true }), n({ syncId: 'reemplazada', superseded: true }),
    ], null)
    expect(c.items.map((i) => i.syncId)).toEqual(['nuevo', 'viejo'])
  })
  it('con busqueda deja solo las coincidencias y saca carpetas vacias', () => {
    const arbol = armarArbol([n({ syncId: 'a' }), n({ syncId: 'b', scope: 'team' })], new Set(['a']))
    expect(arbol).toHaveLength(1)
    expect(arbol[0].items.map((i) => i.syncId)).toEqual(['a'])
  })
})
