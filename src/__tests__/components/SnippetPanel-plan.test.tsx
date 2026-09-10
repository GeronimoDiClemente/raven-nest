// Corte comercial 2026-09-02: lo local es gratis en todos los planes. Compartir un
// snippet a Team/Community usaba `if (plan === 'free') { onRequireUpgrade?.(); return }`
// (SnippetPanel.tsx) — se saco junto con la prop `onRequireUpgrade`, que quedo sin
// ningun uso en el componente. Este test prueba que la accion ocurre sin ningun gate
// de por medio.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../hooks/useTeam', () => ({ useTeam: () => ({ team: null }) }))

const share = vi.fn().mockResolvedValue(true)
vi.mock('../../hooks/useSharedSnippets', () => ({
  useSharedSnippets: () => ({
    items: [],
    loading: false,
    userId: null,
    refresh: vi.fn(),
    share,
    remove: vi.fn(),
  }),
}))

import SnippetPanel from '../../components/SnippetPanel'

describe('SnippetPanel — sin el gate de plan', () => {
  beforeEach(() => {
    share.mockClear()
    window.snippets = {
      list: vi.fn().mockResolvedValue([{ id: 'sn-1', name: 'Mi snippet', content: 'echo hola' }]),
      save: vi.fn(),
      delete: vi.fn(),
    } as never
  })

  it('comparte un snippet sin ningun gate de plan de por medio', async () => {
    render(<SnippetPanel onSend={vi.fn()} onBroadcast={vi.fn()} />)

    fireEvent.click(screen.getByTitle('Snippets'))
    await waitFor(() => expect(screen.getByText('Mi snippet')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('Share to Community'))

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
  })
})
