// src/__tests__/components/Sidebar-integrations.test.tsx
//
// Smoke test: clicking the "Integrations" button calls onIntegrationsOpen.
// Sidebar has many heavy deps (supabase, git hooks, window.* IPC). We mock
// the problematic ones so the component renders without crashing.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ── Mock heavy transitive deps ────────────────────────────────────────────
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null }) })),
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

// terminalJoinService calls createClient at module-load time with VITE env vars
// that don't exist in test env → mock the whole module
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

// Minimal window globals that Sidebar (or its sub-hooks) access synchronously
beforeEach(() => {
  Object.assign(window as unknown as Record<string, unknown>, {
    updater: { checkForUpdates: vi.fn(), onStatus: vi.fn() },
    platform: { isWin: false },
    electronShell: { openExternal: vi.fn() },
    plugins: {
      list: vi.fn(() => Promise.resolve([])),
      save: vi.fn(),
      delete: vi.fn(),
    },
  })
})

// Minimal props that satisfy all required fields of SidebarProps.
// expanded: false avoids rendering WorktreesSection (which needs more window globals).
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
  layoutId: '1' as const,
  paneCount: 0,
  onLayoutChange: vi.fn(),
}

describe('Sidebar — botón Integraciones', () => {
  it('llama onIntegrationsOpen al hacer click en el botón Integraciones', () => {
    const onIntegrationsOpen = vi.fn()
    render(
      <Sidebar
        {...baseProps}
        onIntegrationsOpen={onIntegrationsOpen}
      />,
    )
    fireEvent.click(screen.getByText('Integrations'))
    expect(onIntegrationsOpen).toHaveBeenCalledTimes(1)
  })

  it('no explota si onIntegrationsOpen no se pasa (prop opcional)', () => {
    expect(() =>
      render(<Sidebar {...baseProps} />),
    ).not.toThrow()
  })
})
