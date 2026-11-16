// Corte comercial 2026-09-02: lo local es gratis en todos los planes. Abrir el panel
// de MCP servers usaba `if (plan === 'free') { onRequireUpgrade?.(); return }`
// (MCPPanel.tsx) — se saco junto con la prop `onRequireUpgrade` y el `useProfile()`
// del componente, que quedaron sin ningun uso. Este test prueba que el panel abre
// sin ningun gate de por medio.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../hooks/useTeam', () => ({ useTeam: () => ({ team: null }) }))
vi.mock('../../hooks/useSharedMcpConfigs', () => ({
  useSharedMcpConfigs: () => ({ share: vi.fn() }),
}))

import MCPPanel from '../../components/MCPPanel'

describe('MCPPanel — sin el gate de plan', () => {
  beforeEach(() => {
    window.mcp = {
      globalPath: vi.fn().mockResolvedValue('/home/gero/.raven-nest/mcp.json'),
      read: vi.fn().mockResolvedValue({}),
    } as never
  })

  it('abre el panel sin ningun gate de plan de por medio', async () => {
    render(<MCPPanel />)

    fireEvent.click(screen.getByTitle('MCP Servers'))

    await waitFor(() => expect(document.querySelector('.mcp-panel')).not.toBeNull())
  })
})
