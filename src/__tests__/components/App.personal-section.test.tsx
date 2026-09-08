// Regression test for the "Personal reopens on the wrong section" bug: the
// invites redirect (TeamsWorkspace -> "you have pending invites" -> Personal)
// sets personalSection to 'pendings', and if Personal doesn't reset it back
// to 'repos' on its own click, closing and reopening Personal from the
// sidebar leaves the user staring at the invites list instead of their
// repos — for the rest of the session, since nothing else resets it.
//
// This mounts the real App AND the real PersonalWorkspace (the section
// contract under test spans both: App writes personalSection to steer the
// panel, PersonalWorkspace owns it from then on and must react when the prop
// changes while it stays mounted — TeamsWorkspace renders on top of it, not
// in its place, so the invites redirect never remounts it). A stub here
// would only prove the test's own assumptions, not the product — see the
// review note this file's history carries.
//
// Everything NOT part of that contract (Sidebar's own internals, Teams'
// own internals, PersonalWorkspace's own data-fetching hooks) is replaced
// by a minimal stand-in.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import App from '../../App'

vi.mock('../../hooks/useProfile', () => ({
  useProfile: () => ({ plan: 'team', isTrialActive: false, trialDaysLeft: 0, loading: false }),
}))
vi.mock('../../hooks/usePendingInvitesCount', () => ({
  usePendingInvitesCount: () => ({ count: 0, refresh: vi.fn() }),
}))
vi.mock('../../hooks/useGitHub', () => ({
  useGitHub: () => ({ githubToken: null, githubLogin: null, isConnected: false, loading: false, error: null, connectGitHub: vi.fn(), disconnectGitHub: vi.fn() }),
}))
vi.mock('../../hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({
    prefs: { active_team_id: null, ui_settings: {} },
    loaded: true,
    setActiveTeam: vi.fn(),
    setFontSize: vi.fn(),
    setEditorOptions: vi.fn(),
    setEditorTheme: vi.fn(),
  }),
}))
vi.mock('../../hooks/useLocalPathsMigration', () => ({ useLocalPathsMigration: () => {} }))
vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => ({ settings: { voiceLanguage: 'en', keybindings: {} }, updateKeybinding: vi.fn(), updateVoiceLanguage: vi.fn() }),
}))
vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({ isListening: false, isTranscribing: false, isModelLoading: false, interimTranscript: '', start: vi.fn(), stop: vi.fn(), toggle: vi.fn() }),
}))
vi.mock('../../hub-activity', () => ({ useHubActivity: () => new Set<string>() }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}))

// PersonalWorkspace's own data-fetching hooks — irrelevant to the section
// contract under test, mocked the same way Sidebar-tabs.test.tsx mocks
// Sidebar's. One team is provided so ScopeSelector (real, unmocked) renders
// the "Open team workspace" button our sequence needs to click.
vi.mock('../../hooks/useTeam', () => ({
  useTeam: () => ({
    teams: [{ id: 't1', name: 'Nest', owner_id: 'u1', created_at: '2024-01-01' }],
    activeTeamId: null,
    members: [],
    pendingInvites: [],
    myPendingRequests: [],
    loading: false,
    userId: null,
    userEmail: null,
    activeTeam: null,
    switchTeam: vi.fn(),
    loadMembers: vi.fn(),
    acceptInvite: vi.fn(async () => ({ ok: true })),
    rejectInvite: vi.fn(async () => {}),
  }),
}))
vi.mock('../../hooks/useScopedRepos', () => ({
  useScopedRepos: () => ({ repos: [], loading: false, refresh: vi.fn(), addRepo: vi.fn(), updateLocalPath: vi.fn(), removeRepo: vi.fn() }),
}))
vi.mock('../../hooks/useGitHubNotifications', () => ({
  useGitHubNotifications: () => ({ notifications: [], unreadCount: 0, markAsRead: vi.fn() }),
}))
vi.mock('../../hooks/useGitlab', () => ({
  useGitlab: () => ({ isConnected: false, gitlabLogin: null, gitlabToken: null, loading: false, error: null, connectGitlab: vi.fn(), disconnectGitlab: vi.fn() }),
}))

