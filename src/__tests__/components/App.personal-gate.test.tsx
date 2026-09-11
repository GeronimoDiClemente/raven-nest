// La puerta a Personal no se cobra. Ningun plan.
//
// Hasta el 2026-09-11, App.tsx abria el modal de precios en vez del workspace cuando
// `!planLimits.memoryCloud`, o sea para TODO usuario Free. Personal es la puerta a los
// repos locales, los issues, el standup y las invitaciones pendientes — nada de eso
// toca los servidores de memoria, que es lo unico que se cobra. Peor: las invitaciones
// a un equipo viven adentro de Personal, asi que un usuario Free no podia aceptar una.
//
// El gate sobrevivio a la correccion de precios de c48ea5a/3e14094 porque esa pasada
// miro SnippetPanel y WorkspacePanel y no esta puerta, y porque el unico test que
// tocaba Personal mockeaba el plan en 'team' — el mismo patron que ya habia escondido
// otro gate en esta rama: un test que nunca llega al guard que dice estar probando.
// Por eso este archivo recorre los cinco planes en vez de elegir uno.
//
// Lo que SI se cobra sigue gateado adentro de Personal, por capacidad y no por nombre
// de plan: `allowTeam={planLimits.memoryTeamShare}` (App.tsx).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import App from '../../App'
import type { Plan } from '../../lib/stripe'

// El plan lo decide cada caso; el mock lee esta variable en vez de una constante.
let planActual: Plan = 'free'
vi.mock('../../hooks/useProfile', () => ({
  useProfile: () => ({ plan: planActual, isTrialActive: false, trialDaysLeft: 0, loading: false }),
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
// workspace-shell-design §1: App.tsx now keeps each overlay mounted for 200ms
// after close so its zoomOut exit animation can play (useDelayedUnmount).
// This test's contract is about which SECTION Personal shows across an
// open/close/reopen cycle, not about the exit animation, and it asserts
// synchronously right after each click — so the animation grace period here
// would just be timing noise. Bypassing it keeps `visible` in lockstep with
// `open`, exactly like before this task.
vi.mock('../../hooks/useDelayedUnmount', () => ({
  useDelayedUnmount: (open: boolean) => ({ visible: open, closing: false }),
}))
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

describe('App — la puerta a Personal no pasa por el plan', () => {
  beforeEach(() => {
    Object.assign(window as unknown as Record<string, unknown>, {
      session: { load: vi.fn(async () => null), save: vi.fn() },
      port: { byPane: vi.fn(async () => ({})) },
      platform: { isWin: false },
      memory: { hubStats: vi.fn(async () => ({ itemCount: 0, projectCount: 0 })) },
    })
  })

  const PLANES: Plan[] = ['free', 'cloud', 'pro', 'team', 'enterprise']

  it.each(PLANES)('en plan %s, Personal abre el workspace y no el modal de precios', (plan) => {
    planActual = plan
    render(<App />)

    fireEvent.click(screen.getByTestId('open-personal'))

    // Abrio Personal: su nav real muestra la seccion Repos (App resetea a 'repos').
    const activa = screen.getAllByRole('button')
      .find(b => b.className.includes('tw-nav-btn active'))?.textContent
    expect(activa).toBe('Repos')

    // Y NO aparecio el modal de precios. Esta es la mitad que importa: con el gate
    // viejo puesto, en 'free' el workspace no monta y en su lugar sale "Choose your plan".
    expect(screen.queryByText('Choose your plan')).not.toBeInTheDocument()
  })
})
