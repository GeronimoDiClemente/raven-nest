// Decisión de Gero del 2026-10-09: la clave interna `__global__` no se muestra. Se veía tal
// cual en la lista y en la leyenda del grafo (e2e de dos máquinas en la app real).
import { describe, it, expect } from 'vitest'
import { nombreDeProyecto } from '../lib/nombre-de-proyecto'
import { projectGroups } from '../lib/memory-graph-visuals'

describe('el nombre visible de un proyecto', () => {
  it('las memorias sin repo dicen Global, aunque la fila guarde la clave como nombre', () => {
    expect(nombreDeProyecto('__global__', '__global__')).toBe('Global')
    expect(nombreDeProyecto('__global__', null)).toBe('Global')
  })

  it('los demás usan su nombre, y la clave si no tienen', () => {
    expect(nombreDeProyecto('a1b2c3', 'raven-nest')).toBe('raven-nest')
    expect(nombreDeProyecto('a1b2c3', null)).toBe('a1b2c3')
    expect(nombreDeProyecto('a1b2c3', undefined)).toBe('a1b2c3')
  })

  it('la leyenda del grafo agrupa las sueltas bajo Global', () => {
    const nodo = (syncId: string, projectKey: string, projectDisplayName: string | null) => ({
      syncId, projectKey, projectDisplayName, tags: [], title: syncId, type: 'decision',
      scope: 'personal', topicKey: null, gitBranch: null, originAi: null, authorDisplay: null,
      updatedAt: 1, superseded: false,
    })
    const grupos = projectGroups({
      nodes: [nodo('a', '__global__', '__global__'), nodo('b', 'k1', 'raven-nest')],
      edges: [], truncated: 0,
    } as unknown as Parameters<typeof projectGroups>[0])
    expect(grupos.map((g) => g.label).sort()).toEqual(['Global', 'raven-nest'])
  })
})
