import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SidebarTabBar from '../../components/SidebarTabBar'

describe('SidebarTabBar', () => {
  it('renders the three tabs with the active one marked selected', () => {
    render(<SidebarTabBar active="explorer" onChange={() => {}} />)
    expect(screen.getByRole('tab', { name: /Worktrees/ })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: /Explorer/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Tools/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onChange with the clicked tab id', () => {
    const onChange = vi.fn()
    render(<SidebarTabBar active="worktrees" onChange={onChange} />)
    fireEvent.click(screen.getByRole('tab', { name: /Tools/ }))
    expect(onChange).toHaveBeenCalledWith('tools')
  })

  it('renders only the tabs it is given (Hub mode has no Worktrees)', () => {
    render(<SidebarTabBar tabs={['hub', 'explorer', 'tools']} active="hub" onChange={() => {}} />)
    expect(screen.getByRole('tab', { name: /Hub/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Explorer/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Tools/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Worktrees/ })).not.toBeInTheDocument()
  })

  it('renders the footer below the tabs inside the same menu box', () => {
    const { container } = render(
      <SidebarTabBar active="worktrees" onChange={() => {}} footer={<span>my-repo</span>} />,
    )
    const box = container.querySelector('.sidebar-menu-box')
    expect(box).not.toBeNull()
    expect(box).toHaveTextContent('my-repo')
    // Tabs first, repo row under them, one box: above the tabs it still read
    // as a separate block sitting on top of the menu.
    expect(box!.querySelector('.sidebar-tabbar')).not.toBeNull()
  })
})
