import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import TabBar from '../../components/TabBar'
import type { WorkspaceTab } from '../../types'

const makeTabs = (names: string[]): WorkspaceTab[] =>
  names.map((name, i) => ({ id: `t${i}`, name, layoutId: '1', panes: [] }))

const baseProps = {
  onTabSelect: () => {},
  onTabClose: () => {},
  onTabNew: () => {},
  onTabRename: () => {},
  onTabReorder: () => {},
  isWin: true,
}

describe('TabBar overflow menu', () => {
  it('opens a menu listing every workspace so far-right tabs stay reachable', () => {
    const tabs = makeTabs(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'])
    render(<TabBar {...baseProps} tabs={tabs} activeTabId="t0" />)
    fireEvent.click(screen.getByTitle(/all workspaces/i))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('Zeta')).toBeTruthy()
    expect(within(menu).getByText('Epsilon')).toBeTruthy()
  })

  it('selects a workspace from the overflow menu', () => {
    const onTabSelect = vi.fn()
    const tabs = makeTabs(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'])
    render(<TabBar {...baseProps} onTabSelect={onTabSelect} tabs={tabs} activeTabId="t0" />)
    fireEvent.click(screen.getByTitle(/all workspaces/i))
    fireEvent.click(within(screen.getByRole('menu')).getByText('Zeta'))
    expect(onTabSelect).toHaveBeenCalledWith('t5')
  })
})
