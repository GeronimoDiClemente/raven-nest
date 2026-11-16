import { describe, it, expect, vi } from 'vitest'
import { parseIntent, handleMention, HELP_TEXT, type NestBotDeps } from '../integrations/nest-bot'
import type { SlackMention } from '../integrations/slack-envelopes'
import type { Ticket } from '../integrations/ticket-types'

function makeTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    key: 'PROJ-142',
    providerId: 'p1',
    title: 'Fix the login bug',
    url: 'https://example.test/PROJ-142',
    state: 'todo',
    context: 'Some context',
    ...over,
  }
}

function makeMention(over: Partial<SlackMention> = {}): SlackMention {
  return { channel: 'C1', threadTs: '111.1', user: 'U9', text: 'help', ...over }
}

function makeDeps(over: Partial<NestBotDeps> = {}): NestBotDeps {
  return {
    ticketPluginIds: () => [],
    listTickets: async () => [],
    branchName: (user, key, title) => `${user || 'nest'}/${key}-${title}`.toLowerCase(),
    resolveRepoPath: () => null,
    createWorktree: async () => ({ ok: true, worktreePath: '/repos/widgets-branch' }),
    startWork: async () => ({ ok: true }),
    ...over,
  }
}

describe('parseIntent', () => {
  it('grab: "grab <KEY>"', () => {
    expect(parseIntent('grab PROJ-142')).toEqual({ kind: 'grab', ticketKey: 'PROJ-142' })
  })

  it('grab: "take <KEY>"', () => {
    expect(parseIntent('take ENG-42')).toEqual({ kind: 'grab', ticketKey: 'ENG-42' })
  })

  it('grab: "work on <KEY>" with a bare GitHub issue number', () => {
    expect(parseIntent('work on #123')).toEqual({ kind: 'grab', ticketKey: '#123' })
  })

  it('grab: captures a full "owner/repo#7" GitHub reference', () => {
    expect(parseIntent('grab owner/repo#7')).toEqual({ kind: 'grab', ticketKey: 'owner/repo#7' })
  })

  it('grab: verb match is case-insensitive, key case is preserved', () => {
    expect(parseIntent('GRAB proj-142')).toEqual({ kind: 'grab', ticketKey: 'proj-142' })
  })

  it('grab: strips trailing punctuation from the captured key', () => {
    expect(parseIntent('grab PROJ-142.')).toEqual({ kind: 'grab', ticketKey: 'PROJ-142' })
    expect(parseIntent('grab PROJ-142!')).toEqual({ kind: 'grab', ticketKey: 'PROJ-142' })
  })

  it('strips a leading "<@ID>" mention marker before matching', () => {
    expect(parseIntent('<@U123ABC> grab PROJ-142')).toEqual({ kind: 'grab', ticketKey: 'PROJ-142' })
  })

  it('strips a leading "@Nest" mention text before matching', () => {
    expect(parseIntent('@Nest grab PROJ-142')).toEqual({ kind: 'grab', ticketKey: 'PROJ-142' })
    expect(parseIntent('@Nest, grab PROJ-142')).toEqual({ kind: 'grab', ticketKey: 'PROJ-142' })
  })

  it('list: "list"', () => {
    expect(parseIntent('list')).toEqual({ kind: 'list' })
  })

  it('list: "my tickets"', () => {
    expect(parseIntent('my tickets')).toEqual({ kind: 'list' })
  })

  it("list: \"what's assigned\" (with or without the apostrophe)", () => {
    expect(parseIntent("what's assigned")).toEqual({ kind: 'list' })
    expect(parseIntent('whats assigned')).toEqual({ kind: 'list' })
  })

  it('list is case-insensitive', () => {
    expect(parseIntent('List')).toEqual({ kind: 'list' })
  })

  it('help: "help"', () => {
    expect(parseIntent('help')).toEqual({ kind: 'help' })
  })

  it('help does not false-positive on a word that merely starts with "help"', () => {
    expect(parseIntent('helpful hints please')).toEqual({ kind: 'unknown' })
  })

  it('unknown: empty text', () => {
    expect(parseIntent('')).toEqual({ kind: 'unknown' })
  })

  it('unknown: unrecognized text', () => {
    expect(parseIntent('yo what up')).toEqual({ kind: 'unknown' })
  })

  it('unknown: "grab" with no key falls through instead of matching an empty key', () => {
    expect(parseIntent('grab')).toEqual({ kind: 'unknown' })
  })
})