// The heavy visual chrome (tab strip, hub, panes engine) isn't relevant to
// the personalSection state machine and pulls in dnd-kit/terminal internals
// that don't need exercising here.
vi.mock('../../components/TabBar', () => ({ default: () => null }))
vi.mock('../../components/ConversationSidebar', () => ({ default: () => null }))

// Sidebar's only relevant surface for this test is the Personal door. A
// real Sidebar render is already covered by Sidebar-tabs.test.tsx; here we
// just need a button wired to the exact prop App.tsx passes it.
vi.mock('../../components/Sidebar', () => ({
  default: (props: { onPersonalOpen?: () => void }) => (
    <button data-testid="open-personal" onClick={props.onPersonalOpen}>open personal</button>
  ),
}))

// TeamsWorkspace's only relevant surface is the invites redirect and close —
// its own internals are covered by its own test file.
vi.mock('../../components/TeamsWorkspace', () => ({
  default: (props: { onOpenPersonalInvites?: () => void; onClose: () => void }) => (
    <div data-testid="teams-workspace">
      <button data-testid="open-invites" onClick={() => props.onOpenPersonalInvites?.()}>open invites</button>
      <button data-testid="close-teams" onClick={props.onClose}>close teams</button>
    </div>
  ),
}))

// PersonalWorkspace itself is NOT mocked — the section-reaction contract
// this test protects lives inside it (see PersonalWorkspace.tsx's
// `initialSectionMountedRef` effect), so a stub would only prove the stub,
// not the product.

describe('App — Personal section reset', () => {
  beforeEach(() => {
    Object.assign(window as unknown as Record<string, unknown>, {
      session: { load: vi.fn(async () => null), save: vi.fn() },
      port: { byPane: vi.fn(async () => ({})) },
      platform: { isWin: false },
      // App monta MemoryHub, que pide hubStats al montarse (Team Memory).
      memory: { hubStats: vi.fn(async () => ({ itemCount: 0, projectCount: 0 })) },
    })
  })

  // Which section PersonalWorkspace is showing, read from its own nav —
  // real markup, not a test-only probe (mirrors switchSection's `active`
  // class at PersonalWorkspace.tsx's NAV_ITEMS render).
  function activeNavLabel() {
    return screen.getAllByRole('button').find(b => b.className.includes('tw-nav-btn active'))?.textContent
  }

  function openTeamFromPersonal() {
    fireEvent.click(screen.getByTestId('open-personal'))
    fireEvent.click(screen.getByRole('button', { name: 'Nest' })) // ScopeSelector team chip
    fireEvent.click(screen.getByRole('button', { name: 'Open team workspace' }))
  }

  it('reopens on repos, not on whatever section was open when it was last closed', () => {
    render(<App />)

    // Reach the invites redirect: Personal -> pick the team scope -> open
    // the team workspace -> "open invites". PersonalWorkspace stays mounted
    // throughout (Teams renders on top of it, not in its place).
    openTeamFromPersonal()
    expect(screen.getByTestId('teams-workspace')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('open-invites'))
    expect(screen.queryByTestId('teams-workspace')).not.toBeInTheDocument()
    expect(activeNavLabel()).toBe('Invites')
    expect(screen.getByText('No pending invites.')).toBeInTheDocument()

    // Close Personal (still parked on 'pendings' — nothing resets it here).
    fireEvent.click(screen.getByText('Back'))
    expect(screen.queryByText('No pending invites.')).not.toBeInTheDocument()

    // Reopen Personal normally, from the sidebar door — not via the invites
    // redirect. It must show repos, not the stale invites section.
    fireEvent.click(screen.getByTestId('open-personal'))
    expect(activeNavLabel()).toBe('Repos')
    expect(screen.queryByText('No pending invites.')).not.toBeInTheDocument()
  })
})
