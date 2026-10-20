import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import GraphFiltersPanel from '../../components/memories/GraphFiltersPanel'
import { useGraphFilters } from '../../hooks/useGraphFilters'
import type { MemoryGraph } from '../../types'

const g: MemoryGraph = {
  truncated: 0,
  nodes: [
    { syncId: 'a', projectKey: 'p1', projectDisplayName: 'raven-nest', tags: ['auth'], title: 'A', type: 'decision', scope: 'personal', topicKey: null, gitBranch: null, originAi: null, authorDisplay: null, updatedAt: 1, superseded: false },
    { syncId: 'b', projectKey: 'p1', projectDisplayName: 'raven-nest', tags: [], title: 'B', type: 'bugfix', scope: 'personal', topicKey: null, gitBranch: null, originAi: null, authorDisplay: null, updatedAt: 2, superseded: false },
  ],
  edges: [{ from: 'a', to: 'b', kind: 'wikilink', directed: true }],
}

function Harness() {
  const filtros = useGraphFilters(g)
  const [inc, setInc] = useState(true)
  return (<>
    <GraphFiltersPanel graph={g} filtros={filtros} includeSimilar={inc} onIncludeSimilar={setInc} />
    <output data-testid="nodos">{filtros.data.nodes.map((n) => n.id).join(',')}</output>
  </>)
}

describe('GraphFiltersPanel', () => {
  it('ocultar un tipo lo saca del grafo', () => {
    render(<Harness />)
    expect(screen.getByTestId('nodos').textContent).toBe('a,b')
    // Sin B, A queda sin conexiones: con el filtro de huerfanas (default) tambien se va.
    fireEvent.click(screen.getByRole('button', { name: /^Bugfix/ }))
    expect(screen.getByTestId('nodos').textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: /unconnected hidden/ }))
    expect(screen.getByTestId('nodos').textContent).toBe('a')
  })
  it('el boton de links adivinados alterna includeSimilar', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide guessed links' }))
    expect(screen.getByRole('button', { name: 'Show guessed links' })).toBeInTheDocument()
  })
  it('Color by tiene Type, Project y Tag', () => {
    render(<Harness />)
    for (const n of ['Type', 'Project', 'Tag']) expect(screen.getByRole('button', { name: n, exact: true } as never)).toBeInTheDocument()
  })
})
