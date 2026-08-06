import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OrchestrationBoard } from '../../components/OrchestrationBoard'

const rows = [
  {
    key: '#189', title: 'Race board', url: '', providerId: 'x', pluginId: 'github', ticketState: 'in_review',
    status: 'needs_you', branch: 'gero/189-race', worktreePath: '/r', repoFullName: 'RAVEN/x',
    scope: { kind: 'org', org: 'RAVEN' }, ci: 'success', changesRequested: true, prNumber: 1,
  },
  {
    key: '#221', title: 'Design import', url: '', providerId: 'y', pluginId: 'github', ticketState: 'todo',
    status: 'todo', branch: null, worktreePath: null, repoFullName: null,
    scope: { kind: 'personal' }, ci: null, changesRequested: false, prNumber: null,
  },
] as any

describe('<OrchestrationBoard>', () => {
  it('renders each row with title, key, status label, branch, org scope, and source name', () => {
    render(<OrchestrationBoard rows={rows} />)

    expect(screen.getByText('Race board')).toBeInTheDocument()
    expect(screen.getByText('Design import')).toBeInTheDocument()
    expect(screen.getByText('#189')).toBeInTheDocument()
    expect(screen.getByText('#221')).toBeInTheDocument()
    expect(screen.getByText('Needs You')).toBeInTheDocument()
    expect(screen.getByText('To do')).toBeInTheDocument()
    expect(screen.getByText('gero/189-race')).toBeInTheDocument()
    expect(screen.getByText('RAVEN')).toBeInTheDocument()
    expect(screen.getAllByText('GitHub').length).toBeGreaterThan(0)
  })

  it('shows an empty state when there are no rows', () => {
    render(<OrchestrationBoard rows={[]} />)
    expect(screen.getByText(/connect a source/i)).toBeInTheDocument()
  })

  it('calls onOpen with the clicked row', () => {
    const onOpen = vi.fn()
    render(<OrchestrationBoard rows={rows} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('Race board'))
    expect(onOpen).toHaveBeenCalledWith(rows[0])
  })
})
