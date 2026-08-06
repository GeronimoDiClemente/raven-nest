// H7 spec §6 — @Nest bot orchestration intents. Runs on top of the existing
// Socket Mode mention handler (slack-socket.ts): instead of only echoing the
// mention to the renderer, a plain-text command directed at @Nest gets
// parsed and ACTED on ("grab PROJ-142" creates a worktree and starts work),
// then replies in the same Slack thread.
//
// Pure-ish and fully dependency-injected so it's testable without Electron:
// this file imports no Node/Electron API and no other main-process module
// (ticket-loop.ts, worktree-store.ts, worktree-create.ts, ...). main.ts wires
// the real implementations into NestBotDeps — reusing the exact same building
// blocks the "Work on this" ticket picker uses (ticketBranchName, the
// worktree:create git flow, tickets:startWork's TASK.md + ticketLoop.startWork).
import type { SlackMention } from './slack-envelopes'
import type { Ticket } from './ticket-types'

export type Intent =
  | { kind: 'grab'; ticketKey: string }
  | { kind: 'list' }
  | { kind: 'help' }
  | { kind: 'unknown' }

export type CreateWorktreeResult =
  | { ok: true; worktreePath: string }
  | { ok: false; error: string }

export type StartWorkResult =
  | { ok: true }
  | { ok: false; error: string }

export interface NestBotDeps {
  /** Registered ticket-plugin ids to search when resolving a key, e.g. ['jira', 'linear', 'github']. */
  ticketPluginIds: () => string[]
  /** "My tickets" for one plugin — same contract as ticketLoop.list (degrades to [] on failure/not connected). */
  listTickets: (pluginId: string) => Promise<Ticket[]>
  /** `<user>/<key>-<slug>` branch name — the same function the picker uses (ticketBranchName). */
  branchName: (user: string, key: string, title: string) => string
  /**
   * Local base repoPath for a GitHub "owner/repo" full name, or null if that
   * repo isn't cloned/known locally. Only consulted for tickets from the
   * 'github' plugin — Jira/Linear keys don't carry repo info, so grabbing
   * those asks for clarification instead of guessing a repo.
   */
  resolveRepoPath: (fullName: string) => string | null
  /** git worktree add + meta persistence — the same git-level flow worktree:create runs (no preset). */
  createWorktree: (repoPath: string, branch: string) => Promise<CreateWorktreeResult>
  /** Writes `.nest/TASK.md` and fires the in_progress transition — the same flow tickets:startWork runs. */
  startWork: (pluginId: string, ticket: Ticket, branch: string, worktreePath: string) => Promise<StartWorkResult>
}

// ── parseIntent ──────────────────────────────────────────────────────────

