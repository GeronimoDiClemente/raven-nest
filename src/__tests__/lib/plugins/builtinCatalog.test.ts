import { describe, it, expect } from 'vitest'
import { BUILTIN_CATALOG } from '../../../lib/plugins/builtinCatalog'
import { validateManifest } from '../../../lib/plugins/manifest'

describe('BUILTIN_CATALOG', () => {
  it('incluye slack, notion y jira', () => {
    const ids = BUILTIN_CATALOG.map(p => p.id)
    expect(ids).toEqual(expect.arrayContaining(['slack', 'notion', 'jira']))
  })
  it('todas las entradas son manifests válidos', () => {
    for (const p of BUILTIN_CATALOG) expect(validateManifest(p)).not.toBeNull()
  })
  it('slack expone la acción notify y el hook onAgentDone', () => {
    const slack = BUILTIN_CATALOG.find(p => p.id === 'slack')!
    expect(slack.contributes?.menuItems?.[0].actionId).toBe('notify')
    expect(slack.contributes?.events?.some(e => e.on === 'onAgentDone')).toBe(true)
  })
})
