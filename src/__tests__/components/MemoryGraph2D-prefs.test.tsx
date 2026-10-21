import { forwardRef, useImperativeHandle } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

type Recibidas = { warmupTicks: number; cooldownTicks: number; nodeCanvasObject: (n: unknown, ctx: unknown, escala: number) => void }
const recibidas: Recibidas[] = []
vi.mock('react-force-graph-2d', () => ({
  default: forwardRef(function FG(props: Recibidas & { graphData: { nodes: Array<{ id: string }> } }, ref) {
    useImperativeHandle(ref, () => ({ d3Force: () => ({ distance: () => {}, strength: () => {} }), d3ReheatSimulation: () => {} }))
    recibidas.push(props)
    return <div data-testid="fg2d" />
  }),
}))

import MemoryGraph2D from '../../components/memories/MemoryGraph2D'

const nodo = { id: 'a', label: 'Alfa', color: '#fff', val: 1, degree: 1, superseded: false, type: 'decision', projectKey: 'p', projectLabel: 'p', tags: [], gitBranch: null, pending: false, x: 0, y: 0 }
const data = { nodes: [nodo], links: [], orphansHidden: 0 }
const ctx = () => ({ beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '' })
const ultima = () => recibidas[recibidas.length - 1]

beforeEach(() => { recibidas.length = 0 })

describe('MemoryGraph2D — preferencias', () => {
  it('Animate off: se acomoda en warmup y no anima (cooldown 0)', async () => {
    render(<MemoryGraph2D modo="global" data={data} onOpen={vi.fn()} animar={false} />)
    await screen.findByTestId('fg2d')
    expect(ultima().cooldownTicks).toBe(0)
    expect(ultima().warmupTicks).toBeGreaterThan(0)
  })

  it('Labels: Always dibuja el nombre sin zoom; On hover no', async () => {
    const { rerender } = render(<MemoryGraph2D modo="global" data={data} onOpen={vi.fn()} etiquetas="always" />)
    await screen.findByTestId('fg2d')
    const c1 = ctx()
    ultima().nodeCanvasObject(nodo, c1, 1)
    expect(c1.fillText).toHaveBeenCalledWith('Alfa', expect.any(Number), expect.any(Number))
    rerender(<MemoryGraph2D modo="global" data={data} onOpen={vi.fn()} etiquetas="hover" />)
    const c2 = ctx()
    ultima().nodeCanvasObject(nodo, c2, 1)
    expect(c2.fillText).not.toHaveBeenCalled()
  })
})