describe('handleMention', () => {
  // ── list ───────────────────────────────────────────────────────────────
  it('list: formats tickets gathered across all connected plugins', async () => {
    const listTickets = vi.fn(async (pluginId: string) => {
      if (pluginId === 'jira') return [makeTicket({ key: 'PROJ-1', title: 'Fix login' })]
      if (pluginId === 'github') return [makeTicket({ key: 'acme/widgets#7', title: 'Update deps' })]
      return []
    })
    const deps = makeDeps({ ticketPluginIds: () => ['jira', 'linear', 'github'], listTickets })
    const res = await handleMention(makeMention({ text: 'list' }), deps)
    expect(res.reply).toContain('PROJ-1 — Fix login')
    expect(res.reply).toContain('acme/widgets#7 — Update deps')
  })

  it('list: no tickets anywhere replies with a plain "no tickets" message', async () => {
    const deps = makeDeps({ ticketPluginIds: () => ['jira'], listTickets: async () => [] })
    const res = await handleMention(makeMention({ text: 'my tickets' }), deps)
    expect(res.reply).toBe('No open tickets assigned to you right now.')
  })

  it('list: truncates long lists and says how many more', async () => {
    const many = Array.from({ length: 13 }, (_, i) => makeTicket({ key: `PROJ-${i}`, title: `Task ${i}` }))
    const deps = makeDeps({ ticketPluginIds: () => ['jira'], listTickets: async () => many })
    const res = await handleMention(makeMention({ text: 'list' }), deps)
    expect(res.reply).toContain('…and 3 more')
    expect(res.reply.match(/•/g)?.length).toBe(10)
  })

  it('list: a provider that throws does not break the reply for the others', async () => {
    const listTickets = vi.fn(async (pluginId: string) => {
      if (pluginId === 'jira') throw new Error('jira down')
      return [makeTicket({ key: 'ENG-1', title: 'Still works' })]
    })
    const deps = makeDeps({ ticketPluginIds: () => ['jira', 'linear'], listTickets })
    const res = await handleMention(makeMention({ text: 'list' }), deps)
    expect(res.reply).toContain('ENG-1 — Still works')
  })

  // ── grab (happy path) ─────────────────────────────────────────────────
  it('grab: GitHub ticket resolves the repo from the key, creates a worktree, and starts work', async () => {
    const ticket = makeTicket({ key: 'acme/widgets#7', providerId: 'acme/widgets#7', title: 'Update deps' })
    const listTickets = vi.fn(async (pluginId: string) => (pluginId === 'github' ? [ticket] : []))
    const createWorktree = vi.fn(async () => ({ ok: true as const, worktreePath: '/repos/widgets-branch' }))
    const startWork = vi.fn(async () => ({ ok: true as const }))
    const resolveRepoPath = vi.fn((fullName: string) => (fullName === 'acme/widgets' ? '/repos/widgets' : null))
    const branchName = vi.fn((user: string, key: string, title: string) => `${user}/${key}-${title}`.toLowerCase())
    const deps = makeDeps({
      ticketPluginIds: () => ['jira', 'linear', 'github'],
      listTickets, createWorktree, startWork, resolveRepoPath, branchName,
    })

    const mention = makeMention({ text: 'grab acme/widgets#7', user: 'U9' })
    const res = await handleMention(mention, deps)

    expect(resolveRepoPath).toHaveBeenCalledWith('acme/widgets')
    expect(branchName).toHaveBeenCalledWith('U9', 'acme/widgets#7', 'Update deps')
    expect(createWorktree).toHaveBeenCalledWith('/repos/widgets', expect.any(String))
    expect(startWork).toHaveBeenCalledWith('github', ticket, expect.any(String), '/repos/widgets-branch')
    expect(res.reply).toContain('acme/widgets#7')
    expect(res.reply).toContain('acme/widgets')
    expect(res.reply.toLowerCase()).toContain('grabbed')
  })

  it('grab: a bare "#123" key matches a GitHub ticket ending in that issue number', async () => {
    const ticket = makeTicket({ key: 'acme/widgets#123', providerId: 'acme/widgets#123', title: 'Bare number' })
    const deps = makeDeps({
      ticketPluginIds: () => ['github'],
      listTickets: async () => [ticket],
      resolveRepoPath: () => '/repos/widgets',
    })
    const res = await handleMention(makeMention({ text: 'work on #123' }), deps)
    expect(res.reply.toLowerCase()).toContain('grabbed')
    expect(res.reply).toContain('acme/widgets#123')
  })

  // ── grab (not found) ─────────────────────────────────────────────────
  it('grab: ticket key not found in any connected provider replies with an error, no side effects', async () => {
    const createWorktree = vi.fn()
    const startWork = vi.fn()
    const deps = makeDeps({
      ticketPluginIds: () => ['jira', 'github'],
      listTickets: async () => [],
      createWorktree, startWork,
    })
    const res = await handleMention(makeMention({ text: 'grab PROJ-999' }), deps)
    expect(res.reply).toMatch(/couldn't find/i)
    expect(res.reply).toContain('PROJ-999')
    expect(createWorktree).not.toHaveBeenCalled()
    expect(startWork).not.toHaveBeenCalled()
  })

  // ── grab (unresolvable repo) ──────────────────────────────────────────
  it('grab: a non-GitHub ticket (Jira) asks for clarification instead of guessing a repo', async () => {
    const ticket = makeTicket({ key: 'PROJ-142', title: 'Fix login' })
    const createWorktree = vi.fn()
    const startWork = vi.fn()
    const deps = makeDeps({
      ticketPluginIds: () => ['jira'],
      listTickets: async (pluginId) => (pluginId === 'jira' ? [ticket] : []),
      createWorktree, startWork,
    })
    const res = await handleMention(makeMention({ text: 'grab PROJ-142' }), deps)
    expect(res.reply).toMatch(/can't tell which repo/i)
    expect(res.reply).toContain('PROJ-142')
    expect(createWorktree).not.toHaveBeenCalled()
    expect(startWork).not.toHaveBeenCalled()
  })

  it('grab: a Linear ticket also asks for clarification (repo-info-free key)', async () => {
    const ticket = makeTicket({ key: 'ENG-42', title: 'Refactor auth' })
    const deps = makeDeps({
      ticketPluginIds: () => ['linear'],
      listTickets: async () => [ticket],
    })
    const res = await handleMention(makeMention({ text: 'take ENG-42' }), deps)
    expect(res.reply).toMatch(/can't tell which repo/i)
  })

  it('grab: a GitHub repo that is not cloned/known locally asks to add it first', async () => {
    const ticket = makeTicket({ key: 'acme/widgets#7', title: 'Update deps' })
    const createWorktree = vi.fn()
    const deps = makeDeps({
      ticketPluginIds: () => ['github'],
      listTickets: async () => [ticket],
      resolveRepoPath: () => null,
      createWorktree,
    })
    const res = await handleMention(makeMention({ text: 'grab acme/widgets#7' }), deps)
    expect(res.reply).toMatch(/isn't set up locally/i)
    expect(res.reply).toContain('acme/widgets')
    expect(createWorktree).not.toHaveBeenCalled()
  })

  // ── grab (downstream failures) ────────────────────────────────────────
  it('grab: createWorktree failure surfaces its error and never calls startWork', async () => {
    const ticket = makeTicket({ key: 'acme/widgets#7', title: 'Update deps' })
    const startWork = vi.fn()
    const deps = makeDeps({
      ticketPluginIds: () => ['github'],
      listTickets: async () => [ticket],
      resolveRepoPath: () => '/repos/widgets',
      createWorktree: async () => ({ ok: false, error: 'git worktree add failed: boom' }),
      startWork,
    })
    const res = await handleMention(makeMention({ text: 'grab acme/widgets#7' }), deps)
    expect(res.reply).toMatch(/could not create a worktree/i)
    expect(res.reply).toContain('boom')
    expect(startWork).not.toHaveBeenCalled()
  })

  it('grab: startWork failure still reports the worktree/branch it created', async () => {
    const ticket = makeTicket({ key: 'acme/widgets#7', title: 'Update deps' })
    const deps = makeDeps({
      ticketPluginIds: () => ['github'],
      listTickets: async () => [ticket],
      resolveRepoPath: () => '/repos/widgets',
      createWorktree: async () => ({ ok: true, worktreePath: '/repos/widgets-branch' }),
      startWork: async () => ({ ok: false, error: 'NO_WORKTREE' }),
    })
    const res = await handleMention(makeMention({ text: 'grab acme/widgets#7' }), deps)
    expect(res.reply).toMatch(/couldn't start work/i)
    expect(res.reply).toContain('NO_WORKTREE')
  })

  // ── help / unknown ────────────────────────────────────────────────────
  it('help replies with the supported commands', async () => {
    const res = await handleMention(makeMention({ text: 'help' }), makeDeps())
    expect(res.reply).toBe(HELP_TEXT)
  })

  it('unknown text falls back to the help text', async () => {
    const res = await handleMention(makeMention({ text: 'do a barrel roll' }), makeDeps())
    expect(res.reply).toBe(HELP_TEXT)
  })
})
