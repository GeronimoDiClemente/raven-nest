// Decisión de Gero del 2026-10-09, después del e2e de dos máquinas en la app real: con
// memorias sueltas, el grafo vacío («0 shown · 1 unconnected hidden») se llevaba la pantalla y
// dejaba la lista —lo único con contenido— abajo del pliegue. Sin vínculos no hay grafo; el
// documento de la memoria elegida sigue apareciendo, porque vive en este mismo panel.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import MemoryGraphPanel from '../../components/MemoryGraphPanel'

const nodo = (syncId: string, title: string) => ({
  syncId, projectKey: 'raven-nest', projectDisplayName: 'Raven Nest',
  tags: [], title, type: 'decision',
  scope: 'personal', topicKey: null, gitBranch: 'main', originAi: null,
  authorDisplay: null, updatedAt: Date.now(), superseded: false,
})

const DETALLE = {
  syncId: 'obs-1', title: 'Usar pgbouncer en modo session', content: 'Por los prepared statements.',
  type: 'decision', projectKey: 'raven-nest', gitBranch: 'main', tags: [], updatedAt: Date.now(),
  originAi: null, supersededBy: null, links: [], mentionedIn: [],
}

function conGrafo(edges: unknown[]) {
  const graph = vi.fn(async () => ({ nodes: [nodo('obs-1', DETALLE.title), nodo('obs-2', 'Otra')], edges, truncated: 0 }))
  ;(window as unknown as { memory: unknown }).memory = { graph, observation: vi.fn(async () => DETALLE) }
  return graph
}

describe('el grafo de memorias sin vínculos', () => {
  beforeEach(() => { conGrafo([]) })

  it('sin ningún vínculo y sin nada elegido, no ocupa lugar', async () => {
    const graph = conGrafo([])
    const { container } = render(<MemoryGraphPanel selectedId={null} onSelect={vi.fn()} />)
    await waitFor(() => expect(graph).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
  })

  it('con una memoria elegida muestra su documento, sin el grafo ni sus filtros', async () => {
    render(<MemoryGraphPanel selectedId="obs-1" onSelect={vi.fn()} />)
    expect(await screen.findByText(DETALLE.title)).toBeInTheDocument()
    expect(screen.queryByText(/unconnected hidden/)).toBeNull()
    expect(screen.queryByRole('button', { name: /guessed links/ })).toBeNull()
  })

  it('con un vínculo, el grafo aparece', async () => {
    conGrafo([{ from: 'obs-1', to: 'obs-2', kind: 'similar', directed: false }])
    render(<MemoryGraphPanel selectedId={null} onSelect={vi.fn()} />)
    expect(await screen.findByRole('button', { name: /guessed links/ })).toBeInTheDocument()
  })
})