// Some callers (direct unit tests, or a defensive re-parse) may still pass
// text carrying the raw mention marker; slack-envelopes.ts already strips
// `<@ID>` before SlackMention.text reaches us, but stripping again here is a
// harmless no-op and lets parseIntent be tested with realistic raw text too.
const MENTION_PREFIX_RE = /^(?:<@[^>]+>|@nest)[,:]?\s*/i
const GRAB_RE = /^(?:grab|take|work\s+on)\s+(\S+)/i
const LIST_RE = /^(?:list(?:\s+.*)?|my\s+tickets|what'?s\s+assigned)/i
const HELP_RE = /^help\b/i

function stripLeadingMention(text: string): string {
  return text.replace(MENTION_PREFIX_RE, '')
}

/**
 * Pure parse of a Slack command directed at @Nest. Ticket keys can be Jira
 * ("PROJ-142"), Linear ("ENG-42"), a bare GitHub issue number ("#123"), or a
 * full GitHub reference ("owner/repo#7") — parseIntent just captures the
 * token; handleMention resolves it against the connected providers.
 */
export function parseIntent(text: string): Intent {
  const body = stripLeadingMention(text ?? '').trim()

  const grabMatch = body.match(GRAB_RE)
  if (grabMatch) {
    const ticketKey = grabMatch[1].replace(/[.,!?;:]+$/, '')
    if (ticketKey) return { kind: 'grab', ticketKey }
  }
  if (LIST_RE.test(body)) return { kind: 'list' }
  if (HELP_RE.test(body)) return { kind: 'help' }
  return { kind: 'unknown' }
}

export const HELP_TEXT = [
  "Here's what I can do:",
  '• `@Nest list` — show your open tickets',
  '• `@Nest grab <KEY>` (or `take`/`work on`) — create a worktree and start work on a ticket',
  '• `@Nest help` — show this message',
].join('\n')

// ── ticket resolution ────────────────────────────────────────────────────

const GITHUB_KEY_RE = /^(.+)#\d+$/

function ticketKeyMatches(ticketKey: string, wanted: string): boolean {
  const a = ticketKey.toLowerCase()
  const b = wanted.toLowerCase()
  if (a === b) return true
  // A bare "#123" (no owner/repo prefix) matches any GitHub key ending in that issue number.
  return b.startsWith('#') && a.endsWith(b)
}

/** "owner/repo" from a GitHub ticket key ("owner/repo#7"), or null for any other shape. */
function githubFullNameFromKey(key: string): string | null {
  const m = key.match(GITHUB_KEY_RE)
  return m ? m[1] : null
}

async function findTicket(
  ticketKey: string,
  deps: NestBotDeps,
): Promise<{ pluginId: string; ticket: Ticket } | null> {
  for (const pluginId of deps.ticketPluginIds()) {
    let tickets: Ticket[]
    try {
      tickets = await deps.listTickets(pluginId)
    } catch {
      continue // one misbehaving provider shouldn't block the search across the others
    }
    const match = tickets.find((t) => ticketKeyMatches(t.key, ticketKey))
    if (match) return { pluginId, ticket: match }
  }
  return null
}

// ── list ──────────────────────────────────────────────────────────────────

const LIST_DISPLAY_LIMIT = 10

async function formatTicketList(deps: NestBotDeps): Promise<string> {
  const all: Ticket[] = []
  for (const pluginId of deps.ticketPluginIds()) {
    try {
      all.push(...(await deps.listTickets(pluginId)))
    } catch {
      // best-effort: skip a provider that throws instead of failing the whole reply
    }
  }
  if (all.length === 0) return 'No open tickets assigned to you right now.'
  const shown = all.slice(0, LIST_DISPLAY_LIMIT)
  const lines = shown.map((t) => `• ${t.key} — ${t.title}`)
  const suffix = all.length > shown.length ? `\n…and ${all.length - shown.length} more` : ''
  return `Your open tickets:\n${lines.join('\n')}${suffix}`
}

// ── grab ──────────────────────────────────────────────────────────────────

async function grabTicket(ticketKey: string, mention: SlackMention, deps: NestBotDeps): Promise<string> {
  const found = await findTicket(ticketKey, deps)
  if (!found) {
    return `Couldn't find a ticket matching "${ticketKey}" in your connected trackers. Check the key and try again.`
  }
  const { pluginId, ticket } = found

  const fullName = pluginId === 'github' ? githubFullNameFromKey(ticket.key) : null
  if (!fullName) {
    return `Found ${ticket.key} (${ticket.title}), but I can't tell which repo it belongs to — ` +
      `${pluginId} tickets don't carry repo info. Open the right repo in Nest and use "Work on this" ` +
      `from the ticket panel instead.`
  }

  const repoPath = deps.resolveRepoPath(fullName)
  if (!repoPath) {
    return `Found ${ticket.key}, but "${fullName}" isn't set up locally yet — add it in My Repos first, then try again.`
  }

  const branch = deps.branchName(mention.user, ticket.key, ticket.title)
  const wt = await deps.createWorktree(repoPath, branch)
  if (!wt.ok) {
    return `Could not create a worktree for ${ticket.key}: ${wt.error}`
  }

  const started = await deps.startWork(pluginId, ticket, branch, wt.worktreePath)
  if (!started.ok) {
    return `Created the worktree for ${ticket.key} (branch \`${branch}\`) but couldn't start work: ${started.error}`
  }

  return `🪺 Grabbed ${ticket.key}: ${ticket.title}\nBranch: \`${branch}\`\nRepo: ${fullName}`
}

// ── entry point ──────────────────────────────────────────────────────────

/** Parses `mention.text` and acts on it, returning the in-thread reply. Never throws. */
export async function handleMention(mention: SlackMention, deps: NestBotDeps): Promise<{ reply: string }> {
  const intent = parseIntent(mention.text)
  switch (intent.kind) {
    case 'list':
      return { reply: await formatTicketList(deps) }
    case 'grab':
      return { reply: await grabTicket(intent.ticketKey, mention, deps) }
    case 'help':
    case 'unknown':
      return { reply: HELP_TEXT }
  }
}
