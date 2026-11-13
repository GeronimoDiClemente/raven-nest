// Task 2 (mirar vs. configurar): el toggle del hilo de equipo, aparte del grafo — va
// montado en la pestaña Settings (sección This project), no dentro de TeamThreadGraph.
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import TeamThreadToggle from '../../components/TeamThreadToggle'
import { useTeamThreadSettings } from '../../hooks/useTeamThreadSettings'

function ConHilo() {
  const hilo = useTeamThreadSettings('/repo')
  return <TeamThreadToggle hilo={hilo} />
}

it('el switch prende las notas por rama', async () => {
  ;(window as any).memory = {
    teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: true, projectKey: 'pk' }),
    teamThreadGetSettings: vi.fn().mockResolvedValue({ ok: true, settings: { enabled: false } }),
    teamThreadSetSettings: vi.fn().mockResolvedValue({ ok: true }),
  }
  render(<ConHilo />)
  const sw = await screen.findByRole('switch', { name: 'Branch notes' })
  fireEvent.click(sw)
  await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'))
})

// Review final de rama, MINOR: `text-fs-md` no existe en la escala de `tailwind.css`
// (2xs/xs/sm/base/lg/xl/2xl, sin `md`) — Tailwind la descarta en silencio, sin error de
// build, así que la etiqueta quedaba sin ningún tamaño de fuente propio.
it('el label usa una clase de la escala tipografica real (no text-fs-md, que no existe)', () => {
  ;(window as any).memory = {
    teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: false }),
  }
  render(<ConHilo />)
  const label = screen.getByText('Branch notes')
  expect(label.className).not.toMatch(/text-fs-md/)
  expect(label.className).toMatch(/\btext-fs\b/)
})

it('la fila dice qué hace y un rechazo se ve', async () => {
  ;(window as any).memory = {
    teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: true, projectKey: 'pk' }),
    teamThreadGetSettings: vi.fn().mockResolvedValue({ ok: true, settings: { enabled: false } }),
    teamThreadSetSettings: vi.fn().mockResolvedValue({ ok: false, message: 'Your plan does not include it' }),
  }
  render(<ConHilo />)
  expect(screen.getByText(/It travels with git, so it's readable without Nest/)).toBeInTheDocument()
  const sw = await screen.findByRole('switch', { name: 'Branch notes' })
  await waitFor(() => expect(sw).not.toBeDisabled())
  fireEvent.click(sw)
  expect(await screen.findByText('Your plan does not include it')).toBeInTheDocument()
})
