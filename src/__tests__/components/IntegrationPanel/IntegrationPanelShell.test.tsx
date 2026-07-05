// src/__tests__/components/IntegrationPanel/IntegrationPanelShell.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntegrationPanelShell } from '../../../components/IntegrationPanel/IntegrationPanelShell'
import { createMockAdapter } from '../../../integrations/mockAdapter'

const ctx = { repoPath: 'C:/dev/raven-nest', branch: 'feat/integrations' }

describe('IntegrationPanelShell', () => {
  it('carga secciones, selecciona la entidad del worktree y muestra el detalle', async () => {
    render(<IntegrationPanelShell adapter={createMockAdapter()} worktreeContext={ctx} />)
    await waitFor(() => expect(screen.getAllByText('Marketplace de integraciones — OAuth Slack').length).toBeGreaterThan(0))
    expect(screen.getByText('In Progress')).toBeTruthy()
  })

  it('una acción actualiza el estado del detalle', async () => {
    render(<IntegrationPanelShell adapter={createMockAdapter()} worktreeContext={ctx} />)
    await waitFor(() => screen.getByText('→ Done'))
    fireEvent.click(screen.getByText('→ Done'))
    await waitFor(() => expect(screen.getByText('Done')).toBeTruthy())
  })

  it('compose agrega el comentario al detalle', async () => {
    render(
      <IntegrationPanelShell adapter={createMockAdapter()} worktreeContext={ctx}
        getTerminalOutput={() => '$ npm test'} />,
    )
    await waitFor(() => screen.getByRole('textbox'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'probando compose' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(screen.getByText(/probando compose/)).toBeTruthy())
  })
})
