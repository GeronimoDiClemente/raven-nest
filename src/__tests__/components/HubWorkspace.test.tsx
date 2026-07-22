import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import HubWorkspace from '../../components/HubWorkspace'
import type { HubEntry, HubGroup } from '../../lib/hub-compose'
import type { PaneNode } from '../../types'

vi.mock('../../hooks/useHubTerminal', () => ({
  useHubTerminal: () => ({ containerRef: { current: null }, focusTile: vi.fn() }),
}))
vi.mock('../../pty-events', () => ({
  subscribeToPtyExit: () => () => {},
}))

beforeEach(() => {
  Object.defineProperty(window, 'pty', {
    value: { exists: () => Promise.resolve(true) },
    configurable: true, writable: true,
  })
})

const pane = (id: string, extra: Partial<PaneNode> = {}): PaneNode => ({
  id, aiType: 'terminal', accountName: '', accountDir: '', borderColor: '#888', cmd: '', ...extra,
})
const entry = (id: string, tabId: string, tabName: string): HubEntry => ({
  pane: pane(id), tabId, tabName, accentColor: '#123', isActiveTab: false, busy: false,
})
const group = (tabId: string, tabName: string, entries: HubEntry[], hiddenCount = 0): HubGroup =>
  ({ tabId, tabName, accentColor: '#123', entries, hiddenCount })

const baseProps = {
  counts: { all: 3, active: 0, pinned: 0 },
  shownCount: 3,
  hiddenCount: 0,
  filter: 'all' as const,
  focusTarget: null,
  onFilter: () => {},
  onJump: () => {},
  onTogglePin: () => {},
  onHide: () => {},
  onShowWorkspace: () => {},
}

describe('HubWorkspace (grouped mirror grid)', () => {
  it('renders one section header per source workspace', () => {
    const groups = [
      group('wsA', 'API', [entry('a1', 'wsA', 'API'), entry('a2', 'wsA', 'API')]),
      group('wsB', 'Web', [entry('b1', 'wsB', 'Web')]),
    ]
    render(<HubWorkspace {...baseProps} groups={groups} />)
    expect(screen.getByText('API')).toBeTruthy()
    expect(screen.getByText('Web')).toBeTruthy()
  })

  it('shows how many terminals are hidden and re-shows a workspace on demand', () => {
    const onShowWorkspace = vi.fn()
    const groups = [group('wsA', 'API', [entry('a1', 'wsA', 'API')], 2)]
    render(
      <HubWorkspace {...baseProps} groups={groups} hiddenCount={2} onShowWorkspace={onShowWorkspace} />,
    )
    expect(screen.getByText(/2 hidden/i)).toBeTruthy()
    fireEvent.click(screen.getByTitle('Show 2 hidden'))
    expect(onShowWorkspace).toHaveBeenCalledWith('wsA')
  })

  it('switches the cross-cutting filter from the toolbar', () => {
    const onFilter = vi.fn()
    render(<HubWorkspace {...baseProps} groups={[]} onFilter={onFilter} />)
    fireEvent.click(screen.getByText(/Active/))
    expect(onFilter).toHaveBeenCalledWith('active')
  })

  it('shows an empty state when nothing is composed into the Hub', () => {
    render(<HubWorkspace {...baseProps} groups={[]} shownCount={0} counts={{ all: 0, active: 0, pinned: 0 }} />)
    expect(screen.getByText(/no terminals/i)).toBeTruthy()
  })
})
