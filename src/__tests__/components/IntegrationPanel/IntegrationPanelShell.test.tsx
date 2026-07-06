// src/__tests__/components/IntegrationPanel/IntegrationPanelShell.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntegrationPanelShell } from '../../../components/IntegrationPanel/IntegrationPanelShell'
import { createMockAdapter } from '../../../integrations/mockAdapter'
import type { IntegrationAdapter, DetailModel, ItemRef } from '../../../integrations/types'

const ctx = { repoPath: 'C:/dev/raven-nest', branch: 'feat/integrations' }

describe('IntegrationPanelShell', () => {
  it('carga secciones, selecciona la entidad del worktree y muestra el detalle', async () => {
    render(<IntegrationPanelShell adapter={createMockAdapter()} worktreeContext={ctx} />)
    await waitFor(() => expect(screen.getAllByText('Integrations marketplace — Slack OAuth').length).toBeGreaterThan(0))
    expect(screen.getByText('In Progress')).toBeTruthy()
  })

  it('clickear otro ítem de la columna izquierda carga su detalle', async () => {
    render(<IntegrationPanelShell adapter={createMockAdapter()} worktreeContext={ctx} />)
    await waitFor(() => expect(screen.getAllByText('Integrations marketplace — Slack OAuth').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByText('Server-side Pro gate via Supabase'))
    await waitFor(() => expect(screen.getByText('To Do')).toBeTruthy())
    expect(screen.getAllByText('Server-side Pro gate via Supabase').length).toBeGreaterThan(1)
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
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByText(/probando compose/)).toBeTruthy())
  })

  it('guard de carreras: una resolución vieja de fetchDetail no pisa la selección más nueva', async () => {
    const base = createMockAdapter()
    // Controla manualmente cuándo resuelve fetchDetail para demo-228 y
    // demo-209, para simular que llegan fuera de orden respecto a los clicks.
    // demo-231 (la entidad del worktree) resuelve normal para no bloquear la
    // carga inicial del panel.
    const controllers: Record<string, (d: DetailModel) => void> = {}
    const pending: Record<string, Promise<DetailModel>> = {}
    const adapter: IntegrationAdapter = {
      ...base,
      fetchDetail: (ref: ItemRef) => {
        if (ref.itemId === 'demo-231') return base.fetchDetail(ref)
        if (!pending[ref.itemId]) {
          pending[ref.itemId] = new Promise<DetailModel>((resolve) => { controllers[ref.itemId] = resolve })
        }
        return pending[ref.itemId]
      },
    }

    render(<IntegrationPanelShell adapter={adapter} worktreeContext={ctx} />)
    await waitFor(() => expect(screen.getByText('In Progress')).toBeTruthy())

    // Click viejo primero (demo-228), click nuevo después (demo-209) — ambos quedan pendientes.
    fireEvent.click(screen.getByText('Server-side Pro gate via Supabase'))
    fireEvent.click(screen.getByText('Remote plugin_catalog'))

    const demo228Detail = await base.fetchDetail({ sectionId: 'mine', itemId: 'demo-228' })
    const demo209Detail = await base.fetchDetail({ sectionId: 'recent', itemId: 'demo-209' })

    // Resuelve primero la selección vieja y después la nueva: fuera de orden.
    controllers['demo-228'](demo228Detail)
    await Promise.resolve()
    controllers['demo-209'](demo209Detail)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Remote plugin_catalog' })).toBeTruthy())
    expect(screen.queryByRole('heading', { name: 'Server-side Pro gate via Supabase' })).toBeNull()
  })

  it('un error de fetchSections muestra el banner con Retry, y reintentar carga bien', async () => {
    let calls = 0
    const base = createMockAdapter()
    const adapter: IntegrationAdapter = {
      ...base,
      fetchSections: async (c) => {
        calls++
        if (calls === 1) throw new Error('network down')
        return base.fetchSections(c)
      },
    }

    render(<IntegrationPanelShell adapter={adapter} worktreeContext={ctx} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText(/network down/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    await waitFor(() => expect(screen.getAllByText('Integrations marketplace — Slack OAuth').length).toBeGreaterThan(0))
  })
})
