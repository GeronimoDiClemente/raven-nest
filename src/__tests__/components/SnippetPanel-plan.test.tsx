// Corte comercial 2026-09-10: lo LOCAL es gratis en todos los planes; lo que se paga es
// la memoria en la nube y Teams.
//
// El gate de este panel no estaba donde parecia. `if (plan === 'free')` no bloqueaba
// abrir el panel (eso ya era libre) sino `handleShare` — o sea COMPARTIR, que segun donde
// caiga es Community (libre) o Team (pago). Por eso el gate se conserva, pero arreglado
// en dos puntos:
//
//   1. Mira `PLAN_LIMITS[plan].memoryTeamShare`, no el NOMBRE del plan. Con
//      `plan === 'free'` un usuario **Cloud** podia compartir al equipo, y
//      `PLAN_LIMITS.cloud` tiene `memoryTeamShare: false`.
//   2. Solo aplica cuando hay equipo. Sin `team`, esto comparte a Community.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Plan } from '../../lib/stripe'

const equipo = { actual: null as { id: string } | null }
const planActual = { actual: 'free' as Plan }

vi.mock('../../hooks/useTeam', () => ({ useTeam: () => ({ team: equipo.actual }) }))
vi.mock('../../hooks/useProfile', () => ({
  useProfile: () => ({ plan: planActual.actual, isTrialActive: false, trialDaysLeft: 0 }),
}))

const share = vi.fn().mockResolvedValue(true)
vi.mock('../../hooks/useSharedSnippets', () => ({
  useSharedSnippets: () => ({
    items: [], loading: false, userId: null, refresh: vi.fn(), share, remove: vi.fn(),
  }),
}))

import SnippetPanel from '../../components/SnippetPanel'

async function abrirYCompartir(onRequireUpgrade = vi.fn()) {
  render(<SnippetPanel onSend={vi.fn()} onBroadcast={vi.fn()} onRequireUpgrade={onRequireUpgrade} />)
  fireEvent.click(screen.getByTitle('Snippets'))
  await waitFor(() => expect(screen.getByText('Mi snippet')).toBeInTheDocument())
  fireEvent.click(screen.getByTitle(equipo.actual ? 'Share to Team' : 'Share to Community'))
  return onRequireUpgrade
}

describe('SnippetPanel — compartir segun la capacidad del plan', () => {
  beforeEach(() => {
    share.mockClear()
    equipo.actual = null
    planActual.actual = 'free'
    window.snippets = {
      list: vi.fn().mockResolvedValue([{ id: 'sn-1', name: 'Mi snippet', content: 'echo hola' }]),
      save: vi.fn(),
      delete: vi.fn(),
    } as never
  })

  it('free SIN equipo comparte a Community sin ningun gate', async () => {
    const upgrade = await abrirYCompartir()
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(upgrade).not.toHaveBeenCalled()
  })

  it('free CON equipo no comparte: pide upgrade', async () => {
    equipo.actual = { id: 'team-1' }
    const upgrade = await abrirYCompartir()
    await waitFor(() => expect(upgrade).toHaveBeenCalled())
    expect(share).not.toHaveBeenCalled()
  })

  // El bug que el gate viejo tenia al reves: `plan === 'free'` dejaba pasar a Cloud.
  it('cloud CON equipo tampoco comparte — memoryTeamShare es false para Cloud', async () => {
    equipo.actual = { id: 'team-1' }
    planActual.actual = 'cloud'
    const upgrade = await abrirYCompartir()
    await waitFor(() => expect(upgrade).toHaveBeenCalled())
    expect(share).not.toHaveBeenCalled()
  })

  it('team CON equipo si comparte', async () => {
    equipo.actual = { id: 'team-1' }
    planActual.actual = 'team'
    const upgrade = await abrirYCompartir()
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(upgrade).not.toHaveBeenCalled()
  })
})
