import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

export interface ChatEvent {
  kind: 'event'
  id: string
  created_at: string
  github_event_id: string
  event_type: string
  actor_login: string
  actor_avatar_url: string | null
  repo_full_name: string
  payload: Record<string, unknown>
}

export interface ChatMessage {
  kind: 'message'
  id: string
  created_at: string
  user_id: string
  user_email: string
  github_login: string | null
  content: string
}

export type ChatItem = ChatEvent | ChatMessage

export interface ChatReaction {
  id: string
  user_id: string
  user_email: string
  target_type: 'event' | 'message'
  target_id: string
  emoji: string
}

interface DBChatEvent {
  id: string
  github_event_id: string
  event_type: string
  actor_login: string
  actor_avatar_url: string | null
  repo_full_name: string
  payload: Record<string, unknown>
  event_created_at: string
}

interface DBChatMessage {
  id: string
  user_id: string
  user_email: string
  github_login: string | null
  content: string
  created_at: string
}

const POLL_INTERVAL_MS = 60_000
const REPO_EVENTS_PER_POLL = 30
const SUPPORTED_TYPES = new Set(['PushEvent', 'PullRequestEvent', 'IssuesEvent', 'CreateEvent', 'PullRequestReviewEvent'])

interface UseTeamChatArgs {
  teamId: string | null
  userId: string | null
  userEmail: string | null
  githubLogin: string | null
  githubToken: string | null
  repos: Array<{ repo_full_name: string }>
}

