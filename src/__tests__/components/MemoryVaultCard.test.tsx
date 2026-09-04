import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MemoryVaultCard from '../../components/MemoryVaultCard'

type VaultSettings = { version: number; enabled: boolean; root: string | null; includeSuperseded: boolean; includeTeamScope: boolean }

function mockVaultApi(overrides: {
  settings?: VaultSettings
  rootDir?: string
  setSettings?: ReturnType<typeof vi.fn>
  regenerate?: ReturnType<typeof vi.fn>
  reveal?: ReturnType<typeof vi.fn>
} = {}) {
  const settings: VaultSettings = overrides.settings ?? {
    version: 1, enabled: false, root: null, includeSuperseded: true, includeTeamScope: true,
  }
  const api = {
    vaultGetSettings: vi.fn().mockResolvedValue({ ok: true, settings, rootDir: overrides.rootDir ?? '/home/gero/.raven-nest/memory-vault/user-1' }),
    vaultSetSettings: overrides.setSettings ?? vi.fn().mockResolvedValue({ ok: true, settings: { ...settings, enabled: true } }),
    vaultRegenerate: overrides.regenerate ?? vi.fn().mockResolvedValue({ ok: true, result: { written: 3, moved: 0, deleted: 0, conflicts: 0, warnings: [] } }),
    vaultReveal: overrides.reveal ?? vi.fn().mockResolvedValue({ ok: true }),
  }
  ;(window as unknown as { memory: typeof api }).memory = api
  return api
}

describe('MemoryVaultCard', () => {
  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
  })

  it('renders nothing when the preload has no vault methods (old build)', () => {
    ;(window as unknown as { memory: object }).memory = {}
    const { container } = render(<MemoryVaultCard />)
    expect(container.firstChild).toBeNull()
  })

  it('shows Enable when the vault is off', async () => {
    mockVaultApi()
    render(<MemoryVaultCard />)
    await waitFor(() => expect(screen.getByText('Enable')).toBeInTheDocument())
    expect(screen.queryByText('Regenerate now')).not.toBeInTheDocument()
  })

  it('shows the root path, Regenerate/Open folder and the config checkboxes when enabled', async () => {
    mockVaultApi({ settings: { version: 1, enabled: true, root: null, includeSuperseded: true, includeTeamScope: false } })
    render(<MemoryVaultCard />)
    await waitFor(() => expect(screen.getByText('Disable')).toBeInTheDocument())
    expect(screen.getByText(/memory-vault\/user-1/)).toBeInTheDocument()
    expect(screen.getByText('Regenerate now')).toBeInTheDocument()
    expect(screen.getByText('Open folder')).toBeInTheDocument()
    expect(screen.getByLabelText(/superseded/i)).toBeChecked()
    expect(screen.getByLabelText(/teammates/i)).not.toBeChecked()
  })

  it('clicking Enable calls vaultSetSettings({enabled: true})', async () => {
    const setSettings = vi.fn().mockResolvedValue({ ok: true, settings: { version: 1, enabled: true, root: null, includeSuperseded: true, includeTeamScope: true } })
    mockVaultApi({ setSettings })
    render(<MemoryVaultCard />)
    await waitFor(() => expect(screen.getByText('Enable')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Enable'))
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ enabled: true }))
  })

  it('clicking Regenerate now shows the result counts', async () => {
    const regenerate = vi.fn().mockResolvedValue({ ok: true, result: { written: 5, moved: 1, deleted: 2, conflicts: 0, warnings: [] } })
    mockVaultApi({ settings: { version: 1, enabled: true, root: null, includeSuperseded: true, includeTeamScope: true }, regenerate })
    render(<MemoryVaultCard />)
    await waitFor(() => expect(screen.getByText('Regenerate now')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Regenerate now'))
    await waitFor(() => expect(screen.getByText(/5 written · 1 moved · 2 deleted/)).toBeInTheDocument())
  })

  it('a conflict count in the result mentions preserved edits', async () => {
    const regenerate = vi.fn().mockResolvedValue({ ok: true, result: { written: 1, moved: 0, deleted: 0, conflicts: 2, warnings: [] } })
    mockVaultApi({ settings: { version: 1, enabled: true, root: null, includeSuperseded: true, includeTeamScope: true }, regenerate })
    render(<MemoryVaultCard />)
    await waitFor(() => expect(screen.getByText('Regenerate now')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Regenerate now'))
    await waitFor(() => expect(screen.getByText(/preserved in _conflicts\//)).toBeInTheDocument())
  })

  it('clicking Open folder calls vaultReveal', async () => {
    const reveal = vi.fn().mockResolvedValue({ ok: true })
    mockVaultApi({ settings: { version: 1, enabled: true, root: null, includeSuperseded: true, includeTeamScope: true }, reveal })
    render(<MemoryVaultCard />)
    await waitFor(() => expect(screen.getByText('Open folder')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Open folder'))
    await waitFor(() => expect(reveal).toHaveBeenCalled())
  })

  it('a failed regenerate shows the error instead of silently doing nothing', async () => {
    const regenerate = vi.fn().mockResolvedValue({ ok: false, error: 'disk full' })
    mockVaultApi({ settings: { version: 1, enabled: true, root: null, includeSuperseded: true, includeTeamScope: true }, regenerate })
    render(<MemoryVaultCard />)
    await waitFor(() => expect(screen.getByText('Regenerate now')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Regenerate now'))
    await waitFor(() => expect(screen.getByText('disk full')).toBeInTheDocument())
  })

  it('toggling the "include teammates" checkbox calls vaultSetSettings with just that flag', async () => {
    const setSettings = vi.fn().mockResolvedValue({ ok: true, settings: { version: 1, enabled: true, root: null, includeSuperseded: true, includeTeamScope: true } })
    mockVaultApi({ settings: { version: 1, enabled: true, root: null, includeSuperseded: true, includeTeamScope: false }, setSettings })
    render(<MemoryVaultCard />)
    await waitFor(() => expect(screen.getByLabelText(/teammates/i)).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText(/teammates/i))
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ includeTeamScope: true }))
  })
})
