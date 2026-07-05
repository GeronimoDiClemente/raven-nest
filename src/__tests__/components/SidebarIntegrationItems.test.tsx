import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SidebarIntegrationItems } from '../../components/SidebarIntegrationItems'

describe('SidebarIntegrationItems', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: Window }).window.plugins = {
      list: vi.fn(() => Promise.resolve([{ pluginId: 'demo', scope: 'personal', enabled: true, config: {} }] as never)),
      save: vi.fn(), delete: vi.fn(),
    } as never
  })

  it('muestra las integraciones instaladas con adapter y notifica el click', async () => {
    const onOpen = vi.fn()
    render(<SidebarIntegrationItems onOpen={onOpen} />)
    await waitFor(() => screen.getByText('Demo'))
    fireEvent.click(screen.getByText('Demo'))
    expect(onOpen).toHaveBeenCalledWith('demo')
  })
})
