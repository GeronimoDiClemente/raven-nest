import { useState, useMemo, useRef, useEffect } from 'react'
import { ChatItem, ChatEvent, ChatMessage, ChatReaction } from '../hooks/useTeamChat'

interface TeamChatProps {
  timeline: ChatItem[]
  reactions: ChatReaction[]
  loading: boolean
  error: string | null
  currentUserId: string | null
  currentUserEmail: string | null
  isLeader: boolean
  onPostMessage: (content: string) => Promise<{ ok: boolean; error?: string }>
  onDeleteMessage: (id: string) => Promise<void>
  onToggleReaction: (targetType: 'event' | 'message', targetId: string, emoji: string) => Promise<void>
}

const REACTION_EMOJIS = ['👍', '❤️', '🔥', '👀', '🎉']

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d`
  return `${Math.floor(days / 30)}mo`
}

function eventDescription(ev: ChatEvent): string {
  const p = ev.payload as {
    action?: string
    ref?: string
    ref_type?: string
    commits?: { sha: string; message: string }[]
    pull_request?: { number: number; title: string }
    issue?: { number: number; title: string }
  }
  switch (ev.event_type) {
    case 'PushEvent': {
      const count = p.commits?.length ?? 0
      const msg = p.commits?.[0]?.message?.split('\n')[0] ?? ''
      return `pushed ${count} commit${count !== 1 ? 's' : ''}${msg ? `: "${msg}"` : ''}`
    }
    case 'PullRequestEvent':
      return `${p.action ?? 'updated'} PR #${p.pull_request?.number ?? ''} "${p.pull_request?.title ?? ''}"`
    case 'PullRequestReviewEvent':
      return `reviewed PR #${p.pull_request?.number ?? ''}`
    case 'IssuesEvent':
      return `${p.action ?? 'updated'} issue #${p.issue?.number ?? ''} "${p.issue?.title ?? ''}"`
    case 'CreateEvent':
      return `created ${p.ref_type ?? 'ref'}${p.ref ? ` "${p.ref}"` : ''}`
    default:
      return ev.event_type
  }
}

function eventIcon(type: string): string {
  switch (type) {
    case 'PushEvent': return '▶'
    case 'PullRequestEvent':
    case 'PullRequestReviewEvent': return '⑂'
    case 'IssuesEvent': return '⚐'
    case 'CreateEvent': return '⑆'
    default: return '·'
  }
}

interface ReactionsBarProps {
  targetType: 'event' | 'message'
  targetId: string
  reactions: ChatReaction[]
  currentUserId: string | null
  onToggle: (targetType: 'event' | 'message', targetId: string, emoji: string) => Promise<void>
}

