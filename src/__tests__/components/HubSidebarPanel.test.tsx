import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import HubSidebarPanel from '../../components/HubSidebarPanel'
import type { AIType } from '../../types'

const t = (id: string, label: string, aiType: AIType, inHub = false, busy = false) =>
  ({ id, label, color: '#22C55E', aiType, inHub, busy })

const workspaces = [
  { id: 'w1', name: 'Frontend', accentColor: '#0066FF', terminals: [
    t('p1', 'Claude', 'claude', true),
    t('p2', 'API server', 'terminal', false, true),
  ] },
  { id: 'w2', name: 'Backend', terminals: [
    t('p3', 'Gemini', 'gemini', false),
  ] },
]

const baseProps = {
  workspaces,
  expanded: true,
  onSelectWorkspace: () => {},
  onJumpToPane: () => {},
  onToggleTerminal: () => {},
  onToggleWorkspace: () => {},
  onNewWorkspace: () => {},
  onAddTerminal: () => {},
}

describe('HubSidebarPanel (curation picker)', () => {
  it('lists open workspaces and their terminals', () => {
    render(<HubSidebarPanel {...baseProps} />)
    // 'Frontend' shows twice: as a workspace header and as the origin label on
    // the pinned Claude row in the curated section.
    expect(screen.getAllByText('Frontend').length).toBeGreaterThan(0)
    expect(screen.getByText('Backend')).toBeTruthy()
    expect(screen.getByText('API server')).toBeTruthy()
    expect(screen.getByText('Gemini')).toBeTruthy()
  })

  it('shows the pinned terminals in a dedicated "In the Hub" section', () => {
    const { container } = render(<HubSidebarPanel {...baseProps} />)
    const curated = container.querySelector('.hub-sec') as HTMLElement
    expect(within(curated).getByText('In the Hub')).toBeTruthy()
    expect(within(curated).getByText('Claude')).toBeTruthy()
  })

  it('focuses a terminal in the Hub on row click (does not navigate)', () => {
    const onJumpToPane = vi.fn()
    render(<HubSidebarPanel {...baseProps} onJumpToPane={onJumpToPane} />)
    fireEvent.click(screen.getByText('API server'))
    expect(onJumpToPane).toHaveBeenCalledWith('w1', 'p2')
  })

  it('pins a terminal into the Hub via its star (no checkbox)', () => {
    const onToggleTerminal = vi.fn()
    render(<HubSidebarPanel {...baseProps} onToggleTerminal={onToggleTerminal} />)
    fireEvent.click(screen.getByTitle('Add API server to Hub'))
    expect(onToggleTerminal).toHaveBeenCalledWith('p2')
  })

  it('pins a whole workspace into the Hub', () => {
    const onToggleWorkspace = vi.fn()
    render(<HubSidebarPanel {...baseProps} onToggleWorkspace={onToggleWorkspace} />)
    fireEvent.click(screen.getByTitle('Add all of Backend'))
    expect(onToggleWorkspace).toHaveBeenCalledWith('w2')
  })

  it('creates a new workspace', () => {
    const onNewWorkspace = vi.fn()
    render(<HubSidebarPanel {...baseProps} onNewWorkspace={onNewWorkspace} />)
    fireEvent.click(screen.getByTitle('New workspace'))
    expect(onNewWorkspace).toHaveBeenCalled()
  })

  it('adds a terminal to a chosen workspace', () => {
    const onAddTerminal = vi.fn()
    render(<HubSidebarPanel {...baseProps} onAddTerminal={onAddTerminal} />)
    fireEvent.click(screen.getByTitle('New terminal in Backend'))
    expect(onAddTerminal).toHaveBeenCalledWith('w2')
  })

  it('collapses to just the new-workspace action when the sidebar is collapsed', () => {
    render(<HubSidebarPanel {...baseProps} expanded={false} />)
    expect(screen.getByTitle('New workspace')).toBeTruthy()
    expect(screen.queryByText('Frontend')).toBeNull()
  })
})
