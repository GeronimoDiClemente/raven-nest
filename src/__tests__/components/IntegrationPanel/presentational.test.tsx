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
})

describe('ComposeBar', () => {
  it('envía texto y output adjuntado', () => {
    const onSubmit = vi.fn()
    render(<ComposeBar placeholder="Comentar…" onSubmit={onSubmit} getTerminalOutput={() => '$ ok'} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hola' } })
    fireEvent.click(screen.getByText('⌨ Adjuntar output del terminal'))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(onSubmit).toHaveBeenCalledWith({ text: 'hola', terminalOutput: '$ ok' })
  })
})
