import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ScopeSelector from '../../components/ScopeSelector'
import type { Team } from '../../hooks/useTeam'

const team = (id: string, name: string): Team => ({ id, name, owner_id: 'u1', created_at: '' })
const noop = () => {}

describe('ScopeSelector', () => {
  it('renders nothing when the plan has no teams feature', () => {
    const { container } = render(
      <ScopeSelector scope={{ kind: 'personal' }} teams={[team('t1', 'Nest')]} allowTeam={false}
        onScopeChange={noop} onOpenTeamWorkspace={noop} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the user belongs to no team', () => {
    const { container } = render(
      <ScopeSelector scope={{ kind: 'personal' }} teams={[]} allowTeam
        onScopeChange={noop} onOpenTeamWorkspace={noop} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('lists Personal plus every team', () => {
    render(
      <ScopeSelector scope={{ kind: 'personal' }} teams={[team('t1', 'Nest'), team('t2', 'STI')]} allowTeam
        onScopeChange={noop} onOpenTeamWorkspace={noop} />,
    )
    expect(screen.getByRole('button', { name: 'Personal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nest' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'STI' })).toBeInTheDocument()
  })

  it('reports the picked scope', () => {
    const onScopeChange = vi.fn()
    render(
      <ScopeSelector scope={{ kind: 'personal' }} teams={[team('t1', 'Nest')]} allowTeam
        onScopeChange={onScopeChange} onOpenTeamWorkspace={noop} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Nest' }))
    expect(onScopeChange).toHaveBeenCalledWith({ kind: 'team', teamId: 't1' })
  })

  // The team workspace lost its sidebar door; this button is the only way in.
  it('offers the team workspace only while a team scope is active', () => {
    const { rerender } = render(
      <ScopeSelector scope={{ kind: 'personal' }} teams={[team('t1', 'Nest')]} allowTeam
        onScopeChange={noop} onOpenTeamWorkspace={noop} />,
    )
    expect(screen.queryByRole('button', { name: /team workspace/i })).not.toBeInTheDocument()
    rerender(
      <ScopeSelector scope={{ kind: 'team', teamId: 't1' }} teams={[team('t1', 'Nest')]} allowTeam
        onScopeChange={noop} onOpenTeamWorkspace={noop} />,
    )
    expect(screen.getByRole('button', { name: /team workspace/i })).toBeInTheDocument()
  })
})
