import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IntegrationsRail } from '../../components/IntegrationsRail'

const rows = [
  {
    key: '#189', title: 'Race board', url: '', providerId: 'x', pluginId: 'github', ticketState: 'in_review',
    status: 'needs_you', branch: 'gero/189-race', worktreePath: '/r', repoFullName: 'RAVEN/x',
    scope: { kind: 'org', org: 'RAVEN' }, ci: 'success', changesRequested: true, prNumber: 1,
  },
  {
    key: '#221', title: 'Design import', url: '', providerId: 'y', pluginId: 'github', ticketState: 'in_progress',
    status: 'working', branch: 'gero/221-design', worktreePath: '/r2', repoFullName: 'RAVEN/x',
    scope: { kind: 'org', org: 'RAVEN' }, ci: null, changesRequested: false, prNumber: null,
  },
] as any

describe('<IntegrationsRail>', () => {
  it('shows the bot widget, the needs-you row with its count, and the activity placeholder', () => {
    render(<IntegrationsRail rows={rows} />)

    expect(screen.getByText('@Nest')).toBeInTheDocument()
    expect(screen.getByText(/Race board/)).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Activity will appear here.')).toBeInTheDocument()
  })

  it('does not list the working row under needs you', () => {
    render(<IntegrationsRail rows={rows} />)
    expect(screen.queryByText(/Design import/)).not.toBeInTheDocument()
  })

  it('calls onOpenRow with the clicked needs-you row', () => {
    const onOpenRow = vi.fn()
    render(<IntegrationsRail rows={rows} onOpenRow={onOpenRow} />)
    fireEvent.click(screen.getByText(/Race board/))
    expect(onOpenRow).toHaveBeenCalledWith(rows[0])
  })

  it('calls onOpenRow when Enter is pressed on the needs-you row', () => {
    const onOpenRow = vi.fn()
    render(<IntegrationsRail rows={rows} onOpenRow={onOpenRow} />)
    fireEvent.keyDown(screen.getByText(/Race board/).closest('[role="button"]')!, { key: 'Enter' })
    expect(onOpenRow).toHaveBeenCalledWith(rows[0])
  })
})
