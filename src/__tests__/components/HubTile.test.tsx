import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import HubTile from '../../components/HubTile'
import type { HubEntry } from '../../lib/hub-compose'
import type { PaneNode } from '../../types'

// The tile's xterm mirror is irrelevant to the header controls under test.
vi.mock('../../hooks/useHubTerminal', () => ({
  useHubTerminal: () => ({ containerRef: { current: null }, focusTile: vi.fn() }),
}))
vi.mock('../../pty-events', () => ({
  subscribeToPtyExit: () => () => {},
}))

beforeEach(() => {
  Object.defineProperty(window, 'pty', {
    value: { exists: () => Promise.resolve(true) },
    configurable: true,
    writable: true,
  })
})

const pane = (id: string, extra: Partial<PaneNode> = {}): PaneNode => ({
  id, aiType: 'terminal', accountName: '', accountDir: '', borderColor: '#888', cmd: '', ...extra,
})
const entry = (): HubEntry => ({
  pane: pane('p1'), tabId: 'wsA', tabName: 'API', accentColor: '#123', isActiveTab: false, busy: false,
})

const baseProps = {
  focused: false,
  onFocus: () => {},
  onJump: () => {},
  onTogglePin: () => {},
}

describe('HubTile', () => {
  it('opens the pane in its workspace from the ↗ button', () => {
    const onJump = vi.fn()
    render(<HubTile {...baseProps} entry={entry()} onJump={onJump} />)
    fireEvent.click(screen.getByTitle('Open in workspace'))
    expect(onJump).toHaveBeenCalledWith('wsA', 'p1')
  })

  it('removes the pane from the Hub via the × button when onHide is provided', () => {
    const onHide = vi.fn()
    render(<HubTile {...baseProps} entry={entry()} onHide={onHide} />)
    fireEvent.click(screen.getByTitle('Remove from Hub'))
    expect(onHide).toHaveBeenCalledWith('p1')
  })

  it('hides the × control in contexts that do not support removal (no onHide)', () => {
    render(<HubTile {...baseProps} entry={entry()} />)
    expect(screen.queryByTitle('Remove from Hub')).toBeNull()
  })
})