export function useTeamChat({ teamId, userId, userEmail, githubLogin, githubToken, repos }: UseTeamChatArgs) {
  const [events, setEvents] = useState<ChatEvent[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [reactions, setReactions] = useState<ChatReaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reposRef = useRef(repos)
  reposRef.current = repos
  const knownIdsRef = useRef<Set<string>>(new Set())
  // Disabled when the server returns 403/permission errors so we stop hammering
  // Supabase from a polling/realtime loop the user no longer has access to.
  const disabledRef = useRef(false)

  // Initial load
  const load = useCallback(async () => {
    if (!teamId || disabledRef.current) { setEvents([]); setMessages([]); setReactions([]); return }
    setLoading(true)
    setError(null)
    try {
      const [evRes, msgRes, reactRes] = await Promise.all([
        supabase
          .from('team_chat_events')
          .select('id, github_event_id, event_type, actor_login, actor_avatar_url, repo_full_name, payload, event_created_at')
          .eq('team_id', teamId)
          .order('event_created_at', { ascending: false })
          .limit(100),
        supabase
          .from('team_chat_messages')
          .select('id, user_id, user_email, github_login, content, created_at')
          .eq('team_id', teamId)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('team_chat_reactions')
          .select('id, user_id, user_email, target_type, target_id, emoji')
          .eq('team_id', teamId),
      ])
      // Detect RLS / permission denials and shut the loop down — repeated 403s
      // mean the user is not (or no longer) a member of this team and retrying
      // will never succeed.
      const firstAuthErr = [evRes.error, msgRes.error, reactRes.error].find(
        e => e && (e.code === '42501' || e.code === 'PGRST301' || /permission denied|not authorized/i.test(e.message ?? ''))
      )
      if (firstAuthErr) {
        disabledRef.current = true
        throw firstAuthErr
      }
      if (evRes.error) throw evRes.error
      if (msgRes.error) throw msgRes.error
      if (reactRes.error) throw reactRes.error
      const dbEvents = (evRes.data ?? []) as DBChatEvent[]
      setEvents(dbEvents.map(e => ({
        kind: 'event' as const,
        id: e.id,
        created_at: e.event_created_at,
        github_event_id: e.github_event_id,
        event_type: e.event_type,
        actor_login: e.actor_login,
        actor_avatar_url: e.actor_avatar_url,
        repo_full_name: e.repo_full_name,
        payload: e.payload,
      })))
      knownIdsRef.current = new Set(dbEvents.map(e => e.github_event_id))
      const dbMessages = (msgRes.data ?? []) as DBChatMessage[]
      setMessages(dbMessages.map(m => ({ kind: 'message' as const, ...m })))
      setReactions((reactRes.data ?? []) as ChatReaction[])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load chat')
    } finally {
      setLoading(false)
    }
  }, [teamId])

  // Reset the kill-switch when the team changes — a different team may have
  // valid permissions even if the previous one didn't.
  useEffect(() => { disabledRef.current = false }, [teamId])

  useEffect(() => { load() }, [load])

  // Realtime subscription
  useEffect(() => {
    if (!teamId) return
    const channel = supabase
      .channel(`team_chat:${teamId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'team_chat_events', filter: `team_id=eq.${teamId}` },
        () => { if (!disabledRef.current) load() })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'team_chat_messages', filter: `team_id=eq.${teamId}` },
        () => { if (!disabledRef.current) load() })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'team_chat_reactions', filter: `team_id=eq.${teamId}` },
        () => { if (!disabledRef.current) load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [teamId, load])

  // Poll GitHub events for the team's repos and ingest new ones
  const pollGitHubEvents = useCallback(async () => {
    if (!teamId || !githubToken || reposRef.current.length === 0) return
    try {
      const knownIds = knownIdsRef.current
      const newRows: Array<{
        team_id: string
        github_event_id: string
        event_type: string
        actor_login: string
        actor_avatar_url: string | null
        repo_full_name: string
        payload: Record<string, unknown>
        event_created_at: string
      }> = []
      await Promise.all(reposRef.current.map(async repo => {
        try {
          const res = await fetch(
            `https://api.github.com/repos/${repo.repo_full_name}/events?per_page=${REPO_EVENTS_PER_POLL}`,
            { headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github.v3+json' } }
          )
          if (!res.ok) return
          const items = await res.json() as Array<{
            id: string
            type: string
            actor: { login: string; avatar_url: string }
            repo: { name: string }
            created_at: string
            payload: Record<string, unknown>
          }>
          for (const ev of items) {
            if (!SUPPORTED_TYPES.has(ev.type)) continue
            if (ev.type === 'PushEvent' && ((ev.payload.commits as unknown[])?.length ?? 0) === 0) continue
            if (knownIds.has(ev.id)) continue
            newRows.push({
              team_id: teamId,
              github_event_id: ev.id,
              event_type: ev.type,
              actor_login: ev.actor.login,
              actor_avatar_url: ev.actor.avatar_url,
              repo_full_name: repo.repo_full_name,
              payload: ev.payload,
              event_created_at: ev.created_at,
            })
          }
        } catch { /* ignore individual repo failures */ }
      }))
      if (newRows.length > 0) {
        const { error } = await supabase.from('team_chat_events').upsert(newRows, { onConflict: 'team_id,github_event_id', ignoreDuplicates: true })
        if (error) console.warn('[useTeamChat.pollGitHubEvents] upsert team_chat_events failed', { count: newRows.length }, error)
      }
    } catch { /* swallow polling errors */ }
  }, [teamId, githubToken])

  // Run polling on mount + every interval + on repo change
  useEffect(() => {
    if (!teamId || !githubToken) return
    pollGitHubEvents()
    const t = setInterval(pollGitHubEvents, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [teamId, githubToken, pollGitHubEvents])

  const postMessage = useCallback(async (content: string): Promise<{ ok: boolean; error?: string }> => {
    if (!teamId || !userId || !userEmail) return { ok: false, error: 'No session' }
    const trimmed = content.trim()
    if (!trimmed) return { ok: false, error: 'Empty message' }
    const { error } = await supabase.from('team_chat_messages').insert({
      team_id: teamId,
      user_id: userId,
      user_email: userEmail,
      github_login: githubLogin,
      content: trimmed,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }, [teamId, userId, userEmail, githubLogin])

  const deleteMessage = useCallback(async (id: string) => {
    const { error } = await supabase.from('team_chat_messages').delete().eq('id', id)
    if (error) console.warn('[useTeamChat.deleteMessage] delete failed', { id }, error)
  }, [])

  const toggleReaction = useCallback(async (
    targetType: 'event' | 'message', targetId: string, emoji: string
  ) => {
    if (!teamId || !userId || !userEmail) return
    const existing = reactions.find(r =>
      r.user_id === userId && r.target_type === targetType && r.target_id === targetId && r.emoji === emoji
    )
    if (existing) {
      const { error } = await supabase.from('team_chat_reactions').delete().eq('id', existing.id)
      if (error) console.warn('[useTeamChat.toggleReaction] delete failed', { id: existing.id }, error)
    } else {
      const { error } = await supabase.from('team_chat_reactions').insert({
        team_id: teamId,
        user_id: userId,
        user_email: userEmail,
        target_type: targetType,
        target_id: targetId,
        emoji,
      })
      if (error) console.warn('[useTeamChat.toggleReaction] insert failed', { targetType, targetId, emoji }, error)
    }
  }, [teamId, userId, userEmail, reactions])

  // Combined timeline (newest first)
  const timeline: ChatItem[] = [...events, ...messages].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  return {
    timeline,
    reactions,
    loading,
    error,
    refresh: load,
    postMessage,
    deleteMessage,
    toggleReaction,
  }
}
