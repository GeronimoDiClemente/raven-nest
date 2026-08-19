import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PaneFilterControl from '../../components/PaneFilterControl'
import type { AIType, PaneNode } from '../../types'

function pane(id: string, aiType: AIType): PaneNode {
  return { id, aiType, accountName: '', accountDir: '', borderColor: '', cmd: '' }
}

const mixed = [pane('1', 'claude'), pane('2', 'editor'), pane('3', 'terminal')]

// El filtro vive como ítem de la columna del sidebar (embudo + popover),
// visible también con el sidebar colapsado — decisión de Bautista tras ver
// que los chips en la tabbar competían con las tabs de workspace.
describe('PaneFilterControl', () => {
  it('renders nothing when the workspace has a single group', () => {
    const { container } = render(
      <PaneFilterControl panes={[pane('1', 'claude')]} filter="all" onChange={vi.fn()} expanded={false} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the chips popover on click and forwards the selection', () => {
    const onChange = vi.fn()
    render(<PaneFilterControl panes={mixed} filter="all" onChange={onChange} expanded={true} />)
    expect(screen.queryByRole('button', { name: /Editor/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Filter panes'))
    fireEvent.click(screen.getByRole('button', { name: /Editor 1/ }))
    expect(onChange).toHaveBeenCalledWith('editor')
    // elegir cierra el popover
    expect(screen.queryByRole('button', { name: /Editor 1/ })).not.toBeInTheDocument()
  })

  it('closes the popover on Escape, like every sibling popover', () => {
    render(<PaneFilterControl panes={mixed} filter="all" onChange={vi.fn()} expanded={true} />)
    fireEvent.click(screen.getByTitle('Filter panes'))
    expect(screen.getByRole('button', { name: /All 3/ })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /All 3/ })).not.toBeInTheDocument()
  })

  // Un filtro activo invisible parece "perdí mis panes": el trigger tiene
  // que gritar el estado aunque el sidebar esté colapsado.
  it('highlights the trigger and shows the active group as badge', () => {
    render(<PaneFilterControl panes={mixed} filter="editor" onChange={vi.fn()} expanded={true} />)
    const trigger = screen.getByTitle('Filter panes')
    expect(trigger.className).toContain('active')
    expect(trigger.textContent).toContain('Editor')
  })
})
