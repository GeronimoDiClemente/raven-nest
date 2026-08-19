import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SidebarSplit from '../../components/SidebarSplit'

// Splitter Worktrees/Explorer del sidebar (pedido de Gero/Bautista): el alto
// entre las dos secciones se ajusta arrastrando, igual que entre panes.
// Con una sola sección presente no hay nada que repartir: render directo.
describe('SidebarSplit', () => {
  it('renders both sections with a drag separator between them', () => {
    render(
      <SidebarSplit
        worktrees={<div data-testid="wt">worktrees</div>}
        explorer={<div data-testid="ex">explorer</div>}
      />,
    )
    expect(screen.getByTestId('wt')).toBeInTheDocument()
    expect(screen.getByTestId('ex')).toBeInTheDocument()
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('renders a lone section without separator', () => {
    render(<SidebarSplit worktrees={null} explorer={<div data-testid="ex">explorer</div>} />)
    expect(screen.getByTestId('ex')).toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })
})
