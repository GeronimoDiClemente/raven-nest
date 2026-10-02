// Ir de una memoria a otra desde el documento, como en Obsidian: tocar un `[[link]]` abre
// esa memoria, y al pie se ve quién menciona a la que estás leyendo.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MemoryGraphPanel from '../../components/MemoryGraphPanel'

const DETALLE = {
  syncId: 'obs-1',
  title: 'El deploy va por release.yml',
  content: 'Y nunca por build.yml. Ver [[el candado]] y [[algo pendiente]].',
  type: 'decision',
  projectKey: 'raven-nest',
  gitBranch: 'main',
  tags: [],
  updatedAt: Date.now(),
  originAi: null,
  supersededBy: null,
  links: [
    { name: 'el candado', syncId: 'obs-2' },
    { name: 'algo pendiente', syncId: null },
  ],
  mentionedIn: [{ syncId: 'obs-3', title: 'Cómo se hace una release' }],
}

const NODO = {
  syncId: 'obs-1', projectKey: 'raven-nest', projectDisplayName: 'Raven Nest',
  tags: [], title: DETALLE.title, type: 'decision',
  scope: 'personal', topicKey: null, gitBranch: 'main', originAi: null,
  authorDisplay: null, updatedAt: Date.now(), superseded: false,
}

beforeEach(() => {
  ;(window as unknown as { memory: unknown }).memory = {
    graph: vi.fn(async () => ({ nodes: [NODO], edges: [], truncated: 0 })),
    observation: vi.fn(async () => DETALLE),
  }
})

async function abrir() {
  const onSelect = vi.fn()
  render(<MemoryGraphPanel selectedId="obs-1" onSelect={onSelect} />)
  await screen.findByText(DETALLE.title)
  return onSelect
}

describe('el documento — links entre memorias', () => {
  it('tocar un [[link]] selecciona esa memoria (la misma selección que la lista y el grafo)', async () => {
    const onSelect = await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'el candado' }))
    expect(onSelect).toHaveBeenCalledWith('obs-2')
  })

  it('un hueco no es clickeable', async () => {
    await abrir()
    expect(screen.queryByRole('button', { name: 'algo pendiente' })).toBeNull()
    expect(screen.getByText('algo pendiente')).toBeInTheDocument()
  })

  it('al pie lista quién la menciona, y tocarlo la abre', async () => {
    const onSelect = await abrir()
    expect(screen.getByText('Mentioned in')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cómo se hace una release' }))
    expect(onSelect).toHaveBeenCalledWith('obs-3')
  })

  it('sin backlinks no muestra la sección vacía', async () => {
    ;(window as unknown as { memory: { observation: unknown } }).memory.observation =
      vi.fn(async () => ({ ...DETALLE, mentionedIn: [] }))
    await abrir()
    expect(screen.queryByText('Mentioned in')).toBeNull()
  })
})
