import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SettingsPanel from '../../components/SettingsPanel'
import type { EditorPreferences, EditorTheme } from '../../lib/ide-config-mappings'

// SettingsPanel talks to supabase directly (useGitHub/useGitlab effects, the
// "Sign out" button) — mocked here the same way useLocalPathsMigration.test.tsx
// does it, resolving no user so those effects bail out early without hitting
// the network.
const supabaseMock = vi.hoisted(() => {
  // Al juntarse con la rama de memoria, SettingsPanel monta ademas useUserRepos,
  // que encadena from().select().order() y lo await-ea. Con `from` devolviendo
  // undefined la promesa rechazaba y vitest contaba un unhandled error por test:
  // no rompian, pero un rechazo suelto puede enmascarar un fallo real.
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
  }
  return {
    auth: { getUser: vi.fn(), signOut: vi.fn() },
    from: vi.fn(() => query),
  }
})
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

// SettingsPanel no longer calls useUserPreferences() itself (Critical
// finding 2 in the final review — two independent hook instances meant an
// imported config never reached the running editor). It now receives the
// single App.tsx-owned instance as a prop, so tests pass a fake directly
// instead of mocking the hook module.
function mockIdeConfigImport(impl: ReturnType<typeof vi.fn>) {
  ;(window as unknown as { ideConfig: { import: ReturnType<typeof vi.fn> } }).ideConfig = { import: impl }
}

