// src/__tests__/components/Sidebar-integrations.test.tsx
//
// The global "Integrations" entry point (button + installed items) used to
// live only inside My Repos (see
// docs/design/integrations/2026-07-05-plan-migracion-my-repos.md, Task C).
// Plan 2 / Task 4 re-introduces it as a top-level rail item that opens the
// IntegrationsHub orchestration board overlay (mirrors My Repos/Teams).
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

// Minimal window globals that Sidebar (or its sub-hooks) access synchronously.
// Note: no window.plugins mock — Sidebar no longer uses useInstalledPlugins
// (that lived in the now-deleted SidebarIntegrationItems).
beforeEach(() => {
  Object.assign(window as unknown as Record<string, unknown>, {
    updater: { checkForUpdates: vi.fn(), onStatus: vi.fn() },
    platform: { isWin: false },
    electronShell: { openExternal: vi.fn() },
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
  onFixCi: vi.fn(),
  layoutId: '1' as const,
  paneCount: 0,
  onLayoutChange: vi.fn(),
}

describe('Sidebar — entry point global de Integraciones', () => {
  it('renderiza un ítem "Integrations" que llama a onIntegrationsOpen', () => {
    const onIntegrationsOpen = vi.fn()
    render(<Sidebar {...baseProps} onIntegrationsOpen={onIntegrationsOpen} />)
    fireEvent.click(screen.getByText('Integrations'))
    expect(onIntegrationsOpen).toHaveBeenCalledTimes(1)
  })

  it('renderiza sin explotar (smoke test)', () => {
    expect(() => render(<Sidebar {...baseProps} />)).not.toThrow()
  })
})
