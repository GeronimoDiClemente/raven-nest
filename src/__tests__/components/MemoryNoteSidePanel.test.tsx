import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
vi.mock('../../components/memories/MemoryGraph2D', () => ({ default: () => <div data-testid="local" /> }))
import MemoryNoteSidePanel from '../../components/memories/MemoryNoteSidePanel'

const detail = {
  syncId: 's1', projectKey: 'p1', scope: 'personal' as const, type: 'decision', title: 'Auth', content: '## Why\nx',
  tags: ['auth'], topicKey: null, gitBranch: 'main', originAi: 'claude', authorDisplay: null, createdAt: 1, updatedAt: 1,
  supersededBy: null, revisionCount: 2,
  links: [{ name: 'Otra', syncId: 's2' }, { name: 'Falta', syncId: null }],
  mentionedIn: [{ syncId: 's3', title: 'La que me nombra' }],
}
describe('MemoryNoteSidePanel', () => {
  it('backlinks, links salientes con huecos, propiedades y outline', () => {
    const onOpen = vi.fn(), onIrALinea = vi.fn()
    render(<MemoryNoteSidePanel detail={detail} graphData={{ nodes: [], links: [], orphansHidden: 0 }}
      titulosPorId={new Map([['s2', { title: 'Otra memoria', type: 'bugfix' }]])} onOpen={onOpen} onIrALinea={onIrALinea} />)
    fireEvent.click(screen.getByRole('button', { name: /La que me nombra/ }))
    expect(onOpen).toHaveBeenCalledWith('s3', { background: false })
    fireEvent.click(screen.getByRole('button', { name: /Otra memoria/ }))
    expect(onOpen).toHaveBeenCalledWith('s2', { background: false })
    expect(screen.getByText(/Falta — not written yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Falta/ })).toBeNull()
    expect(screen.getByText('main')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Why' }))
    expect(onIrALinea).toHaveBeenCalledWith(1)
  })
})
