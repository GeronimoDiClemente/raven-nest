// App mounts TeamsWorkspace and PersonalWorkspace as siblings, and Personal
// stays mounted while the team workspace is open (closing Teams must return
// you to Personal). Both roots are `.teams-workspace`: position fixed, inset 0,
// opaque background. So whichever of the two wins the stacking contest is the
// only one the user can see — and with an equal z-index that is the LATER
// sibling, i.e. Personal, which made "Open team workspace" look like a no-op.
//
// This test renders both real roots in App's order and resolves the stacking
// against the real rules in global.css, so it fails if either the modifier
// class on the team root or its z-index rule goes away.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import TeamsWorkspace from '../../components/TeamsWorkspace'
import PersonalWorkspace from '../../components/PersonalWorkspace'

const activeTeam = { id: 't-1', name: 'Nest', owner_id: 'u-1', created_at: '' }

vi.mock('../../hooks/useTeam', () => ({
  useTeam: () => ({
    teams: [activeTeam],
    activeTeam,
    members: [],
    pendingInvites: [],
    myPendingRequests: [],
    loading: false,
    userId: 'u-1',
    switchTeam: vi.fn(), createTeam: vi.fn(), inviteMember: vi.fn(), removeMember: vi.fn(),
    promoteMember: vi.fn(), demoteMember: vi.fn(),
    acceptInvite: vi.fn(), rejectInvite: vi.fn(),
    requestJoin: vi.fn(), cancelRequest: vi.fn(), approveRequest: vi.fn(), declineRequest: vi.fn(),
    leaveTeam: vi.fn(), deleteTeam: vi.fn(), refresh: vi.fn(),
  }),
}))
vi.mock('../../hooks/useTeamRepos', () => ({
  useTeamRepos: () => ({
    repos: [], loading: false, userLocalPaths: {},
    refresh: vi.fn(), addRepo: vi.fn(), updateUserLocalPath: vi.fn(),
    removeRepo: vi.fn(), setPermission: vi.fn(),
  }),
}))
vi.mock('../../hooks/useScopedRepos', () => ({
  useScopedRepos: () => ({
    repos: [], loading: false, canManage: true,
    refresh: vi.fn(), addRepo: vi.fn(), updateLocalPath: vi.fn(), removeRepo: vi.fn(),
  }),
}))
vi.mock('../../hooks/useTeamPresence', () => ({ useTeamPresence: () => ({ presence: {} }) }))
vi.mock('../../hooks/useSharedSnippets', () => ({ useSharedSnippets: () => ({ items: [], loading: false, userId: 'u-1', refresh: vi.fn(), remove: vi.fn() }) }))
vi.mock('../../hooks/useSharedWorkspaces', () => ({ useSharedWorkspaces: () => ({ items: [], loading: false, userId: 'u-1', refresh: vi.fn(), remove: vi.fn() }) }))
vi.mock('../../hooks/useSharedMcpConfigs', () => ({ useSharedMcpConfigs: () => ({ items: [], loading: false, userId: 'u-1', refresh: vi.fn(), remove: vi.fn() }) }))
vi.mock('../../hooks/useGitHub', () => ({ useGitHub: () => ({ githubLogin: 'me', githubToken: 't', isConnected: true, connectGitHub: vi.fn() }) }))
vi.mock('../../hooks/useGitlab', () => ({ useGitlab: () => ({ gitlabLogin: null, gitlabToken: null, isConnected: false, connectGitlab: vi.fn() }) }))
vi.mock('../../hooks/useGitHubNotifications', () => ({ useGitHubNotifications: () => ({ notifications: [], unreadCount: 0, markAsRead: vi.fn() }) }))
vi.mock('../../hooks/useTeamChat', () => ({ useTeamChat: () => ({ timeline: [], reactions: {}, loading: false, error: null, postMessage: vi.fn(), deleteMessage: vi.fn(), toggleReaction: vi.fn() }) }))
vi.mock('../../hooks/useTeamsKeyboard', () => ({ useTeamsKeyboard: () => {} }))
vi.mock('../../components/ProviderAvatar', () => ({
  ProviderAvatarPill: () => null,
  ProviderIcon: () => null,
  ProviderAvatar: () => null,
  providerAvatar: () => null,
  PROVIDER_HOST: { github: 'https://github.com', gitlab: 'https://gitlab.com' },
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() })),
    auth: { getUser: vi.fn(), onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) },
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
  },
}))

/** Every rule in global.css whose selector mentions the workspace shell. */
function workspaceShellCss(): string {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')
    // Comments name selectors too; strip them before matching rules.
    .replace(/\/\*[\s\S]*?\*\//g, '')
  return (css.match(/(?:^|\n)\s*\.teams-workspace[^{}]*\{[^{}]*\}/g) ?? []).join('\n')
}

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = workspaceShellCss()
  document.head.appendChild(style)
})

/**
 * Which of two fixed-position siblings the user actually sees. Higher z-index
 * wins; on a tie CSS paints the one that comes later in the document.
 */
function paintsOnTop(a: Element, b: Element): Element {
  const za = Number(getComputedStyle(a).zIndex || 0)
  const zb = Number(getComputedStyle(b).zIndex || 0)
  if (za !== zb) return za > zb ? a : b
  const bIsLater = (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  return bIsLater ? b : a
}

describe('team workspace over Personal', () => {
  it('paints the team surface on top while both stay mounted', () => {
    const { container } = render(
      <>
        <TeamsWorkspace onClose={vi.fn()} />
        <PersonalWorkspace
          onClose={vi.fn()}
          githubToken="gh"
          githubLogin="me"
          onConnectGitHub={vi.fn()}
          onOpenRepoTerminal={vi.fn()}
          onOpenTeamWorkspace={vi.fn()}
          allowTeam
        />
      </>,
    )

    const roots = Array.from(container.querySelectorAll('.teams-workspace'))
    expect(roots).toHaveLength(2)
    const teamRoot = roots.find(r => r.querySelector('[data-tour-id="teams-header"]'))!
    const personalRoot = roots.find(r => r.querySelector('[data-tour-id="myrepos-header"]'))!
    expect(teamRoot).toBeDefined()
    expect(personalRoot).toBeDefined()

    // Sanity: the shell rules really loaded, otherwise the comparison below
    // would be vacuously true on two empty z-indexes.
    expect(getComputedStyle(personalRoot).position).toBe('fixed')

    expect(paintsOnTop(teamRoot, personalRoot)).toBe(teamRoot)
  })
})
