import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import HubSidebarPanel from '../../components/HubSidebarPanel'

const workspaces = [
  { id: 'w1', name: 'Frontend', accentColor: '#0066FF', terminals: [
    { id: 'p1', label: 'Claude', color: '#8B5CF6' },
    { id: 'p2', label: 'API server', color: '#22C55E' },
  ] },
  { id: 'w2', name: 'Backend', terminals: [
    { id: 'p3', label: 'Gemini', color: '#4285F4', hidden: true },
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

describe('HubSidebarPanel', () => {
  it('lists open workspaces and their terminals', () => {
    render(<HubSidebarPanel {...baseProps} />)
    expect(screen.getByText('Frontend')).toBeTruthy()
    expect(screen.getByText('Backend')).toBeTruthy()
    expect(screen.getByText('API server')).toBeTruthy()
    expect(screen.getByText('Gemini')).toBeTruthy()
  })

  it('focuses a terminal in the Hub on click (does not navigate)', () => {
    const onJumpToPane = vi.fn()
    render(<HubSidebarPanel {...baseProps} onJumpToPane={onJumpToPane} />)
    fireEvent.click(screen.getByText('API server'))
    expect(onJumpToPane).toHaveBeenCalledWith('w1', 'p2')
  })

  it('toggles a terminal in/out of the Hub via its checkbox', () => {
    const onToggleTerminal = vi.fn()
    render(<HubSidebarPanel {...baseProps} onToggleTerminal={onToggleTerminal} />)
    fireEvent.click(screen.getByLabelText('Show API server'))
    expect(onToggleTerminal).toHaveBeenCalledWith('p2')
  })

  it('reflects a hidden terminal as unchecked', () => {
    render(<HubSidebarPanel {...baseProps} />)
    expect(screen.getByLabelText('Show Gemini')).not.toBeChecked()
    expect(screen.getByLabelText('Show Claude')).toBeChecked()
  })

  it('toggles a whole workspace in/out of the Hub', () => {
    const onToggleWorkspace = vi.fn()
    render(<HubSidebarPanel {...baseProps} onToggleWorkspace={onToggleWorkspace} />)
    fireEvent.click(screen.getByLabelText('Show all Backend'))
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
