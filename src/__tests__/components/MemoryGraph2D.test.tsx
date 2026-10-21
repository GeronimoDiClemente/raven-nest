import { forwardRef, useImperativeHandle } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const distance = vi.fn()
const reheat = vi.fn()
const recibido: unknown[] = []

vi.mock('react-force-graph-2d', () => ({
  default: forwardRef(function FG({ graphData, onNodeClick }: { graphData: { nodes: Array<{ id: string; label: string }> }; onNodeClick: (n: { id: string }, e: MouseEvent) => void }, ref) {
    useImperativeHandle(ref, () => ({ d3Force: () => ({ distance }), d3ReheatSimulation: reheat }))
    recibido.push(graphData)
    return (
      <div data-testid="fg2d">
        {graphData.nodes.map((n) => (
          <button key={n.id} type="button" onClick={(e) => onNodeClick(n, e.nativeEvent)}>{n.label}</button>
        ))}
      </div>
    )
  }),
}))

import MemoryGraph2D from '../../components/memories/MemoryGraph2D'

const nodo = (id: string, pending = false) => ({ id, label: id, color: '#fff', val: 1, degree: 1, superseded: false, type: 'decision', projectKey: 'p', projectLabel: 'p', tags: [], gitBranch: null, pending })

describe('MemoryGraph2D', () => {
  it('click en un nodo abre la memoria; ctrl+click en segundo plano; un hueco no abre', async () => {
    const onOpen = vi.fn()
    render(<MemoryGraph2D modo="global" onOpen={onOpen} data={{ nodes: [nodo('a'), nodo('hueco', true)], links: [], orphansHidden: 0 }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'a' }))
    expect(onOpen).toHaveBeenLastCalledWith('a', { background: false })
    fireEvent.click(screen.getByRole('button', { name: 'a' }), { ctrlKey: true })
    expect(onOpen).toHaveBeenLastCalledWith('a', { background: true })
    fireEvent.click(screen.getByRole('button', { name: 'hueco' }))
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('aplica la distancia de links al montar y al cambiarla, y recalienta', async () => {
    distance.mockClear(); reheat.mockClear()
    const data = { nodes: [nodo('a')], links: [], orphansHidden: 0 }
    const { rerender } = render(<MemoryGraph2D modo="global" onOpen={vi.fn()} data={data} />)
    await screen.findByRole('button', { name: 'a' })
    expect(distance).toHaveBeenLastCalledWith(50)
    expect(reheat).toHaveBeenCalled()
    rerender(<MemoryGraph2D modo="global" onOpen={vi.fn()} data={data} distanciaDeLinks={80} />)
    expect(distance).toHaveBeenLastCalledWith(80)
  })

  it('un grafo igual en objetos nuevos no se le vuelve a dar a la libreria; uno distinto conserva posiciones (F6)', async () => {
    recibido.length = 0
    const d1 = { nodes: [nodo('a'), nodo('b')], links: [{ source: 'a', target: 'b', kind: 'wikilink' as const }], orphansHidden: 0 }
    const { rerender } = render(<MemoryGraph2D modo="global" onOpen={vi.fn()} data={d1} />)
    await screen.findByRole('button', { name: 'a' })
    const primero = recibido[recibido.length - 1] as { nodes: Array<{ id: string; x?: number }> }
    // La libreria no recibe los objetos del caller: los muta.
    expect(primero.nodes[0]).not.toBe(d1.nodes[0])
    primero.nodes[0].x = 42 // como si la simulacion lo hubiera movido
    rerender(<MemoryGraph2D modo="global" onOpen={vi.fn()} data={{ ...d1, nodes: [nodo('a'), nodo('b')] }} />)
    expect(recibido[recibido.length - 1]).toBe(primero)
    rerender(<MemoryGraph2D modo="global" onOpen={vi.fn()} data={{ ...d1, nodes: [nodo('a'), nodo('b'), nodo('c')] }} />)
    const tercero = recibido[recibido.length - 1] as { nodes: Array<{ id: string; x?: number }> }
    expect(tercero).not.toBe(primero)
    expect(tercero.nodes.find((n) => n.id === 'a')?.x).toBe(42)
  })
})
