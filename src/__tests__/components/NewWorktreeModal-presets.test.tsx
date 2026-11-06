// El modal no corre un preset del repo sin mostrar antes lo que ejecuta (electron/preset-trust.ts).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { NewWorktreeModal } from '../../components/NewWorktreeModal'
import { BridgeProvider, type Bridge } from '../../lib/bridge'
import type { PresetReview, RavenPreset } from '../../types'

const PRESET: RavenPreset = { id: 'setup', name: 'Install dependencies', setup: ['npm install'] }
const REVISION: PresetReview = {
  trusted: false, hash: 'h1', postCreate: ['./scripts/bootstrap.sh'], setup: ['npm install'], dev: 'npm run dev', env: { PORT: '3000' },
}

function armar(o: { revision?: PresetReview | null; trust?: { ok: true } | { ok: false; error: string }; create?: unknown } = {}) {
  const create = vi.fn(async () => o.create ?? { ok: true, meta: { repoPath: '/tmp/repo-feat-x' } })
  const trust = vi.fn(async () => o.trust ?? { ok: true as const })
  const review = vi.fn(async () => (o.revision === undefined ? REVISION : o.revision))
  const bridge = {
    preset: { list: vi.fn(async () => [PRESET]), review, trust },
    git: { listBranches: vi.fn(async () => ({ branches: ['main'], defaultBranch: 'main' })), listUntrackedEnvFiles: vi.fn(async () => []) },
    worktree: { create, copyFiles: vi.fn() },
  } as unknown as Bridge
  const onCreated = vi.fn()
  const onClose = vi.fn()
  render(
    <BridgeProvider value={bridge}>
      <NewWorktreeModal open repoPath="/tmp/repo" onClose={onClose} onCreated={onCreated} />
    </BridgeProvider>,
  )
  return { create, trust, review, onCreated, onClose }
}

async function elegirPresetYCrear() {
  fireEvent.change(screen.getByPlaceholderText('feat/billing'), { target: { value: 'feat/x' } })
  fireEvent.click(await screen.findByText('Install dependencies'))
  fireEvent.click(screen.getByText('Create'))
}

afterEach(() => cleanup())

describe('NewWorktreeModal con un preset del repo', () => {
  it('sin aprobar: muestra todo lo que ejecuta y no crea nada todavía', async () => {
    const { create } = armar()
    await elegirPresetYCrear()
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    const panel = screen.getByRole('alert').textContent!
    expect(panel).toContain('This preset runs commands from the repo')
    expect(panel).toContain('$ ./scripts/bootstrap.sh')
    expect(panel).toContain('$ npm install')
    expect(panel).toContain('dev: npm run dev')
    expect(panel).toContain('PORT=3000')
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByText('Trust and create')).toBeTruthy()
  })

  it('«Trust and create» aprueba el hash que se mostró y después crea', async () => {
    const { create, trust, onCreated } = armar()
    await elegirPresetYCrear()
    fireEvent.click(await screen.findByText('Trust and create'))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(trust).toHaveBeenCalledWith('/tmp/repo', 'setup', 'h1')
    expect(onCreated).toHaveBeenCalledWith({ repoPath: '/tmp/repo-feat-x' })
  })

  it('si el preset cambió después de mostrarlo, no crea y vuelve a mostrarlo', async () => {
    const { create } = armar({ trust: { ok: false, error: 'The preset changed after you reviewed it. Review it again.' } })
    await elegirPresetYCrear()
    fireEvent.click(await screen.findByText('Trust and create'))
    await waitFor(() => expect(screen.getByText('The preset changed after you reviewed it. Review it again.')).toBeTruthy())
    expect(create).not.toHaveBeenCalled()
  })

  it('ya aprobado: crea directo', async () => {
    const { create } = armar({ revision: { ...REVISION, trusted: true } })
    await elegirPresetYCrear()
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('un error del main se muestra y el modal sigue abierto (antes se cerraba como si hubiera andado)', async () => {
    const { onCreated, onClose } = armar({ revision: { ...REVISION, trusted: true }, create: { ok: false, error: 'Invalid branch name: x' } })
    await elegirPresetYCrear()
    await waitFor(() => expect(screen.getByText('Invalid branch name: x')).toBeTruthy())
    expect(onCreated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
