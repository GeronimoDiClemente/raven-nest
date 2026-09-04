import { describe, it, expect } from 'vitest'
import { createMockAdapter } from '../../integrations/mockAdapter'
import { getAdapter } from '../../integrations/registry'

const ctx = { repoPath: 'C:/dev/raven-nest', branch: 'feat/integrations' }

describe('mockAdapter', () => {
  it('fetchSections devuelve secciones con items', async () => {
    const a = createMockAdapter()
    const sections = await a.fetchSections(ctx)
    expect(sections.length).toBeGreaterThan(0)
    expect(sections[0].items.length).toBeGreaterThan(0)
  })

  it('resolveWorktreeEntity mapea el branch a un item existente', async () => {
    const a = createMockAdapter()
    const ref = await a.resolveWorktreeEntity(ctx)
    expect(ref).not.toBeNull()
    const detail = await a.fetchDetail(ref!)
    expect(detail.title).toBeTruthy()
  })

  it('resolveWorktreeEntity devuelve null sin branch', async () => {
    const a = createMockAdapter()
    expect(await a.resolveWorktreeEntity({ repoPath: null, branch: null })).toBeNull()
  })

  it('compose agrega un comentario visible en el próximo fetchDetail', async () => {
    const a = createMockAdapter()
    const ref = (await a.resolveWorktreeEntity(ctx))!
    const before = (await a.fetchDetail(ref)).blocks.filter(b => b.kind === 'comment').length
    await a.compose(ref, { text: 'done', terminalOutput: '$ npm test\n✓ 8 passed' })
    const after = (await a.fetchDetail(ref)).blocks.filter(b => b.kind === 'comment').length
    expect(after).toBe(before + 1)
  })

  it('actions devuelve transiciones según el status del detail', async () => {
    const a = createMockAdapter()
    const inProgress = await a.fetchDetail({ sectionId: 'mine', itemId: 'demo-231' })
    expect(a.actions(inProgress).map(x => x.id)).toEqual(['to-review', 'done'])
    const toDo = await a.fetchDetail({ sectionId: 'mine', itemId: 'demo-228' })
    expect(a.actions(toDo).map(x => x.id)).toEqual(['start'])
  })

  it('runAction actualiza el status y un actionId desconocido no lo cambia', async () => {
    const a = createMockAdapter()
    const ref = { sectionId: 'mine', itemId: 'demo-231' }
    await a.runAction('done', ref)
    expect((await a.fetchDetail(ref)).status).toBe('Done')
    await a.runAction('nope', ref)
    expect((await a.fetchDetail(ref)).status).toBe('Done')
  })

  it('registry: getAdapter("demo") devuelve el mock, desconocido devuelve null', () => {
    expect(getAdapter('demo')?.id).toBe('demo')
    expect(getAdapter('nope')).toBeNull()
  })
})
