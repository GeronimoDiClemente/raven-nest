import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PaneErrorBoundary } from '../../components/PaneErrorBoundary'

// Sin boundary, un throw en render/commit de un pane desmonta el árbol de
// React ENTERO (React 18, sin recovery) — visto en producción como pantalla
// negra cuando el setTheme patcheado de shiki tiraba en un commit (2026-08-18).
// El boundary convierte eso en "este pane se rompió", con el resto de la app viva.

let shouldThrow = true

function Bomb() {
  if (shouldThrow) throw new Error('kaboom del pane')
  return <div>pane content alive</div>
}

beforeEach(() => {
  shouldThrow = true
  // React loguea el error capturado por console.error — esperado, no ruido real.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PaneErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    shouldThrow = false
    render(
      <PaneErrorBoundary onClose={() => {}}>
        <Bomb />
      </PaneErrorBoundary>,
    )
    expect(screen.getByText('pane content alive')).toBeInTheDocument()
    expect(screen.queryByTestId('pane-crashed')).not.toBeInTheDocument()
  })

  it('catches a child render throw and shows the fallback with the error message', () => {
    render(
      <PaneErrorBoundary onClose={() => {}}>
        <Bomb />
      </PaneErrorBoundary>,
    )
    expect(screen.getByTestId('pane-crashed')).toBeInTheDocument()
    expect(screen.getByText(/kaboom del pane/)).toBeInTheDocument()
    expect(screen.queryByText('pane content alive')).not.toBeInTheDocument()
  })

  it('remounts the children when Reload pane is clicked', () => {
    render(
      <PaneErrorBoundary onClose={() => {}}>
        <Bomb />
      </PaneErrorBoundary>,
    )
    expect(screen.getByTestId('pane-crashed')).toBeInTheDocument()
    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: 'Reload pane' }))
    expect(screen.getByText('pane content alive')).toBeInTheDocument()
    expect(screen.queryByTestId('pane-crashed')).not.toBeInTheDocument()
  })

  it('calls onClose when Close pane is clicked', () => {
    const onClose = vi.fn()
    render(
      <PaneErrorBoundary onClose={onClose}>
        <Bomb />
      </PaneErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close pane' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
