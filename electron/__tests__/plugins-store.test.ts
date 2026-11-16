import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PluginsStore } from '../plugins-store'

describe('PluginsStore', () => {
  let store: PluginsStore
  beforeEach(() => {
    store = new PluginsStore(mkdtempSync(join(tmpdir(), 'nest-plugins-')))
  })

  it('arranca vacío', () => {
    expect(store.list()).toEqual([])
  })

  it('guarda, actualiza por (pluginId, scope) y borra', () => {
    store.save({ pluginId: 'slack', scope: 'personal', enabled: true, config: {} })
    expect(store.list()).toHaveLength(1)
    store.save({ pluginId: 'slack', scope: 'personal', enabled: false, config: { channel: '#x' } })
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].enabled).toBe(false)
    store.delete('slack')
    expect(store.list()).toEqual([])
  })
})