// window.themes (preload) mockeado entero — el tab Editor lista los temas
// instalados apenas se abre, así que TODOS los tests del tab necesitan esto.
function mockThemesBridge(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  const themes = {
    listInstalled: vi.fn().mockResolvedValue([]),
    saveInstalled: vi.fn(),
    deleteInstalled: vi.fn(),
    scanVSCode: vi.fn().mockResolvedValue({ ok: true, themes: [] }),
    importVSCode: vi.fn().mockResolvedValue({ ok: true, name: 'x' }),
    searchOpenVSX: vi.fn().mockResolvedValue({ ok: true, results: [] }),
    installOpenVSX: vi.fn().mockResolvedValue({ ok: true, installed: [] }),
    loadFromFile: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
  ;(window as unknown as { themes: typeof themes }).themes = themes
  return themes
}

type SetEditorOptionsMock = ReturnType<typeof vi.fn<(options: EditorPreferences, theme?: EditorTheme) => void>>

function makeUserPrefs(setEditorOptionsMock: SetEditorOptionsMock) {
  return {
    prefs: { active_team_id: null, ui_settings: {} },
    loaded: true,
    setActiveTeam: vi.fn(),
    setFontSize: vi.fn(),
    setEditorOptions: setEditorOptionsMock,
    setEditorTheme: vi.fn(),
  }
}

function openEditorTab(setEditorOptionsMock: SetEditorOptionsMock = vi.fn()) {
  render(<SettingsPanel updateState="idle" onCheckUpdates={vi.fn()} userEmail="test@example.com" userPrefs={makeUserPrefs(setEditorOptionsMock)} />)
  fireEvent.click(screen.getByTitle('Settings'))
  fireEvent.click(screen.getByText('Editor'))
}

describe('SettingsPanel — editor config import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    // useUserRepos cruza los repos con los paths locales de esta maquina.
    ;(window as unknown as { localPaths: { getAll: () => Promise<Record<string, string>> } })
      .localPaths = { getAll: async () => ({}) }
    mockThemesBridge()
  })

  it('shows a preview of the imported VS Code preferences before applying', async () => {
    mockIdeConfigImport(vi.fn().mockResolvedValue({ ok: true, options: { fontSize: 18, tabSize: 2 } }))
    openEditorTab()

    fireEvent.click(screen.getByText('Import from VS Code'))
    await waitFor(() => expect(screen.getByTestId('ide-config-preview')).toBeInTheDocument())
    expect(screen.getByTestId('ide-config-preview')).toHaveTextContent('fontSize')
    expect(screen.getByTestId('ide-config-preview')).toHaveTextContent('18')
  })

  it('shows an error message without crashing when the config is not found', async () => {
    mockIdeConfigImport(vi.fn().mockResolvedValue({ ok: false, error: "We couldn't find your VS Code configuration on this machine." }))
    openEditorTab()

    fireEvent.click(screen.getByText('Import from VS Code'))
    await waitFor(() => expect(screen.getByText("We couldn't find your VS Code configuration on this machine.")).toBeInTheDocument())
  })

  it('applies the preview via setEditorOptions and hides the preview on confirm', async () => {
    const setEditorOptionsMock: SetEditorOptionsMock = vi.fn()
    mockIdeConfigImport(vi.fn().mockResolvedValue({ ok: true, options: { fontSize: 18 }, theme: 'vs-dark' }))
    openEditorTab(setEditorOptionsMock)

    fireEvent.click(screen.getByText('Import from VS Code'))
    await waitFor(() => expect(screen.getByTestId('ide-config-preview')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Apply'))
    expect(setEditorOptionsMock).toHaveBeenCalledWith({ fontSize: 18 }, 'vs-dark')
    expect(screen.queryByTestId('ide-config-preview')).not.toBeInTheDocument()
  })

  it('discards the preview without applying on cancel', async () => {
    const setEditorOptionsMock: SetEditorOptionsMock = vi.fn()
    mockIdeConfigImport(vi.fn().mockResolvedValue({ ok: true, options: { fontSize: 18 } }))
    openEditorTab(setEditorOptionsMock)

    fireEvent.click(screen.getByText('Import from VS Code'))
    await waitFor(() => expect(screen.getByTestId('ide-config-preview')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Cancel'))
    expect(setEditorOptionsMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('ide-config-preview')).not.toBeInTheDocument()
  })

  it('imports from IntelliJ via the second button', async () => {
    const importMock = vi.fn().mockResolvedValue({ ok: true, options: { tabSize: 4 } })
    mockIdeConfigImport(importMock)
    openEditorTab()

    fireEvent.click(screen.getByText('Import from IntelliJ'))
    await waitFor(() => expect(importMock).toHaveBeenCalledWith('intellij'))
  })

  // Cierra el loop que el import de config dejó abierto: un unmappedTheme
  // que matchea un tema bundled/instalado se aplica como tema real.
  it('applies a matching bundled theme when the imported config has an unmappedTheme', async () => {
    const setEditorOptionsMock: SetEditorOptionsMock = vi.fn()
    mockIdeConfigImport(vi.fn().mockResolvedValue({ ok: true, options: { fontSize: 18 }, unmappedTheme: 'One Dark Pro' }))
    openEditorTab(setEditorOptionsMock)

    fireEvent.click(screen.getByText('Import from VS Code'))
    await waitFor(() => expect(screen.getByTestId('ide-config-preview')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Apply'))
    expect(setEditorOptionsMock).toHaveBeenCalledWith({ fontSize: 18 }, 'one-dark-pro')
  })
})

describe('SettingsPanel — editor themes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    mockIdeConfigImport(vi.fn())
  })

  function openWithThemes(
    themes: ReturnType<typeof mockThemesBridge>,
    prefsOverrides: { editorTheme?: string; setEditorTheme?: ReturnType<typeof vi.fn<(theme: string) => void>> } = {},
  ) {
    const setEditorTheme = prefsOverrides.setEditorTheme ?? vi.fn<(theme: string) => void>()
    const userPrefs = {
      prefs: { active_team_id: null, ui_settings: { editorTheme: prefsOverrides.editorTheme } },
      loaded: true,
      setActiveTeam: vi.fn(),
      setFontSize: vi.fn(),
      setEditorOptions: vi.fn(),
      setEditorTheme,
    }
    render(<SettingsPanel updateState="idle" onCheckUpdates={vi.fn()} userEmail="t@e.com" userPrefs={userPrefs} />)
    fireEvent.click(screen.getByTitle('Settings'))
    fireEvent.click(screen.getByText('Editor'))
    return { setEditorTheme }
  }

  it('lists built-in, bundled and installed themes grouped in the selector', async () => {
    const themes = mockThemesBridge({
      listInstalled: vi.fn().mockResolvedValue([
        { name: 'acme-dark', displayName: 'Acme Dark', isDark: true, theme: { tokenColors: [] } },
      ]),
    })
    openWithThemes(themes)

    const select = await screen.findByTestId('theme-select')
    await waitFor(() => expect(select).toHaveTextContent('Acme Dark'))
    expect(select).toHaveTextContent('Dracula')
    expect(select).toHaveTextContent('One Dark Pro')
    // agrupado: built-in + bundled + installed
    expect(select.querySelectorAll('optgroup').length).toBeGreaterThanOrEqual(3)
  })

  it('persists the selection via setEditorTheme', async () => {
    const themes = mockThemesBridge()
    const setEditorTheme = vi.fn<(theme: string) => void>()
    openWithThemes(themes, { setEditorTheme })

    const select = await screen.findByTestId('theme-select')
    fireEvent.change(select, { target: { value: 'dracula' } })
    expect(setEditorTheme).toHaveBeenCalledWith('dracula')
  })

  it('scans VS Code themes and installs one of the found entries', async () => {
    const themes = mockThemesBridge({
      scanVSCode: vi.fn().mockResolvedValue({
        ok: true,
        themes: [{ label: 'Acme Dark', path: 'C:/exts/acme/themes/dark.json' }],
      }),
      importVSCode: vi.fn().mockResolvedValue({ ok: true, name: 'acme-dark' }),
    })
    openWithThemes(themes)

    fireEvent.click(screen.getByText('Import themes from VS Code'))
    await waitFor(() => expect(screen.getByText('Acme Dark')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Install'))
    await waitFor(() => expect(themes.importVSCode).toHaveBeenCalledWith('C:/exts/acme/themes/dark.json'))
    // instalado uno nuevo → se refresca el listado para el selector
    await waitFor(() => expect(themes.listInstalled.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('shows an inline English error when the VS Code scan fails', async () => {
    const themes = mockThemesBridge({
      scanVSCode: vi.fn().mockResolvedValue({ ok: false, error: "We couldn't find a VS Code extensions folder on this machine." }),
    })
    openWithThemes(themes)

    fireEvent.click(screen.getByText('Import themes from VS Code'))
    await waitFor(() => expect(screen.getByText("We couldn't find a VS Code extensions folder on this machine.")).toBeInTheDocument())
  })

  it('loads a theme file from disk and refreshes the installed list', async () => {
    const themes = mockThemesBridge({
      loadFromFile: vi.fn().mockResolvedValue({ ok: true, name: 'acme-dark' }),
    })
    openWithThemes(themes)

    fireEvent.click(screen.getByText('Load theme file…'))
    await waitFor(() => expect(themes.loadFromFile).toHaveBeenCalled())
    await waitFor(() => expect(themes.listInstalled.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('shows the validation error inline when the loaded file is not a theme', async () => {
    const themes = mockThemesBridge({
      loadFromFile: vi.fn().mockResolvedValue({ ok: false, error: "This file doesn't look like a VS Code color theme (expected a JSON object with colors and/or tokenColors)." }),
    })
    openWithThemes(themes)

    fireEvent.click(screen.getByText('Load theme file…'))
    await waitFor(() => expect(screen.getByText(/doesn't look like a VS Code color theme/)).toBeInTheDocument())
  })

  it('searches Open VSX and installs a result', async () => {
    const themes = mockThemesBridge({
      searchOpenVSX: vi.fn().mockResolvedValue({
        ok: true,
        results: [{ namespace: 'dracula-theme', name: 'theme-dracula', displayName: 'Dracula Official', description: 'the theme' }],
      }),
      installOpenVSX: vi.fn().mockResolvedValue({ ok: true, installed: ['dracula'] }),
    })
    openWithThemes(themes)

    fireEvent.click(screen.getByText('Browse Open VSX…'))
    const input = await screen.findByPlaceholderText('Search themes on Open VSX')
    fireEvent.change(input, { target: { value: 'dracula' } })
    fireEvent.click(screen.getByText('Search'))

    await waitFor(() => expect(themes.searchOpenVSX).toHaveBeenCalledWith('dracula'))
    await waitFor(() => expect(screen.getByText('Dracula Official')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Install'))
    await waitFor(() => expect(themes.installOpenVSX).toHaveBeenCalledWith('dracula-theme', 'theme-dracula'))
    await waitFor(() => expect(themes.listInstalled.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('shows an inline error when the Open VSX search fails, allowing retry', async () => {
    const themes = mockThemesBridge({
      searchOpenVSX: vi.fn().mockResolvedValue({ ok: false, error: "Couldn't reach Open VSX (offline). Check your connection and try again." }),
    })
    openWithThemes(themes)

    fireEvent.click(screen.getByText('Browse Open VSX…'))
    const input = await screen.findByPlaceholderText('Search themes on Open VSX')
    fireEvent.change(input, { target: { value: 'dracula' } })
    fireEvent.click(screen.getByText('Search'))

    await waitFor(() => expect(screen.getByText(/Couldn't reach Open VSX/)).toBeInTheDocument())
    // el botón sigue ahí — retry permitido, sin estado colgado
    expect(screen.getByText('Search')).toBeInTheDocument()
  })
})

describe('SettingsPanel — el match exacto le gana al heurístico', () => {
  it('prefers the exact bundled match over the heuristic vs-dark', async () => {
    const setEditorOptionsMock = vi.fn()
    mockIdeConfigImport(vi.fn().mockResolvedValue({
      ok: true, options: { fontSize: 18 }, theme: 'vs-dark', unmappedTheme: 'One Dark Pro',
    }))
    openEditorTab(setEditorOptionsMock)
    fireEvent.click(screen.getByText('Import from VS Code'))
    await waitFor(() => expect(screen.getByTestId('ide-config-preview')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Apply'))
    expect(setEditorOptionsMock).toHaveBeenCalledWith({ fontSize: 18 }, 'one-dark-pro')
  })
})

// Fix round 1 review, Finding 1 (Important): the token <input> used to require
// PLAN_LIMITS[plan].memoryCloud even in the `error` state. `error` is reachable
// while already connected (refresh() maps daemonStatus === 'error' to it), and
// useProfile() re-fetches plan on every window focus — so a Pro user downgraded
// to free while their daemon was erroring saw a permanently-disabled Retry
// button with no input to type a new token into, and no Disconnect escape
// hatch either. The fix widens the input's render condition so `error` always
// shows it, regardless of plan.
function mockMemoryBridge(status: {
  connected: boolean
  deviceId: string | null
  itemCount: number
  pendingCount: number
  daemonStatus: 'idle' | 'syncing' | 'paused' | 'error' | 'plan_required'
}) {
  const memory = {
    ensureDeviceId: vi.fn().mockResolvedValue('dev-1'),
    connect: vi.fn().mockResolvedValue({ ok: true }),
    disconnect: vi.fn().mockResolvedValue({ ok: true }),
    status: vi.fn().mockResolvedValue(status),
    onStatus: vi.fn(),
    removeStatusListener: vi.fn(),
  }
  ;(window as unknown as { memory: typeof memory }).memory = memory
  return memory
}

describe('SettingsPanel — memory token input stays reachable in the error state (C7 fix round 1)', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    // useProfile() also bails out on a null user and keeps its initial
    // `plan: 'free'` — PLAN_LIMITS.free.memoryCloud is false, which is exactly
    // the plan/state combination Finding 1 describes (downgraded-to-free user
    // whose daemon is in `error`).
    ;(window as unknown as { localPaths: { getAll: () => Promise<Record<string, string>> } })
      .localPaths = { getAll: async () => ({}) }
  })

  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
  })

  it('renders the sync-token input in the error state even without the memoryCloud entitlement', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 0, pendingCount: 0, daemonStatus: 'error' })
    render(<SettingsPanel updateState="idle" onCheckUpdates={vi.fn()} userEmail="test@example.com" userPrefs={makeUserPrefs(vi.fn())} />)
    fireEvent.click(screen.getByTitle('Settings'))
    fireEvent.click(screen.getByText('Account'))

    await waitFor(() => expect(screen.getByText(/Couldn't sync/)).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Paste your sync token')).toBeInTheDocument()
    // Retry itself is still disabled until a token is typed — this test is
    // about the input existing at all, not about auto-filling it.
    expect(screen.getByText('Retry')).toBeDisabled()
  })
})

// smoke/memory-bridge task: a 403 plan_required is not an auth failure — the card must
// show an Upgrade path, not "Couldn't sync" / a Retry-a-token flow, and that Upgrade
// button must be the SAME affordance the free-plan disconnected branch already has
// (setMemoryUpgradeOpen), not a second one.
describe('SettingsPanel — plan_required reuses the existing Upgrade affordance', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    ;(window as unknown as { localPaths: { getAll: () => Promise<Record<string, string>> } })
      .localPaths = { getAll: async () => ({}) }
  })

  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
  })

  it('shows an Upgrade button (not Retry, not the token input) and opens the same UpgradeModal the free-plan path uses', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 5, pendingCount: 2, daemonStatus: 'plan_required' })
    render(<SettingsPanel updateState="idle" onCheckUpdates={vi.fn()} userEmail="test@example.com" userPrefs={makeUserPrefs(vi.fn())} />)
    fireEvent.click(screen.getByTitle('Settings'))
    fireEvent.click(screen.getByText('Account'))

    await waitFor(() => expect(screen.getByText(/doesn't include cloud sync/)).toBeInTheDocument())
    expect(screen.queryByPlaceholderText('Paste your sync token')).not.toBeInTheDocument()
    expect(screen.queryByText('Retry')).not.toBeInTheDocument()

    const upgradeButton = screen.getByText('Upgrade')
    fireEvent.click(upgradeButton)

    // UpgradeModal renders plan tiers, e.g. "Free" — proves the SAME modal component
    // mounts here as it does off the free-plan disconnected branch's Upgrade button.
    await waitFor(() => expect(screen.getByText('Free')).toBeInTheDocument())
  })
})
