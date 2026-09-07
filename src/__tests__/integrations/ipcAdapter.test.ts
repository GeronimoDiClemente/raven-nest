import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createIpcAdapter, PanelError } from '../../integrations/ipcAdapter'
import type { DetailModel } from '../../integrations/types'

// Entorno 'node' (no jsdom) — no hay `window` global, lo creamos a mano como
// en el resto de tests que mockean el bridge IPC (IntegrationsMarketplaceView.test.tsx).
function mockPluginPanels(call: (pluginId: string, method: string, args: unknown[]) => Promise<unknown>) {
  ;(globalThis as unknown as { window: { pluginPanels: unknown } }).window = {
    pluginPanels: { call },
  }
}

describe('createIpcAdapter', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window?: unknown }).window = undefined
  })

  it('fetchSections delega a window.pluginPanels.call con pluginId/method/args', async () => {
    const call = vi.fn(async () => ({ ok: true, data: [{ id: 's', label: 'S', items: [] }] }))
    mockPluginPanels(call)
    const a = createIpcAdapter('slack', 'Slack')
    const sections = await a.fetchSections({ repoPath: '/x', branch: 'main' })
    expect(sections).toEqual([{ id: 's', label: 'S', items: [] }])
    expect(call).toHaveBeenCalledWith('slack', 'fetchSections', [{ repoPath: '/x', branch: 'main' }])
  })

  it('fetchDetail cachea las actions por ref y actions(detail) las devuelve sin llamar a IPC de nuevo', async () => {
    const detail: DetailModel = { ref: { sectionId: 'mine', itemId: 'x-1' }, title: 'X', meta: [], blocks: [] }
    const call = vi.fn(async () => ({
      ok: true,
      data: { detail, actions: [{ id: 'close', label: 'Close', kind: 'primary' as const }] },
    }))
    mockPluginPanels(call)
    const a = createIpcAdapter('github', 'GitHub')
    const gotDetail = await a.fetchDetail({ sectionId: 'mine', itemId: 'x-1' })
    expect(gotDetail).toEqual(detail)
    expect(call).toHaveBeenCalledTimes(1)
    expect(a.actions(gotDetail)).toEqual([{ id: 'close', label: 'Close', kind: 'primary' }])
    // No pega IPC de nuevo al pedir actions:
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('actions(detail) sin fetchDetail previo devuelve []', () => {
    mockPluginPanels(vi.fn())
    const a = createIpcAdapter('jira', 'Jira')
    expect(a.actions({ ref: { sectionId: 'a', itemId: 'b' }, title: 'x', meta: [], blocks: [] })).toEqual([])
  })

  it('runAction y compose delegan con los args en orden', async () => {
    const call = vi.fn(async () => ({ ok: true, data: null }))
    mockPluginPanels(call)
    const a = createIpcAdapter('notion', 'Notion')
    await a.runAction('done', { sectionId: 'mine', itemId: 'x-1' })
    expect(call).toHaveBeenCalledWith('notion', 'runAction', ['done', { sectionId: 'mine', itemId: 'x-1' }])
    await a.compose({ sectionId: 'mine', itemId: 'x-1' }, { text: 'hi' })
    expect(call).toHaveBeenCalledWith('notion', 'compose', [{ sectionId: 'mine', itemId: 'x-1' }, { text: 'hi' }])
  })

  it('propaga un error {ok:false} como PanelError con .code y .message', async () => {
    const call = vi.fn(async () => ({ ok: false, error: 'NOT_CONNECTED' as const }))
    mockPluginPanels(call)
    const a = createIpcAdapter('slack', 'Slack')
    await expect(a.fetchSections({ repoPath: null, branch: null })).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    })
    try {
      await a.fetchSections({ repoPath: null, branch: null })
      throw new Error('unreachable')
    } catch (err) {
      expect(err).toBeInstanceOf(PanelError)
    }
  })
})
