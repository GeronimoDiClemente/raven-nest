// Adapter real de Slack (plan Hito 2+ Task S). Token = deps.getToken('slack')
// (bot token del exchange OAuth main-side, ver plan §Auth). Todas las
// llamadas van Bearer <token> a slack.com/api/*.
//
// Nota de arquitectura: el host (electron/integration-panels.ts, callPanel)
// invoca `factory(deps)` de nuevo en CADA llamada IPC — no hay una instancia
// larga del adapter. Por eso los caches (historial, users.list) viven a
// nivel de módulo, afuera de createSlackServerAdapter, para sobrevivir entre
// llamadas (si no, 'refresh' no podría invalidar nada y cachear no serviría
// de nada contra el rate limit de 1 req/min de conversations.history fuera
// del Marketplace).
import { basename } from 'path'
import {
  NotConnectedError,
  type PanelAdapterDeps,
  type ServerPanelAdapter,
  type WorktreeContext,
  type ItemRef,
  type Section,
  type SectionItem,
  type DetailModel,
  type PanelAction,
  type ComposeBody,
} from '../integration-panels'

const HISTORY_TTL_MS = 60_000
const USERS_TTL_MS = 60_000

interface SlackMessage {
  user?: string
  bot_id?: string
  username?: string
  text: string
  ts: string
}

interface SlackUser {
  id: string
  real_name?: string
  name?: string
}

interface SlackChannelSummary {
  id: string
  name: string
  num_members?: number
}

interface SlackImSummary {
  id: string
  user: string
}

interface SlackChannelInfo {
  id: string
  name?: string
  is_im?: boolean
  user?: string
  num_members?: number
  topic?: { value?: string }
}

interface HistoryCacheEntry {
  messages: SlackMessage[]
  expiresAt: number
}

// Caches a nivel de módulo (ver nota arriba). Compartidos entre todas las
// instancias del adapter en el proceso main.
const historyCache = new Map<string, HistoryCacheEntry>()
let usersCache: { byId: Map<string, SlackUser>; expiresAt: number } | null = null

// Solo para tests: limpia los caches de módulo entre casos.
export function resetSlackCache(): void {
  historyCache.clear()
  usersCache = null
}

