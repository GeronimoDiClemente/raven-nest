// Fix round 1 de Task 6: `MemoriesItem.onOpen` es `() => void` pero por dentro hace
// `<Button onClick={onOpen}>` — si Sidebar le pasa `onMemoriesOpen` DIRECTO (que ahora
// acepta `(vista?: 'memorias' | 'settings')`), el click le entrega el SyntheticEvent del
// boton como si fuera `vista`. Este test renderiza el Sidebar REAL (no un mock de
// MemoriesItem) y verifica que el click llega sin argumentos — si alguien vuelve a escribir
// `onOpen={onMemoriesOpen}` a secas, este test falla mostrando un SyntheticEvent en vez de
// `undefined`.
//
// Mismo harness (mocks de deps pesadas + baseProps) que Sidebar-integrations.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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

import Sidebar from '../../components/Sidebar'

beforeEach(() => {
  Object.assign(window as unknown as Record<string, unknown>, {
    updater: { checkForUpdates: vi.fn(), onStatus: vi.fn() },
    platform: { isWin: false },
    electronShell: { openExternal: vi.fn() },
  })
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

describe('Sidebar — abrir Memories no le pasa el evento del click como vista', () => {
  it('clickear la fila Memories llama a onMemoriesOpen sin argumentos', () => {
    const onMemoriesOpen = vi.fn()
    render(<Sidebar {...baseProps} onMemoriesOpen={onMemoriesOpen} />)

    fireEvent.click(screen.getByText('Memories'))

    expect(onMemoriesOpen).toHaveBeenCalledTimes(1)
    expect(onMemoriesOpen).toHaveBeenCalledWith()
    // Fallaria mostrando un SyntheticEvent (con .nativeEvent, .target, etc.) si
    // `MemoriesItem.onOpen` volviera a ser `onMemoriesOpen` sin envolver.
    expect(onMemoriesOpen.mock.calls[0]).toEqual([])
  })
})
