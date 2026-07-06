// src/__tests__/components/IntegrationPanel/presentational.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorktreeContextCard } from '../../../components/IntegrationPanel/WorktreeContextCard'
import { ContextColumn } from '../../../components/IntegrationPanel/ContextColumn'
import { ComposeBar } from '../../../components/IntegrationPanel/ComposeBar'

describe('WorktreeContextCard', () => {
  it('muestra branch y entidad resuelta', () => {
    render(<WorktreeContextCard branch="feat/integrations" entityLabel="DEMO-231" />)
    expect(screen.getByText('feat/integrations')).toBeTruthy()
    expect(screen.getByText(/DEMO-231/)).toBeTruthy()
  })
  it('sin branch no renderiza nada', () => {
    const { container } = render(<WorktreeContextCard branch={null} entityLabel={null} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('ContextColumn', () => {
  const sections = [{
    id: 'mine', label: 'Mi trabajo',
    items: [{ id: 'a', title: 'Item A', subtitle: 'To Do', accent: 'DEMO-1' }],
  }]
  it('lista secciones e items y notifica selección', () => {
    const onSelect = vi.fn()
    render(
      <ContextColumn sections={sections} selected={null} onSelect={onSelect}
        header={{ title: 'Demo', subtitle: 'mock' }} branch={null} entityLabel={null} />,
    )
    fireEvent.click(screen.getByText('Item A'))
    expect(onSelect).toHaveBeenCalledWith({ sectionId: 'mine', itemId: 'a' })
  })
  it('marca activo solo el item de la sección seleccionada (mismo itemId en dos secciones)', () => {
    const twoSections = [
      { id: 'a', label: 'Sección A', items: [{ id: 'x', title: 'Item X en A' }] },
      { id: 'b', label: 'Sección B', items: [{ id: 'x', title: 'Item X en B' }] },
    ]
    render(
      <ContextColumn sections={twoSections} selected={{ sectionId: 'b', itemId: 'x' }}
        onSelect={vi.fn()} header={{ title: 'Demo' }} branch={null} entityLabel={null} />,
    )
    const btnA = screen.getByText('Item X en A').closest('button')!
    const btnB = screen.getByText('Item X en B').closest('button')!
    expect(btnA.getAttribute('aria-pressed')).toBe('false')
    expect(btnB.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('ComposeBar', () => {
  it('envía texto y output adjuntado', () => {
    const onSubmit = vi.fn()
    render(<ComposeBar placeholder="Comment…" onSubmit={onSubmit} getTerminalOutput={() => '$ ok'} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hola' } })
    fireEvent.click(screen.getByText('⌨ Attach terminal output'))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith({ text: 'hola', terminalOutput: '$ ok' })
  })
})
