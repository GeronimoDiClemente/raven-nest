import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import HubWorkspace from '../../components/HubWorkspace'
import type { PaneNode } from '../../types'

const pane = (id: string): PaneNode => ({
  id, aiType: 'terminal', accountName: '', accountDir: '', borderColor: '#888', cmd: '',
})

const baseProps = {
  splitRatios: {},
  hiddenCount: 0,
  onResize: () => {},
  onDragStart: () => {},
  onDragEnd: () => {},
  draggingId: null,
  sensors: [],
  renderPane: (p: PaneNode) => <div data-testid={`pane-${p.id}`}>{p.id}</div>,
}

describe('HubWorkspace (curated workspace view)', () => {
  it('renders the curated panes through the normal layout engine', () => {
    render(<HubWorkspace {...baseProps} panes={[pane('a'), pane('b')]} layoutId="2V" />)
    expect(screen.getByTestId('pane-a')).toBeTruthy()
    expect(screen.getByTestId('pane-b')).toBeTruthy()
  })

  it('shows an empty state prompting to pin terminals when nothing is curated', () => {
    render(<HubWorkspace {...baseProps} panes={[]} layoutId="1" />)
    expect(screen.getByText(/your hub is empty/i)).toBeTruthy()
    expect(screen.getByText(/pin the terminals you use most/i)).toBeTruthy()
  })

  it('notes when more terminals are pinned than the 12-pane cap shows', () => {
    render(<HubWorkspace {...baseProps} panes={[pane('a')]} layoutId="1" hiddenCount={3} />)
    expect(screen.getByText(/\+3 more pinned/i)).toBeTruthy()
  })
})
