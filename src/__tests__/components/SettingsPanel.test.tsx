import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SettingsPanel from '../../components/SettingsPanel'

// SettingsPanel talks to supabase directly (useGitHub/useGitlab effects, the
// "Sign out" button) — mocked here the same way useLocalPathsMigration.test.tsx
// does it, resolving no user so those effects bail out early without hitting
// the network.
const supabaseMock = vi.hoisted(() => ({
  auth: { getUser: vi.fn(), signOut: vi.fn() },
  from: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

// useUserPreferences() itself talks to supabase (user_preferences table) —
// mocked directly so `confirmImport`'s call to `setEditorOptions` can be
// asserted deterministically instead of relying on the real hook's
// early-return-when-no-user behavior (which would make the assertion vacuous).
const setEditorOptionsMock = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({
    prefs: { active_team_id: null, ui_settings: {} },
    loaded: true,
    setActiveTeam: vi.fn(),
    setFontSize: vi.fn(),
    setEditorOptions: setEditorOptionsMock,
  }),
}))

function mockIdeConfigImport(impl: ReturnType<typeof vi.fn>) {
  ;(window as unknown as { ideConfig: { import: ReturnType<typeof vi.fn> } }).ideConfig = { import: impl }
}

function openEditorTab() {
  render(<SettingsPanel updateState="idle" onCheckUpdates={vi.fn()} userEmail="test@example.com" />)
  fireEvent.click(screen.getByTitle('Settings'))
  fireEvent.click(screen.getByText('Editor'))
}

describe('SettingsPanel — editor config import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
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
    mockIdeConfigImport(vi.fn().mockResolvedValue({ ok: true, options: { fontSize: 18 }, theme: 'vs-dark' }))
    openEditorTab()

    fireEvent.click(screen.getByText('Import from VS Code'))
    await waitFor(() => expect(screen.getByTestId('ide-config-preview')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Apply'))
    expect(setEditorOptionsMock).toHaveBeenCalledWith({ fontSize: 18 }, 'vs-dark')
    expect(screen.queryByTestId('ide-config-preview')).not.toBeInTheDocument()
  })

  it('discards the preview without applying on cancel', async () => {
    mockIdeConfigImport(vi.fn().mockResolvedValue({ ok: true, options: { fontSize: 18 } }))
    openEditorTab()

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
})
