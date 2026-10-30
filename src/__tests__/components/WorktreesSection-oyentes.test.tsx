// WorktreesSection se daba de baja con `spotlight.removeListeners()` y
// `preset.removeListeners()`, que borran los oyentes de TODO el canal: un remontaje
// solapado (o un segundo consumidor) quedaba sordo. Ahora usa la baja que devuelve cada `on*`.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { WorktreesSection } from '../../components/WorktreesSection'

const ROOT = '/real/my-app'

type Oyente = (...args: never[]) => void
function canal() {
  const oyentes = new Set<Oyente>()
  return {
    oyentes,
    on: vi.fn((cb: Oyente) => { oyentes.add(cb); return () => { oyentes.delete(cb) } }),
    emitir: (...args: unknown[]) => { for (const cb of [...oyentes]) (cb as (...a: unknown[]) => void)(...args) },
  }
}

let estadoSpotlight: ReturnType<typeof canal>
let estadoSetup: ReturnType<typeof canal>
let removeSpotlight: ReturnType<typeof vi.fn>
let removePreset: ReturnType<typeof vi.fn>

beforeEach(() => {
  estadoSpotlight = canal()
  estadoSetup = canal()
  removeSpotlight = vi.fn(() => estadoSpotlight.oyentes.clear())
  removePreset = vi.fn(() => estadoSetup.oyentes.clear())
  Object.assign(window as unknown as Record<string, unknown>, {
    worktree: {
      list: vi.fn(async () => ({
        ok: true,
        worktrees: [{
          repoPath: ROOT, branch: 'main', setupState: 'running', isRoot: true, rootRepoPath: ROOT,
          declaredPorts: [], detectedPorts: [], createdAt: 0, updatedAt: 0,
        }],
      })),
    },
    git: { shortstat: vi.fn(async () => null), findPRForBranch: vi.fn(async () => null) },
    spotlight: { status: vi.fn(async () => ({ active: false })), onStatus: estadoSpotlight.on, removeListeners: removeSpotlight },
    preset: { onSetupState: estadoSetup.on, removeListeners: removePreset },
    electronShell: { openExternal: vi.fn() },
  })
})

const seccion = () => (
  <WorktreesSection repoPath={ROOT} activeRepoPath={ROOT} onSelect={() => {}} onNewClick={() => {}} onFixCi={() => {}} />
)

describe('WorktreesSection · oyentes', () => {
  it('al desmontarse saca sólo sus oyentes y no los de otro', async () => {
    const otroSpotlight = vi.fn()
    const otroSetup = vi.fn()
    estadoSpotlight.on(otroSpotlight)
    estadoSetup.on(otroSetup)

    const { unmount } = render(seccion())
    await waitFor(() => expect(screen.getByText('main')).toBeInTheDocument())
    expect(estadoSpotlight.oyentes.size).toBe(2)
    expect(estadoSetup.oyentes.size).toBe(2)

    unmount()
    expect(removeSpotlight).not.toHaveBeenCalled()
    expect(removePreset).not.toHaveBeenCalled()
    expect([...estadoSpotlight.oyentes]).toEqual([otroSpotlight])
    expect([...estadoSetup.oyentes]).toEqual([otroSetup])
  })

  it('sigue recibiendo el estado del setup', async () => {
    const { container } = render(seccion())
    await waitFor(() => expect(screen.getByText('main')).toBeInTheDocument())
    expect(container.querySelector('.wt-dot-yellow')).not.toBeNull()
    act(() => estadoSetup.emitir(ROOT, 'done'))
    expect(container.querySelector('.wt-dot-green')).not.toBeNull()
  })
})
