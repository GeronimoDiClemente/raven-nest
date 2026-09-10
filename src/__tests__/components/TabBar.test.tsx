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

  // Estos dos, agregados en la migración a shadcn (Task 5): el cierre y el
  // "+" eran un <button> a mano sin nombre accesible propio (title, no
  // aria-label) — ahora son <Button> con aria-label, así que se buscan por
  // rol y nombre en vez de por clase, y sobreviven al próximo cambio de CSS.
  it('closes a workspace by clicking its close button, without selecting it', () => {
    const onTabClose = vi.fn()
    const onTabSelect = vi.fn()
    render(
      <TabBar
        {...baseProps}
        onTabClose={onTabClose}
        onTabSelect={onTabSelect}
        tabs={makeTabs(['Alpha', 'Beta'])}
        activeTabId="t0"
      />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: /close workspace/i })[1])
    expect(onTabClose).toHaveBeenCalledWith('t1')
    expect(onTabSelect).not.toHaveBeenCalled()
  })

  it('creates a new workspace by clicking the new-tab button', () => {
    const onTabNew = vi.fn()
    render(<TabBar {...baseProps} onTabNew={onTabNew} tabs={makeTabs(['Alpha'])} activeTabId="t0" />)
    fireEvent.click(screen.getByRole('button', { name: /new workspace/i }))
    expect(onTabNew).toHaveBeenCalled()
  })
})
