import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import HubView from '../../components/HubView'
import type { AIType, WorkspaceTab } from '../../types'

// HubGrid real monta un xterm espejo por tile — acá solo importan los
// ENTRIES que HubView le pasa tras filtrar. El stub lista ids.
vi.mock('../../components/HubGrid', async () => {
  const compose = await vi.importActual<typeof import('../../lib/hub-compose')>('../../lib/hub-compose')
  return {
    default: ({ entries }: { entries: Array<{ pane: { id: string } }> }) => (
      <div>{entries.map(e => <div key={e.pane.id} data-testid="tile">{e.pane.id}</div>)}</div>
    ),
    filterEntries: compose.filterEntries,
  }
})

function tab(id: string, panes: Array<{ id: string; aiType: AIType }>): WorkspaceTab {
  return {
    id, name: id, layoutId: '1',
    panes: panes.map(p => ({ ...p, accountName: '', accountDir: '', borderColor: '', cmd: '' })),
  }
}

const mixedTabs = [tab('ws1', [
  { id: 'ag1', aiType: 'claude' },
  { id: 'ag2', aiType: 'gemini' },
  { id: 't1', aiType: 'terminal' },
])]

function renderHub(tabs: WorkspaceTab[]) {
  return render(
    <HubView tabs={tabs} activeTabId="ws1" activePanes={new Set()} onJump={vi.fn()} onTogglePin={vi.fn()} />,
  )
}

describe('HubView type filter', () => {
  beforeEach(() => localStorage.clear())

  // Default SIEMPRE todo junto (decisión explícita): un filtro de TIPO
  // persistido no se restaura entre sesiones — solo all/active/pinned.
  it('does not restore a persisted type filter from localStorage', () => {
    localStorage.setItem('nest-hub-filter', 'agents')
    renderHub(mixedTabs)
    expect(screen.getAllByTestId('tile').map(t => t.textContent)).toEqual(['ag1', 'ag2', 't1'])
  })

  it('filters tiles to agents on chip click and back to all on toggle', () => {
    renderHub(mixedTabs)
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))
    expect(screen.getAllByTestId('tile').map(t => t.textContent)).toEqual(['ag1', 'ag2'])
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))
    expect(screen.getAllByTestId('tile')).toHaveLength(3)
  })

  // El grupo filtrado se vació (cerraste el último agente): los chips de tipo
  // desaparecen — sin fallback el filtro quedaba trabado e invisible.
  it('falls back to all when the filtered type group empties', () => {
    const { rerender } = renderHub(mixedTabs)
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))
    rerender(
      <HubView
        tabs={[tab('ws1', [{ id: 't1', aiType: 'terminal' }, { id: 't2', aiType: 'terminal' }])]}
        activeTabId="ws1" activePanes={new Set()} onJump={vi.fn()} onTogglePin={vi.fn()}
      />,
    )
    expect(screen.getAllByTestId('tile').map(t => t.textContent)).toEqual(['t1', 't2'])
    expect(screen.queryByRole('button', { name: /Agents/ })).not.toBeInTheDocument()
  })
})