// slug estilo repo-folder / config channel: minúsculas, no-alfanumérico -> '-'.
function slugify(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Relative time legible desde un ts de Slack ("1719000000.000100"), sin deps
// externas (Intl.RelativeTimeFormat sería una opción pero esto alcanza y es
// más fácil de testear de forma determinística).
function relativeTime(ts: string, now: number = Date.now()): string {
  const ms = Number(ts.split('.')[0]) * 1000
  const diffSec = Math.max(0, Math.round((now - ms) / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  const diffDay = Math.round(diffHour / 24)
  return `${diffDay}d ago`
}

function requireToken(deps: PanelAdapterDeps): string {
  const token = deps.getToken('slack')
  if (!token) throw new NotConnectedError()
  return token
}

const AUTH_ERROR_CODES = new Set(['invalid_auth', 'token_revoked', 'account_inactive', 'not_authed'])

async function slackApi<T>(
  deps: PanelAdapterDeps,
  token: string,
  method: string,
  opts: { verb?: 'GET' | 'POST'; params?: Record<string, string>; body?: Record<string, unknown> } = {},
): Promise<T> {
  let url = `https://slack.com/api/${method}`
  if (opts.params) url += `?${new URLSearchParams(opts.params).toString()}`
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  const init: RequestInit = { method: opts.verb ?? 'GET', headers }
  if (opts.body) {
    headers['Content-Type'] = 'application/json; charset=utf-8'
    init.body = JSON.stringify(opts.body)
  }
  const res = await deps.fetch(url, init)
  const json = (await res.json()) as { ok: boolean; error?: string } & Record<string, unknown>
  if (!json.ok) {
    if (json.error && AUTH_ERROR_CODES.has(json.error)) throw new NotConnectedError()
    throw new Error(`slack ${method}: ${json.error ?? 'unknown_error'}`)
  }
  return json as T
}

async function getUsersById(deps: PanelAdapterDeps, token: string): Promise<Map<string, SlackUser>> {
  if (usersCache && usersCache.expiresAt > Date.now()) return usersCache.byId
  const json = await slackApi<{ members: SlackUser[] }>(deps, token, 'users.list')
  const byId = new Map(json.members.map((u) => [u.id, u] as const))
  usersCache = { byId, expiresAt: Date.now() + USERS_TTL_MS }
  return byId
}

function userLabel(users: Map<string, SlackUser>, userId: string | undefined): string {
  if (!userId) return 'Unknown'
  const u = users.get(userId)
  return u?.real_name || u?.name || userId
}

async function getHistory(deps: PanelAdapterDeps, token: string, channelId: string): Promise<SlackMessage[]> {
  const cached = historyCache.get(channelId)
  if (cached && cached.expiresAt > Date.now()) return cached.messages
  const json = await slackApi<{ messages: SlackMessage[] }>(deps, token, 'conversations.history', {
    params: { channel: channelId, limit: '30' },
  })
  historyCache.set(channelId, { messages: json.messages, expiresAt: Date.now() + HISTORY_TTL_MS })
  return json.messages
}

async function fetchChannels(deps: PanelAdapterDeps, token: string): Promise<SlackChannelSummary[]> {
  const json = await slackApi<{ channels: SlackChannelSummary[] }>(deps, token, 'conversations.list', {
    params: { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '100' },
  })
  return json.channels
}

async function fetchIms(deps: PanelAdapterDeps, token: string): Promise<SlackImSummary[]> {
  const json = await slackApi<{ channels: SlackImSummary[] }>(deps, token, 'conversations.list', {
    params: { types: 'im', exclude_archived: 'true', limit: '100' },
  })
  return json.channels
}

export function createSlackServerAdapter(deps: PanelAdapterDeps): ServerPanelAdapter {
  return {
    async fetchSections(_ctx: WorktreeContext): Promise<Section[]> {
      const token = requireToken(deps)
      const [channels, ims, users] = await Promise.all([
        fetchChannels(deps, token),
        fetchIms(deps, token),
        getUsersById(deps, token),
      ])

      const channelItems: SectionItem[] = channels.map((c) => ({
        id: c.id,
        title: `#${c.name}`,
        subtitle: c.num_members != null ? `${c.num_members} members` : undefined,
      }))

      const dmItems: SectionItem[] = ims.map((im) => ({
        id: im.id,
        title: userLabel(users, im.user),
        subtitle: 'Direct message',
      }))

      return [
        { id: 'channels', label: 'Channels', items: channelItems },
        { id: 'dms', label: 'Direct messages', items: dmItems },
      ]
    },

    async fetchDetail(ref: ItemRef): Promise<DetailModel> {
      const token = requireToken(deps)
      const channelId = ref.itemId
      const [infoJson, users, messages] = await Promise.all([
        slackApi<{ channel: SlackChannelInfo }>(deps, token, 'conversations.info', { params: { channel: channelId } }),
        getUsersById(deps, token),
        getHistory(deps, token, channelId),
      ])
      const channel = infoJson.channel
      const isIm = Boolean(channel.is_im)
      const title = isIm ? userLabel(users, channel.user) : `#${channel.name ?? channelId}`

      const meta: { label: string; value: string }[] = []
      if (isIm) {
        meta.push({ label: 'Type', value: 'Direct message' })
      } else {
        meta.push({ label: 'Members', value: String(channel.num_members ?? 0) })
        if (channel.topic?.value) meta.push({ label: 'Topic', value: channel.topic.value })
      }

      // conversations.history llega newest-first (ts descendente); se
      // invierte para que el más viejo quede arriba y el más nuevo abajo,
      // como un chat normal.
      const blocks = [...messages].reverse().map((m) => ({
        kind: 'comment' as const,
        author: m.bot_id ? (m.username ?? 'Bot') : userLabel(users, m.user),
        when: relativeTime(m.ts),
        text: m.text,
      }))

      return { ref, title, meta, blocks }
    },

    async resolveWorktreeEntity(ctx: WorktreeContext): Promise<ItemRef | null> {
      const token = requireToken(deps)
      const configuredChannel = deps.getConfig('slack').channel
      const wanted = typeof configuredChannel === 'string' && configuredChannel.trim()
        ? slugify(configuredChannel)
        : ctx.repoPath
          ? slugify(basename(ctx.repoPath))
          : null
      if (!wanted) return null

      const channels = await fetchChannels(deps, token)
      const match = channels.find((c) => slugify(c.name) === wanted)
      return match ? { sectionId: 'channels', itemId: match.id } : null
    },

    actions(_detail: DetailModel): PanelAction[] {
      return [{ id: 'refresh', label: '↻ Refresh', kind: 'secondary' }]
    },

    async runAction(actionId: string, ref: ItemRef): Promise<void> {
      if (actionId === 'refresh') {
        historyCache.delete(ref.itemId)
      }
    },

    async compose(target: ItemRef, body: ComposeBody): Promise<void> {
      const token = requireToken(deps)
      const text = body.terminalOutput ? `${body.text}\n\`\`\`\n${body.terminalOutput}\n\`\`\`` : body.text
      await slackApi(deps, token, 'chat.postMessage', {
        verb: 'POST',
        body: { channel: target.itemId, text },
      })
    },
  }
}
