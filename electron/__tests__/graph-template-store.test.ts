import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { GraphTemplateStore } from '../integrations/graph-template-store'
import type { GraphTemplate } from '../integrations/graph-template'

let file: string
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'gt-'))
  file = join(dir, 'graph-templates.json')
})

describe('GraphTemplateStore', () => {
  it('lists the 3 built-ins when no file exists', () => {
    const s = new GraphTemplateStore(file)
    expect(s.list().map((t) => t.id).sort()).toEqual(['full', 'quick-fix', 'review-only'])
    expect(s.list().every((t) => t.builtIn)).toBe(true)
  })

  it('persists a custom template and lists it after the built-ins', () => {
    const s = new GraphTemplateStore(file)
    s.save({
      id: 'c1', name: 'Mine', createdAt: 1, updatedAt: 1,
      nodes: [{ id: 'a', role: 'coder', kind: 'agent', dependsOn: [] }],
    })
    const listed = new GraphTemplateStore(file).list()
    expect(listed.map((t) => t.id)).toContain('c1')
    expect(listed.filter((t) => t.builtIn).length).toBe(3)
    expect(listed.find((t) => t.id === 'c1')!.builtIn).toBeUndefined()
  })

  it('save replaces a custom template with the same id (upsert)', () => {
    const s = new GraphTemplateStore(file)
    const base: GraphTemplate = { id: 'c1', name: 'v1', createdAt: 1, updatedAt: 1, nodes: [{ id: 'a', role: 'coder', kind: 'agent', dependsOn: [] }] }
    s.save(base)
    s.save({ ...base, name: 'v2', updatedAt: 2 })
    const customs = new GraphTemplateStore(file).list().filter((t) => !t.builtIn)
    expect(customs).toHaveLength(1)
    expect(customs[0].name).toBe('v2')
  })

  it('delete removes a custom template', () => {
    const s = new GraphTemplateStore(file)
    s.save({ id: 'c1', name: 'Mine', createdAt: 1, updatedAt: 1, nodes: [{ id: 'a', role: 'coder', kind: 'agent', dependsOn: [] }] })
    expect(s.delete('c1')).toBe(true)
    expect(new GraphTemplateStore(file).list().some((t) => t.id === 'c1')).toBe(false)
  })

  it('corrupt file → built-ins only, no throw', () => {
    writeFileSync(file, '{ not json')
    expect(new GraphTemplateStore(file).list().map((t) => t.id).sort()).toEqual(['full', 'quick-fix', 'review-only'])
  })

  it('drops an invalid custom entry but keeps the valid ones', () => {
    writeFileSync(file, JSON.stringify({ version: 1, templates: [
      { id: 'bad', name: 'bad', nodes: [{ id: 'a', role: 'coder', kind: 'agent', dependsOn: ['ghost'] }], createdAt: 0, updatedAt: 0 },
      { id: 'good', name: 'good', nodes: [{ id: 'a', role: 'coder', kind: 'agent', dependsOn: [] }], createdAt: 0, updatedAt: 0 },
    ] }))
    const customs = new GraphTemplateStore(file).list().filter((t) => !t.builtIn)
    expect(customs.map((t) => t.id)).toEqual(['good'])
  })
})
