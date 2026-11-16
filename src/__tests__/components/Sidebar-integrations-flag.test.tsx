// src/__tests__/components/Sidebar-integrations-flag.test.tsx
//
// Companion to Sidebar-integrations.test.tsx, que mockea
// ENABLE_INTEGRATIONS_ORCHESTRATION a `true` para probar el wiring del punto de
// entrada. Este archivo NO mockea src/lib/releaseFlags — usa el valor real, que
// hoy es `false` (Integrations/Orchestration no salen en esta release, decision
// del usuario 2026-09-10). Sin este test, nada impide que la constante vuelva a
// `true` sin querer y las dos filas reaparezcan antes de tiempo.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ── Mock heavy transitive deps (mismo set que Sidebar-integrations.test.tsx) ──
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
  },
}))

vi.mock('../../hooks/useGitHub', () => ({
  useGitHub: () => ({ githubToken: null, githubLogin: null, isConnected: false, connectGitHub: vi.fn() }),
}))

vi.mock('../../hooks/useGitlab', () => ({
  useGitlab: () => ({ gitlabToken: null, gitlabLogin: null, isConnected: false, connectGitlab: vi.fn() }),
}))

vi.mock('../../hooks/useGitInfo', () => ({
  useGitInfo: () => ({ branch: null, githubUrl: null, isDirty: false, refresh: vi.fn() }),
}))

vi.mock('../../lib/terminalJoinService', () => ({
  terminalJoinService: {
    isConnected: false,
    isConnecting: false,
    code: null,
    error: null,
    subscribe: vi.fn(() => () => {}),
    join: vi.fn(),
    leave: vi.fn(),
  },
}))

// ── Import component after mocks ──────────────────────────────────────────
import Sidebar from '../../components/Sidebar'

beforeEach(() => {
  Object.assign(window as unknown as Record<string, unknown>, {
    updater: { checkForUpdates: vi.fn(), onStatus: vi.fn() },
    platform: { isWin: false },
    electronShell: { openExternal: vi.fn() },
  })
  window.snippets = { list: vi.fn().mockResolvedValue([]) } as never
})

const baseProps = {
  expanded: false,
  onToggle: vi.fn(),
  broadcastMode: false,
  onBroadcastToggle: vi.fn(),
  isListening: false,
  isTranscribing: false,
  isModelLoading: false,
  onMicToggle: vi.fn(),
  onNewPane: vi.fn(),
  onHistoryOpen: vi.fn(),
  onSnippetSend: vi.fn(),
  onSnippetBroadcast: vi.fn(),
  onWorkspaceSave: vi.fn(),
  onWorkspaceLoad: vi.fn(),
  isWin: false,
  onRepoLink: vi.fn(),
  onRepoUnlink: vi.fn(),
  onJoinTerminal: vi.fn(),
  onWorktreeSelect: vi.fn(),
  onNewWorktree: vi.fn(),
  onFixCi: vi.fn(),
  layoutId: '1' as const,
  paneCount: 0,
  onLayoutChange: vi.fn(),
  onFileOpen: vi.fn(),
  userPrefs: {
    prefs: { active_team_id: null, ui_settings: {} },
    loaded: true,
    setActiveTeam: vi.fn(),
    setFontSize: vi.fn(),
    setEditorOptions: vi.fn(),
    setEditorTheme: vi.fn(),
  setTerminalTheme: vi.fn(),
  setTerminalThemeAutoContrast: vi.fn(),
  addTerminalTheme: vi.fn(),
  removeTerminalTheme: vi.fn(),
  },
}

describe('Sidebar — Integrations/Orchestration detras del flag de release', () => {
  it('no renderiza Integrations ni Orchestration mientras el flag esta apagado', () => {
    render(<Sidebar {...baseProps} onIntegrationsOpen={vi.fn()} onGraphBoardOpen={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Show more tools'))
    expect(screen.queryByText('Integrations')).not.toBeInTheDocument()
    expect(screen.queryByText('Orchestration')).not.toBeInTheDocument()
  })
})
