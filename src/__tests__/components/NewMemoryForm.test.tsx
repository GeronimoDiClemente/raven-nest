// Ruling del controller (fix round 1, tarea 1): este formulario es donde una PERSONA
// escribe una memoria a mano, así que sólo ofrece los 7 tipos que alguien elegiría por su
// cuenta. `session`/`handoff` los escriben los agentes y el flujo de handoff automático —
// no tienen sentido como botón acá, aunque sigan en la leyenda fija de 9 que usan el grafo
// y la lista.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import NewMemoryForm from '../../components/NewMemoryForm'

describe('NewMemoryForm — selector de tipo', () => {
  it('ofrece los 7 tipos que se escriben a mano, en el orden de la leyenda', () => {
    render(<NewMemoryForm activeRepoPath={null} onClose={vi.fn()} onSaved={vi.fn()} />)

    const esperados = ['Decision', 'Bugfix', 'Architecture', 'Discovery', 'Pattern', 'Config', 'Preference']
    for (const label of esperados) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}$`) })).toBeInTheDocument()
    }
  })

  it('NO ofrece Session ni Handoff — los escriben los agentes, no una persona', () => {
    render(<NewMemoryForm activeRepoPath={null} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /^Session$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Handoff$/ })).not.toBeInTheDocument()
  })

  it('decision sigue siendo el tipo por default (primer boton presionado)', () => {
    render(<NewMemoryForm activeRepoPath={null} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.getByRole('button', { name: /^Decision$/ })).toHaveAttribute('aria-pressed', 'true')
  })
})
