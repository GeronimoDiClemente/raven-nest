import { describe, it, expect, beforeEach } from 'vitest'
import { createSlackServerAdapter, resetSlackCache } from '../integrations/slack'
import { NotConnectedError, type PanelAdapterDeps } from '../integration-panels'

// Canned Slack API responses, indexadas por método (el último segmento del
// pathname de la URL, ej. "conversations.list").
type Handler = (url: URL) => unknown
type Handlers = Partial<Record<string, Handler | unknown>>

function fakeFetch(handlers: Handlers, calls: { method: string; url: string; body?: string }[]): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = url.pathname.replace('/api/', '')
    calls.push({ method, url: url.toString(), body: init?.body as string | undefined })
    const entry = handlers[method]
    const payload = typeof entry === 'function' ? (entry as Handler)(url) : entry
    if (payload === undefined) throw new Error(`no mock handler for slack method "${method}"`)
    return { ok: true, json: async () => payload } as unknown as Response
  }) as unknown as typeof fetch
}

function makeDeps(handlers: Handlers, calls: { method: string; url: string; body?: string }[], overrides: Partial<PanelAdapterDeps> = {}): PanelAdapterDeps {
  return {
    getToken: () => 'xoxb-test-token',
    getConfig: () => ({}),
    fetch: fakeFetch(handlers, calls),
    ...overrides,
  }
}

const USERS_LIST = {
  ok: true,
  members: [
    { id: 'U1', real_name: 'Ada Lovelace', name: 'ada' },
    { id: 'U2', real_name: 'Alan Turing', name: 'alan' },
  ],
}

const CHANNELS_LIST = {
  ok: true,
  channels: [
    { id: 'C1', name: 'raven-nest', num_members: 5 },
    { id: 'C2', name: 'general', num_members: 42 },
  ],
}

const IMS_LIST = {
  ok: true,
  channels: [{ id: 'D1', user: 'U1' }],
}

