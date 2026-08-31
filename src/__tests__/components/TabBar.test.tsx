import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

describe('TabBar', () => {
  it('renders every workspace tab (they compress to stay visible, no overflow menu)', () => {
    const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']
    render(<TabBar {...baseProps} tabs={makeTabs(names)} activeTabId="t0" />)
    for (const name of names) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    // No overflow dropdown — tabs shrink to fit instead of hiding behind a menu.
    expect(screen.queryByTitle(/all workspaces/i)).toBeNull()
  })

  it('selects a workspace by clicking its tab', () => {
    const onTabSelect = vi.fn()
    render(<TabBar {...baseProps} onTabSelect={onTabSelect} tabs={makeTabs(['Alpha', 'Beta'])} activeTabId="t0" />)
    fireEvent.click(screen.getByText('Beta'))
    expect(onTabSelect).toHaveBeenCalledWith('t1')
  })
})
