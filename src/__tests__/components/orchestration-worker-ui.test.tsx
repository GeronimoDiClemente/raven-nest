import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, cleanup, within } from '@testing-library/react'
import WorkerPaneBadge from '../../components/orchestration/WorkerPaneBadge'
import WorkerAutoCloseBanner from '../../components/orchestration/WorkerAutoCloseBanner'
import WorkerReviewPanel from '../../components/orchestration/WorkerReviewPanel'
import { workerSwatch } from '../../lib/worker-palette'
import type { OrchestrationReviewEntry, OrchestrationWorker, OrchestrationWorkerStatus } from '../../types'

const worker = (over: Partial<OrchestrationWorker> = {}): OrchestrationWorker => ({
  workerId: 'w1', coordinatorPaneId: 'c', paneId: 'p1', label: 'api', colorIndex: 1, branch: 'nest/api-w1',
  worktreePath: '/wt/api', baseBranch: 'feat/x', agent: 'claude', status: 'done', createdAt: 1, ...over,
})
const entry = (over: Partial<OrchestrationReviewEntry> = {}): OrchestrationReviewEntry => ({
  workerId: 'w1', label: 'api', colorIndex: 0, branch: 'nest/api-w1', worktreePath: '/wt/api',
  baseBranch: 'feat/x', status: 'done', repoPath: '/repo', ...over,
})

const orq = (over: Record<string, unknown> = {}) => {
  const api = {
    autoClose: vi.fn(async () => ({ ok: true })),
    keepOpen: vi.fn(async () => ({ ok: true })),
    merge: vi.fn(async () => ({ ok: true })),
    openPr: vi.fn(async () => ({ ok: true })),
    discard: vi.fn(async () => ({ ok: true })),
    autoCloseMs: null,
    ...over,
  }
  ;(window as unknown as { orchestration: unknown }).orchestration = api
  ;(window as unknown as { git: unknown }).git = { shortstat: vi.fn(async () => ({ additions: 12, deletions: 3, filesChanged: 2 })) }
  return api
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete (window as { orchestration?: unknown }).orchestration
  delete (window as { git?: unknown }).git
})

describe('WorkerPaneBadge', () => {
  const casos: Array<[OrchestrationWorkerStatus, string, string]> = [
    ['working', 'Working', 'text-foreground'],
    ['needs_input', 'Needs input', 'text-warn'],
    ['done', 'Done', 'text-ok'],
    ['exited', 'Exited', 'text-destructive'],
  ]
  it.each(casos)('%s: texto y token de estado; el punto es el color del worker', (status, texto, clase) => {
    render(<WorkerPaneBadge status={status} colorIndex={2} />)
    const b = screen.getByTestId('worker-badge')
    expect(b.textContent).toBe(texto)
    expect(b.className).toContain(clase)
    const dot = screen.getByTestId('worker-dot') as HTMLElement
    // jsdom normaliza el hex a rgb(): se compara contra lo que pinta un elemento con el mismo hex.
    const ref = document.createElement('span')
    ref.style.background = workerSwatch(2)
    expect(dot.style.background).toBe(ref.style.background)
  })
})

