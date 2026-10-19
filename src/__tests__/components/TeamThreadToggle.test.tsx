// Task 2 (mirar vs. configurar): el toggle del hilo de equipo, aparte del grafo — va
// montado en la vista de settings (Task 5), no dentro de TeamThreadGraph.
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import TeamThreadToggle from '../../components/TeamThreadToggle'

it('el switch prende las notas por rama', async () => {
  ;(window as any).memory = {
    teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: true, projectKey: 'pk' }),
    teamThreadGetSettings: vi.fn().mockResolvedValue({ ok: true, settings: { enabled: false } }),
    teamThreadSetSettings: vi.fn().mockResolvedValue({ ok: true }),
  }
  render(<TeamThreadToggle activeRepoPath="/repo" />)
  const sw = await screen.findByRole('switch', { name: /Branch notes in the repo/ })
  fireEvent.click(sw)
  await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'))
})
