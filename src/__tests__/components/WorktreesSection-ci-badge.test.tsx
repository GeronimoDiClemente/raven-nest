// Render del badge de CI en la lista de worktrees. Contrato no trivial: el badge
// verde (success) NO es clickeable, el rojo (failure) clickea onFixCi(repoPath),
// unknown no muestra badge, y el chip "changes requested" aparece sólo si
// changesRequested. Se mockean useGitHub/useGitlab (tocan supabase) y se inyectan
// los window.* que WorktreesSection lee vía useBridge()/useWorktreeSignals.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { WorktreeMeta, WorktreeSignalDTO } from '../../types'

vi.mock('../../hooks/useGitHub', () => ({
  useGitHub: () => ({ githubToken: null, githubLogin: null, isConnected: false, connectGitHub: vi.fn() }),
}))
vi.mock('../../hooks/useGitlab', () => ({
  useGitlab: () => ({ gitlabToken: null, gitlabLogin: null, isConnected: false, connectGitlab: vi.fn() }),
}))

import { WorktreesSection } from '../../components/WorktreesSection'

const ROOT = '/repo'
function wt(repoPath: string, branch: string, isRoot = false): WorktreeMeta {
  return {
    repoPath, rootRepoPath: isRoot ? repoPath : ROOT, branch,
    setupState: 'done', declaredPorts: [], detectedPorts: [], createdAt: 0, updatedAt: 0,
  }
}
function sig(repoPath: string, ci: WorktreeSignalDTO['ci'], changesRequested = false): WorktreeSignalDTO {
  return { repoPath, ci, changesRequested }
}

const worktrees: WorktreeMeta[] = [
  wt(ROOT, 'main', true),
  wt('/wt/fail', 'feat/fail'),
  wt('/wt/pass', 'feat/pass'),
  wt('/wt/unk', 'feat/unk'),
]
const signals: WorktreeSignalDTO[] = [
  sig('/wt/fail', 'failure', true), // failure + changes requested
  sig('/wt/pass', 'success'),
  sig('/wt/unk', 'unknown'),
]

beforeEach(() => {
  Object.assign(window as unknown as Record<string, unknown>, {
    signals: {
      list: vi.fn(() => Promise.resolve(signals)),
      fixCiPrompt: vi.fn(),
      onUpdate: vi.fn(() => () => {}),
    },
    worktree: { list: vi.fn(() => Promise.resolve({ ok: true, worktrees })) },
    spotlight: {
      status: vi.fn(() => Promise.resolve({ active: false })),
      onStatus: vi.fn(),
      removeListeners: vi.fn(),
    },
    preset: { onSetupState: vi.fn(), removeListeners: vi.fn() },
    git: {
      shortstat: vi.fn(() => Promise.resolve(null)),
      findPRForBranch: vi.fn(() => Promise.resolve(null)),
    },
    electronShell: { openExternal: vi.fn() },
  })
})

function renderSection(onFixCi = vi.fn()) {
  render(
    <WorktreesSection
      repoPath={ROOT}
      activeRepoPath={undefined}
      onSelect={vi.fn()}
      onNewClick={vi.fn()}
      onFixCi={onFixCi}
    />,
  )
  return onFixCi
}

describe('WorktreesSection — badge de CI', () => {
  it('el badge failure es un botón y clickearlo dispara onFixCi(repoPath)', async () => {
    const onFixCi = renderSection()
    const badge = await screen.findByRole('button', { name: 'CI: failing' })
    fireEvent.click(badge)
    expect(onFixCi).toHaveBeenCalledWith('/wt/fail')
  })

  it('el badge success está presente pero NO es clickeable (no dispara onFixCi)', async () => {
    const onFixCi = renderSection()
    // Presente como span (aria-label), pero sin role button.
    const pass = await screen.findByLabelText('CI: passing')
    expect(pass).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'CI: passing' })).not.toBeInTheDocument()
    fireEvent.click(pass)
    expect(onFixCi).not.toHaveBeenCalled()
  })

  it('ci unknown no renderiza badge', async () => {
    renderSection()
    await screen.findByLabelText('CI: failing') // espera a que cargue la lista
    expect(screen.queryByLabelText('CI: unknown')).not.toBeInTheDocument()
  })

  it('el chip "changes requested" aparece sólo si changesRequested', async () => {
    renderSection()
    await screen.findByLabelText('CI: failing')
    const chips = screen.getAllByTitle('Changes requested')
    expect(chips).toHaveLength(1) // sólo /wt/fail lo tiene
  })
})