describe('WorkerAutoCloseBanner', () => {
  it('a los 120 s pide el cierre a main; Keep open lo pide mantener', async () => {
    vi.useFakeTimers()
    const api = orq()
    render(<WorkerAutoCloseBanner worker={worker()} busy={false} />)
    expect(screen.getByTestId('worker-auto-close').textContent).toContain('2:00')
    fireEvent.click(screen.getByRole('button', { name: 'Keep open' }))
    expect(api.keepOpen).toHaveBeenCalledWith('w1')
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(api.autoClose).toHaveBeenCalledWith('w1')
  })

  it('un worker mantenido o que no terminó no muestra banner', () => {
    orq()
    const { container, rerender } = render(<WorkerAutoCloseBanner worker={worker({ keepOpen: true })} busy={false} />)
    expect(container.innerHTML).toBe('')
    rerender(<WorkerAutoCloseBanner worker={worker({ status: 'working' })} busy={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('si main no cierra por cambios sin commitear, lo dice y no reintenta', async () => {
    vi.useFakeTimers()
    const api = orq({ autoClose: vi.fn(async () => ({ ok: false, error: 'worktree_dirty' })) })
    render(<WorkerAutoCloseBanner worker={worker()} busy={false} durationMs={1_000} />)
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(screen.getByTestId('worker-auto-close').textContent).toContain('uncommitted changes')
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(api.autoClose).toHaveBeenCalledTimes(1)
  })
})

describe('WorkerReviewPanel', () => {
  it('fila de estado con el conteo; se abre en la lista con rama, base y diffstat', async () => {
    orq()
    render(<WorkerReviewPanel entries={[entry(), entry({ workerId: 'w2', label: 'ui' })]} />)
    expect(screen.getByTestId('worker-review').textContent).toContain('2worker branches to review')
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getAllByTestId('worker-review-row')).toHaveLength(2)
    await waitFor(() => expect(screen.getAllByTestId('worker-review-diffstat')[0].textContent).toBe('+12 −3 · 2 files'))
  })

  it('Merge into main pide confirmación y recién ahí mergea', async () => {
    const api = orq()
    render(<WorkerReviewPanel entries={[entry({ baseBranch: 'main' })]} defaultOpen />)
    fireEvent.click(screen.getByRole('button', { name: 'Merge into main' }))
    expect(api.merge).not.toHaveBeenCalled()
    const confirmar = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmar).getByRole('button', { name: 'Merge into main' }))
    await waitFor(() => expect(api.merge).toHaveBeenCalledWith('w1'))
  })

  it('merge en otra rama no pide confirmación; un error se muestra en línea, en inglés', async () => {
    const api = orq({ merge: vi.fn(async () => ({ ok: false, error: 'coordinator_dirty' })) })
    render(<WorkerReviewPanel entries={[entry()]} defaultOpen />)
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(api.merge).toHaveBeenCalledWith('w1'))
    expect((await screen.findByRole('alert')).textContent).toBe("Can't merge: feat/x has uncommitted changes. Commit or stash them first.")
  })

  it('detached HEAD: Merge apagado con el motivo; Open PR y Discard siguen', async () => {
    const api = orq()
    render(<WorkerReviewPanel entries={[entry({ baseBranch: 'HEAD' })]} defaultOpen />)
    expect((screen.getByRole('button', { name: 'Merge' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('worker-review-row').textContent).toContain('Base branch unknown (detached HEAD)')
    fireEvent.click(screen.getByRole('button', { name: 'Open PR' }))
    await waitFor(() => expect(api.openPr).toHaveBeenCalledWith('w1'))
  })

  it('Discard pide confirmación', async () => {
    const api = orq()
    render(<WorkerReviewPanel entries={[entry()]} defaultOpen />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(api.discard).not.toHaveBeenCalled()
    const d = await screen.findByRole('alertdialog')
    fireEvent.click(within(d).getByRole('button', { name: 'Discard branch' }))
    await waitFor(() => expect(api.discard).toHaveBeenCalledWith('w1'))
  })

  it('master también pide confirmación', async () => {
    const api = orq()
    render(<WorkerReviewPanel entries={[entry({ baseBranch: 'master' })]} defaultOpen />)
    fireEvent.click(screen.getByRole('button', { name: 'Merge into master' }))
    expect(api.merge).not.toHaveBeenCalled()
    const d = await screen.findByRole('alertdialog')
    fireEvent.click(within(d).getByRole('button', { name: 'Merge into master' }))
    await waitFor(() => expect(api.merge).toHaveBeenCalledWith('w1'))
  })

  it('el diálogo de Discard avisa que se pierden los cambios sin commitear', async () => {
    orq()
    render(<WorkerReviewPanel entries={[entry()]} defaultOpen />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    const d = await screen.findByRole('alertdialog')
    expect(d.textContent).toContain('uncommitted changes')
  })

  it('el estado en la fila es el badge del pane: punto del worker + texto con su token', () => {
    orq()
    render(<WorkerReviewPanel entries={[entry({ status: 'exited', colorIndex: 2 })]} defaultOpen />)
    const fila = screen.getByTestId('worker-review-row')
    const b = within(fila).getByTestId('worker-badge')
    expect(b.textContent).toBe('Exited')
    expect(b.className).toContain('text-destructive')
    expect(within(b).getByTestId('worker-dot')).toBeTruthy()
  })

  it('sin ramas no ocupa lugar', () => {
    const { container } = render(<WorkerReviewPanel entries={[]} />)
    expect(container.innerHTML).toBe('')
  })
})

