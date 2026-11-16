import { describe, it, expect } from 'vitest'
import { renderBranchNote, renderThreadIndex, branchSlug } from '../integrations/team-thread-note'
import type { MemoryRecord } from '../integrations/memory-port'

function record(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    syncId: 'obs-aaaaaaaaaaaaaaaa',
    projectKey: 'proj1111aaaaaaaa',
    scope: 'team',
    topicKey: null,
    type: 'handoff',
    title: 'Segunda vuelta del sidebar',
    content: 'El repo va debajo de las pestanas.',
    tags: [],
    source: 'hook',
    originAi: 'claude',
    originAccount: 'Gero Personal',
    gitBranch: 'feat/sidebar-tabs',
    authorDisplay: 'Gero',
    sourceRef: null,
    contentHash: 'hash-v1',
    revisionCount: 0,
    duplicateCount: 0,
    createdAt: Date.UTC(2026, 8, 7, 14, 20),
    updatedAt: Date.UTC(2026, 8, 7, 14, 20),
    deleted: false,
    supersededBy: null,
    ...over,
  }
}

describe('branchSlug', () => {
  it('convierte una rama con barra en un slug de un solo segmento', () => {
    expect(branchSlug('feat/sidebar-tabs')).toBe('feat-sidebar-tabs')
  })

  it('las filas sin rama caen en general', () => {
    expect(branchSlug(null)).toBe('general')
  })
})

describe('renderBranchNote', () => {
  it('pone las entradas de la mas nueva a la mas vieja, con autor y fecha', () => {
    const nota = renderBranchNote({
      branch: 'feat/sidebar-tabs',
      estado: 'activa',
      entries: [
        record({ syncId: 'obs-1', createdAt: Date.UTC(2026, 8, 7, 2, 10), title: 'Tipografia', content: 'Inter nunca estuvo empaquetada.' }),
        record({ syncId: 'obs-2', createdAt: Date.UTC(2026, 8, 7, 14, 20), title: 'Segunda vuelta', content: 'El repo va debajo.' }),
      ],
      neighbours: ['memory-bridge'],
    })

    const posSegunda = nota.indexOf('Segunda vuelta')
    const posTipografia = nota.indexOf('Tipografia')
    expect(posSegunda).toBeGreaterThan(-1)
    expect(posSegunda).toBeLessThan(posTipografia)
    expect(nota).toContain('2026-09-07 14:20 · Gero')
    expect(nota).toContain('[[_index]]')
    expect(nota).toContain('[[memory-bridge]]')
  })

  it('el frontmatter lleva estado y ultima entrada, y NO lleva marca de sync', () => {
    const nota = renderBranchNote({
      branch: 'feat/sidebar-tabs',
      estado: 'cerrada',
      entries: [record({ createdAt: Date.UTC(2026, 8, 7, 14, 20) })],
      neighbours: [],
    })

    expect(nota).toContain('nest_scope: "team"')
    expect(nota).toContain('nest_estado: "cerrada"')
    expect(nota).toContain('nest_ultima_entrada: "2026-09-07T14:20:00.000Z"')
    expect(nota).not.toContain('nest_ultima_sync')
  })

  it('una fila con content null no rompe el render', () => {
    const nota = renderBranchNote({
      branch: 'main',
      estado: 'activa',
      entries: [record({ content: null })],
      neighbours: [],
    })
    expect(nota).toContain('# main')
  })
})

describe('renderThreadIndex', () => {
  it('lista una linea por rama, la mas reciente primero, y lleva la marca de sync al minuto', () => {
    const indice = renderThreadIndex({
      displayName: 'raven-nest',
      ultimaSync: Date.UTC(2026, 8, 8, 14, 22, 47),
      branches: [
        { slug: 'memory-bridge', branch: 'smoke/memory-bridge', estado: 'activa', ultimoAutor: 'Gero', ultimaEntrada: Date.UTC(2026, 8, 6, 10, 0), entradas: 3 },
        { slug: 'feat-sidebar-tabs', branch: 'feat/sidebar-tabs', estado: 'activa', ultimoAutor: 'Bauti', ultimaEntrada: Date.UTC(2026, 8, 7, 14, 20), entradas: 2 },
      ],
    })

    expect(indice).toContain('nest_ultima_sync: "2026-09-08T14:22:00.000Z"')
    const posSidebar = indice.indexOf('[[feat-sidebar-tabs]]')
    const posBridge = indice.indexOf('[[memory-bridge]]')
    expect(posSidebar).toBeLessThan(posBridge)
    expect(indice).toContain('Bauti')
  })

  it('avisa cuando recorta por el techo de lineas', () => {
    const branches = Array.from({ length: 260 }, (_, i) => ({
      slug: `rama-${i}`,
      branch: `feat/rama-${i}`,
      estado: 'activa' as const,
      ultimoAutor: 'Gero',
      ultimaEntrada: i,
      entradas: 1,
    }))
    const indice = renderThreadIndex({ displayName: 'raven-nest', ultimaSync: 0, branches })

    expect(indice.split('\n').length).toBeLessThanOrEqual(200)
    expect(indice).toContain('recortado por recencia')
  })
})