describe('createSlackServerAdapter', () => {
  beforeEach(() => resetSlackCache())

  it('fetchSections mapea canales (con member count) y DMs (con nombre resuelto)', async () => {
    const calls: { method: string; url: string }[] = []
    const deps = makeDeps({
      'conversations.list': (url: URL) => (url.searchParams.get('types') === 'im' ? IMS_LIST : CHANNELS_LIST),
      'users.list': USERS_LIST,
    }, calls)
    const adapter = createSlackServerAdapter(deps)

    const sections = await adapter.fetchSections({ repoPath: null, branch: null })

    expect(sections).toEqual([
      {
        id: 'channels', label: 'Channels',
        items: [
          { id: 'C1', title: '#raven-nest', subtitle: '5 members' },
          { id: 'C2', title: '#general', subtitle: '42 members' },
        ],
      },
      {
        id: 'dms', label: 'Direct messages',
        items: [{ id: 'D1', title: 'Ada Lovelace', subtitle: 'Direct message' }],
      },
    ])
  })

  it('fetchDetail arma el historial como comment blocks, oldest primero (newest al final)', async () => {
    const calls: { method: string; url: string }[] = []
    const nowSec = Math.floor(Date.now() / 1000)
    const deps = makeDeps({
      'conversations.info': { ok: true, channel: { id: 'C1', name: 'raven-nest', num_members: 5, topic: { value: 'Ship it' } } },
      'users.list': USERS_LIST,
      'conversations.history': {
        ok: true,
        messages: [
          { user: 'U1', text: 'newest message', ts: `${nowSec}.000100` },
          { bot_id: 'B1', username: 'CI Bot', text: 'oldest message', ts: `${nowSec - 3600}.000100` },
        ],
      },
    }, calls)
    const adapter = createSlackServerAdapter(deps)

    const detail = await adapter.fetchDetail({ sectionId: 'channels', itemId: 'C1' })

    expect(detail.title).toBe('#raven-nest')
    expect(detail.meta).toEqual([
      { label: 'Members', value: '5' },
      { label: 'Topic', value: 'Ship it' },
    ])
    expect(detail.blocks).toEqual([
      { kind: 'comment', author: 'CI Bot', when: '1h ago', text: 'oldest message' },
      { kind: 'comment', author: 'Ada Lovelace', when: 'just now', text: 'newest message' },
    ])
  })

  it('cachea conversations.history 60s: una segunda fetchDetail dentro de la ventana no vuelve a pegarle a la API', async () => {
    const calls: { method: string; url: string }[] = []
    const deps = makeDeps({
      'conversations.info': { ok: true, channel: { id: 'C1', name: 'raven-nest', num_members: 5 } },
      'users.list': USERS_LIST,
      'conversations.history': { ok: true, messages: [{ user: 'U1', text: 'hi', ts: '1700000000.000100' }] },
    }, calls)
    const adapter = createSlackServerAdapter(deps)
    const ref = { sectionId: 'channels', itemId: 'C1' }

    await adapter.fetchDetail(ref)
    await adapter.fetchDetail(ref)

    const historyCalls = calls.filter((c) => c.method === 'conversations.history')
    expect(historyCalls.length).toBe(1)
  })

  it("runAction('refresh') invalida el cache de historial del canal", async () => {
    const calls: { method: string; url: string }[] = []
    const deps = makeDeps({
      'conversations.info': { ok: true, channel: { id: 'C1', name: 'raven-nest', num_members: 5 } },
      'users.list': USERS_LIST,
      'conversations.history': { ok: true, messages: [{ user: 'U1', text: 'hi', ts: '1700000000.000100' }] },
    }, calls)
    const adapter = createSlackServerAdapter(deps)
    const ref = { sectionId: 'channels', itemId: 'C1' }

    await adapter.fetchDetail(ref)
    await adapter.runAction('refresh', ref)
    await adapter.fetchDetail(ref)

    const historyCalls = calls.filter((c) => c.method === 'conversations.history')
    expect(historyCalls.length).toBe(2)
  })

  it('resolveWorktreeEntity usa el channel del config si está seteado', async () => {
    const calls: { method: string; url: string }[] = []
    const deps = makeDeps({ 'conversations.list': CHANNELS_LIST }, calls, {
      getConfig: () => ({ channel: '#general' }),
    })
    const adapter = createSlackServerAdapter(deps)

    const ref = await adapter.resolveWorktreeEntity({ repoPath: '/Users/me/whatever-repo', branch: 'main' })

    expect(ref).toEqual({ sectionId: 'channels', itemId: 'C2' })
  })

  it('resolveWorktreeEntity cae al nombre del folder del repo si no hay config channel', async () => {
    const calls: { method: string; url: string }[] = []
    const deps = makeDeps({ 'conversations.list': CHANNELS_LIST }, calls)
    const adapter = createSlackServerAdapter(deps)

    const ref = await adapter.resolveWorktreeEntity({ repoPath: '/Users/me/Raven Nest', branch: 'main' })

    expect(ref).toEqual({ sectionId: 'channels', itemId: 'C1' })
  })

  it('resolveWorktreeEntity devuelve null si no matchea ningún canal', async () => {
    const calls: { method: string; url: string }[] = []
    const deps = makeDeps({ 'conversations.list': CHANNELS_LIST }, calls)
    const adapter = createSlackServerAdapter(deps)

    const ref = await adapter.resolveWorktreeEntity({ repoPath: '/Users/me/no-such-channel', branch: null })

    expect(ref).toBeNull()
  })

  it('compose hace chat.postMessage con el canal y el texto + fence de código', async () => {
    const calls: { method: string; url: string; body?: string }[] = []
    const deps = makeDeps({ 'chat.postMessage': { ok: true } }, calls)
    const adapter = createSlackServerAdapter(deps)

    await adapter.compose({ sectionId: 'channels', itemId: 'C1' }, { text: 'status update', terminalOutput: '$ npm test\nok' })

    const postCall = calls.find((c) => c.method === 'chat.postMessage')
    expect(postCall).toBeDefined()
    const body = JSON.parse(postCall!.body!)
    expect(body).toEqual({
      channel: 'C1',
      text: 'status update\n```\n$ npm test\nok\n```',
    })
  })

  it('tira NotConnectedError si no hay token guardado', async () => {
    const calls: { method: string; url: string }[] = []
    const deps = makeDeps({}, calls, { getToken: () => null })
    const adapter = createSlackServerAdapter(deps)

    await expect(adapter.fetchSections({ repoPath: null, branch: null })).rejects.toBeInstanceOf(NotConnectedError)
  })

  it('mapea invalid_auth de la API de Slack a NotConnectedError', async () => {
    const calls: { method: string; url: string }[] = []
    const deps = makeDeps({ 'conversations.list': { ok: false, error: 'invalid_auth' } }, calls)
    const adapter = createSlackServerAdapter(deps)

    // resolveWorktreeEntity solo pega conversations.list, sin la carrera de
    // Promise.all de fetchSections (que también pide users.list).
    await expect(adapter.resolveWorktreeEntity({ repoPath: '/x/general', branch: null })).rejects.toBeInstanceOf(NotConnectedError)
  })

  it('mapea otros errores de Slack a un Error genérico con el código incluido', async () => {
    const calls: { method: string; url: string }[] = []
    const deps = makeDeps({ 'conversations.list': { ok: false, error: 'ratelimited' } }, calls)
    const adapter = createSlackServerAdapter(deps)

    await expect(adapter.resolveWorktreeEntity({ repoPath: '/x/general', branch: null })).rejects.toThrow(/ratelimited/)
  })
})
