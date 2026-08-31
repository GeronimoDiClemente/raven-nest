import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PaneFilterChips from '../../components/PaneFilterChips'
import type { AIType, PaneNode } from '../../types'

function pane(id: string, aiType: AIType): PaneNode {
  return { id, aiType, accountName: '', accountDir: '', borderColor: '', cmd: '' }
}

const mixed = [pane('1', 'claude'), pane('2', 'editor'), pane('3', 'gemini'), pane('4', 'terminal')]

describe('PaneFilterChips', () => {
  it('renders nothing when the workspace has a single group (no hay nada que separar)', () => {
    const { container } = render(
      <PaneFilterChips panes={[pane('1', 'claude'), pane('2', 'gemini')]} filter="all" onChange={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders an All chip plus one chip per group present, with counts', () => {
    render(<PaneFilterChips panes={mixed} filter="all" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /All 4/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Agents 2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Editor 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Terminal 1/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Browser/ })).not.toBeInTheDocument()
  })

  it('clicking a group selects it; clicking the active group toggles back to all', () => {
    const onChange = vi.fn()
    const { rerender } = render(<PaneFilterChips panes={mixed} filter="all" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))
    expect(onChange).toHaveBeenLastCalledWith('agents')
    rerender(<PaneFilterChips panes={mixed} filter="agents" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))
    expect(onChange).toHaveBeenLastCalledWith('all')
  })

  it('marks the active chip (default: All)', () => {
    const { rerender } = render(<PaneFilterChips panes={mixed} filter="all" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /All/ }).className).toContain('on')
    rerender(<PaneFilterChips panes={mixed} filter="editor" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Editor/ }).className).toContain('on')
    expect(screen.getByRole('button', { name: /All/ }).className).not.toContain('on')
  })
})
