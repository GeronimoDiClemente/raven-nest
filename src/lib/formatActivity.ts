import type { DomainEvent } from '../types'

export interface FormattedActivity {
  icon: string
  text: string
}

/** Renders a `DomainEvent` as a friendly one-line entry (icon + text) for
 *  the Integrations Hub Activity rail. Pure — no DOM/formatting concerns
 *  beyond the string itself, so it's cheap to test standalone. */
export function formatActivity(ev: DomainEvent): FormattedActivity {
  switch (ev.type) {
    case 'pr.merged':
      return { icon: '✅', text: `merged \`${ev.branch}\`` }
    case 'ci.failed':
      return { icon: '🔴', text: `CI failed \`${ev.branch}\`` }
    case 'changes.requested':
      return { icon: '✏️', text: 'changes requested' }
    case 'review.requested':
      return { icon: '👀', text: 'review requested' }
    case 'pr.opened':
      return { icon: '🔀', text: `PR opened \`${ev.branch}\`` }
    case 'task.created':
      return { icon: '🪺', text: `task created \`${ev.branch}\`` }
    default:
      return { icon: '•', text: ev.type }
  }
}

/** Compact mono time-ago label ("5m", "3h", "2d", "2mo"). `now` is an
 *  injectable param (defaults to `Date.now()`) so tests stay deterministic —
 *  mirrors the bucket sizes of Teams' ActivityFeed.tsx `timeAgo`, adapted to
 *  take an epoch-ms timestamp (ActivityEntry.ts) instead of an ISO string. */
export function timeAgo(ts: number, now: number = Date.now()): string {
  const diff = now - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d`
  return `${Math.floor(days / 30)}mo`
}
