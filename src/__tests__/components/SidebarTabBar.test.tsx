import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SidebarTabBar from '../../components/SidebarTabBar'

describe('SidebarTabBar', () => {
  it('renders the four tabs with the active one marked selected', () => {
    render(<SidebarTabBar active="explorer" onChange={() => {}} />)
    expect(screen.getByRole('tab', { name: /Worktrees/ })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: /Explorer/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Personal/ })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: /Tools/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onChange with the clicked tab id', () => {
    const onChange = vi.fn()
    render(<SidebarTabBar active="worktrees" onChange={onChange} />)
    fireEvent.click(screen.getByRole('tab', { name: /Tools/ }))
    expect(onChange).toHaveBeenCalledWith('tools')
  })

  it('shows a pending-invites badge on the Personal tab when count > 0', () => {
    render(<SidebarTabBar active="worktrees" onChange={() => {}} pendingInvitesCount={3} />)
    expect(screen.getByRole('tab', { name: /Personal/ })).toHaveTextContent('3')
  })

  it('shows no badge on the Personal tab when count is 0', () => {
    render(<SidebarTabBar active="worktrees" onChange={() => {}} pendingInvitesCount={0} />)
    expect(screen.getByRole('tab', { name: /Personal/ })).not.toHaveTextContent(/\d/)
  })
})