function ReactionsBar({ targetType, targetId, reactions, currentUserId, onToggle }: ReactionsBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const myReactions = reactions.filter(r => r.target_type === targetType && r.target_id === targetId)
  const grouped = useMemo(() => {
    const m = new Map<string, { count: number; mine: boolean; users: string[] }>()
    for (const r of myReactions) {
      const cur = m.get(r.emoji) ?? { count: 0, mine: false, users: [] }
      cur.count += 1
      if (r.user_id === currentUserId) cur.mine = true
      cur.users.push(r.user_email.split('@')[0])
      m.set(r.emoji, cur)
    }
    return Array.from(m.entries())
  }, [myReactions, currentUserId])

  return (
    <div className="chat-reactions">
      {grouped.map(([emoji, info]) => (
        <button
          key={emoji}
          className={`chat-reaction${info.mine ? ' mine' : ''}`}
          onClick={() => onToggle(targetType, targetId, emoji)}
          title={info.users.join(', ')}
        >
          <span>{emoji}</span>
          <span className="chat-reaction-count">{info.count}</span>
        </button>
      ))}
      <div style={{ position: 'relative' }}>
        <button className="chat-reaction-add" onClick={() => setPickerOpen(v => !v)} title="Add reaction">+</button>
        {pickerOpen && (
          <div className="chat-reaction-picker">
            {REACTION_EMOJIS.map(em => (
              <button
                key={em}
                onClick={() => { onToggle(targetType, targetId, em); setPickerOpen(false) }}
              >{em}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function TeamChat({
  timeline, reactions, loading, error, currentUserId, isLeader,
  onPostMessage, onDeleteMessage, onToggleReaction,
}: TeamChatProps) {
  const [messageInput, setMessageInput] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Scroll to top (newest) when timeline changes
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [timeline.length])

  const handlePost = async () => {
    if (!messageInput.trim() || posting) return
    setPosting(true)
    setPostError(null)
    const r = await onPostMessage(messageInput)
    if (!r.ok) setPostError(r.error ?? 'Failed to send')
    else setMessageInput('')
    setPosting(false)
  }

  return (
    <div className="chat-container">
      <div className="chat-list" ref={listRef}>
        {loading && timeline.length === 0 && <p className="snippet-empty">Loading…</p>}
        {error && <p className="snippet-empty" style={{ color: '#EF4444' }}>{error}</p>}
        {!loading && !error && timeline.length === 0 && (
          <div className="tw-placeholder">
            <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>No activity yet</p>
            <p style={{ fontSize: 12 }}>When someone pushes, opens a PR, or posts something, it will appear here.</p>
          </div>
        )}

        {timeline.map(item => (
          item.kind === 'event' ? (
            <EventRow
              key={`e-${item.id}`}
              event={item}
              reactions={reactions}
              currentUserId={currentUserId}
              onToggleReaction={onToggleReaction}
            />
          ) : (
            <MessageRow
              key={`m-${item.id}`}
              message={item}
              reactions={reactions}
              currentUserId={currentUserId}
              canDelete={item.user_id === currentUserId || isLeader}
              onDelete={() => onDeleteMessage(item.id)}
              onToggleReaction={onToggleReaction}
            />
          )
        ))}
      </div>

      <div className="chat-composer">
        {postError && <p className="chat-composer-error">{postError}</p>}
        <textarea
          className="chat-composer-input"
          placeholder="Write a daily status… (Enter to send, Shift+Enter for new line)"
          value={messageInput}
          onChange={e => setMessageInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handlePost()
            }
          }}
          rows={2}
        />
        <button
          className="chat-composer-send"
          onClick={handlePost}
          disabled={posting || !messageInput.trim()}
        >
          {posting ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

function EventRow({ event, reactions, currentUserId, onToggleReaction }: {
  event: ChatEvent
  reactions: ChatReaction[]
  currentUserId: string | null
  onToggleReaction: (t: 'event' | 'message', id: string, e: string) => Promise<void>
}) {
  return (
    <div className={`chat-row chat-row-event event-${event.event_type === 'PushEvent' ? 'push' : event.event_type === 'PullRequestEvent' || event.event_type === 'PullRequestReviewEvent' ? 'pr' : event.event_type === 'IssuesEvent' ? 'issue' : 'create'}`}>
      {event.actor_avatar_url ? (
        <img src={event.actor_avatar_url} alt={event.actor_login} className="chat-avatar" />
      ) : (
        <div className="chat-avatar chat-avatar-fallback">{event.actor_login.charAt(0).toUpperCase()}</div>
      )}
      <div className="chat-row-content">
        <div className="chat-row-header">
          <span className="chat-actor">{event.actor_login}</span>
          <span className={`chat-event-icon chat-event-icon-${event.event_type.toLowerCase()}`}>
            {eventIcon(event.event_type)}
          </span>
          <span className="chat-time">{timeAgo(event.created_at)}</span>
        </div>
        <div className="chat-event-body">
          <span className="chat-event-desc">{eventDescription(event)}</span>
          <span className="chat-event-repo">in {event.repo_full_name}</span>
        </div>
        <ReactionsBar
          targetType="event"
          targetId={event.id}
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      </div>
    </div>
  )
}

function MessageRow({ message, reactions, currentUserId, canDelete, onDelete, onToggleReaction }: {
  message: ChatMessage
  reactions: ChatReaction[]
  currentUserId: string | null
  canDelete: boolean
  onDelete: () => void
  onToggleReaction: (t: 'event' | 'message', id: string, e: string) => Promise<void>
}) {
  const avatarUrl = message.github_login ? `https://github.com/${message.github_login}.png` : null
  const initial = (message.user_email || '?').charAt(0).toUpperCase()
  return (
    <div className="chat-row chat-row-message">
      {avatarUrl ? (
        <img src={avatarUrl} alt={message.user_email} className="chat-avatar" />
      ) : (
        <div className="chat-avatar chat-avatar-fallback">{initial}</div>
      )}
      <div className="chat-row-content">
        <div className="chat-row-header">
          <span className="chat-actor">{message.github_login ?? message.user_email}</span>
          <span className="chat-time">{timeAgo(message.created_at)}</span>
          {canDelete && (
            <button className="chat-delete-btn" onClick={onDelete} title="Delete message">×</button>
          )}
        </div>
        <div className="chat-message-body">{message.content}</div>
        <ReactionsBar
          targetType="message"
          targetId={message.id}
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      </div>
    </div>
  )
}
