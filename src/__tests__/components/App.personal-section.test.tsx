// Regression test for the "Personal reopens on the wrong section" bug: the
// invites redirect (TeamsWorkspace -> "you have pending invites" -> Personal)
// sets personalSection to 'pendings', and if the normal Personal door doesn't
// reset it back to 'repos' on its own click, closing and reopening Personal
// from the sidebar leaves the user staring at the invites list instead of
// their repos — for the rest of the session, since nothing else resets it.
//
// This mounts the real App component (the state machine under test lives
// there — onPersonalOpen, onOpenPersonalInvites, personalSection) with every
// other heavy dependency (data-fetching hooks, Sidebar's own internals,
// TeamsWorkspace/PersonalWorkspace's own internals) replaced by a minimal
// stand-in that only exposes the props relevant to this sequence.
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

// TeamsWorkspace and PersonalWorkspace are stand-ins that expose exactly the
// props under test: the invites redirect, initialSection, and close.
vi.mock('../../components/TeamsWorkspace', () => ({
  default: (props: { onOpenPersonalInvites?: () => void; onClose: () => void }) => (
    <div data-testid="teams-workspace">
      <button data-testid="open-invites" onClick={() => props.onOpenPersonalInvites?.()}>open invites</button>
      <button data-testid="close-teams" onClick={props.onClose}>close teams</button>
    </div>
  ),
}))
vi.mock('../../components/PersonalWorkspace', () => ({
  default: (props: { initialSection?: string; onClose: () => void; onOpenTeamWorkspace: () => void }) => (
    <div data-testid="personal-workspace">
      <span data-testid="personal-section">{props.initialSection}</span>
      <button data-testid="close-personal" onClick={props.onClose}>close personal</button>
      <button data-testid="open-team-from-personal" onClick={props.onOpenTeamWorkspace}>open team</button>
    </div>
  ),
}))

describe('App — Personal section reset', () => {
  beforeEach(() => {
    Object.assign(window as unknown as Record<string, unknown>, {
      session: { load: vi.fn(async () => null), save: vi.fn() },
      port: { byPane: vi.fn(async () => ({})) },
      platform: { isWin: false },
    })
  })

  function openTeamFromPersonal() {
    fireEvent.click(screen.getByTestId('open-personal'))
    fireEvent.click(screen.getByTestId('open-team-from-personal'))
  }

  it('reopens on repos, not on whatever section was open when it was last closed', () => {
    render(<App />)

    // Reach the invites redirect: Personal -> Team -> "open invites".
    openTeamFromPersonal()
    fireEvent.click(screen.getByTestId('open-invites'))
    expect(screen.getByTestId('personal-section')).toHaveTextContent('pendings')

    // Close Personal (still parked on 'pendings' — nothing resets it here).
    fireEvent.click(screen.getByTestId('close-personal'))
    expect(screen.queryByTestId('personal-workspace')).not.toBeInTheDocument()

    // Reopen Personal normally, from the sidebar door — not via the invites
    // redirect. It must show repos, not the stale invites section.
    fireEvent.click(screen.getByTestId('open-personal'))
    expect(screen.getByTestId('personal-section')).toHaveTextContent('repos')
  })
})
