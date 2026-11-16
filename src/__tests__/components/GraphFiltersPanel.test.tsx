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

function Harness({ graph = g }: { graph?: MemoryGraph }) {
  const [inc, setInc] = useState(true)
  const filtros = useGraphFilters(graph, undefined, inc)
  return (<>
    <GraphFiltersPanel graph={graph} filtros={filtros} includeSimilar={inc} onIncludeSimilar={setInc} />
    <output data-testid="nodos">{filtros.data.nodes.map((n) => n.id).join(',')}</output>
    <output data-testid="aristas">{filtros.data.links.map((l) => l.kind).join(',')}</output>
    <output data-testid="local">{filtros.dataCompleta.nodes.map((n) => n.id).join(',')}</output>
  </>)
}

const conInferidas: MemoryGraph = {
  ...g,
  nodes: [...g.nodes, { ...g.nodes[1], syncId: 'c', title: 'C' }, { ...g.nodes[1], syncId: 'd', title: 'D' }],
  edges: [
    { from: 'a', to: 'b', kind: 'wikilink', directed: true },
    { from: 'b', to: 'c', kind: 'branch', directed: false },
    { from: 'c', to: 'd', kind: 'topic', directed: false },
    { from: 'a', to: 'd', kind: 'similar', directed: false },
  ],
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
  it('Guessed links es un interruptor: apagado saca TODAS las inferidas, no solo similar (F7)', () => {
    render(<Harness graph={conInferidas} />)
    const boton = screen.getByRole('button', { name: 'Guessed links' })
    expect(boton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('aristas').textContent).toBe('wikilink,branch,topic,similar')
    fireEvent.click(boton)
    expect(boton).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('aristas').textContent).toBe('wikilink')
    // Sin las inferidas, c y d quedan sueltas y se van con "Hide unconnected".
    expect(screen.getByTestId('nodos').textContent).toBe('a,b')
  })
  it('el grafo del local no lleva los filtros de la pestana Graph (F5)', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /^Bugfix/ }))
    expect(screen.getByTestId('nodos').textContent).toBe('')
    expect(screen.getByTestId('local').textContent).toBe('a,b')
  })
  it('Color by tiene Type, Project y Tag', () => {
    render(<Harness />)
    for (const n of ['Type', 'Project', 'Tag']) expect(screen.getByRole('button', { name: n, exact: true } as never)).toBeInTheDocument()
  })
})
