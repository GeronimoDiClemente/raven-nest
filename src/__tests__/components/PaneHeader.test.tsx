import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PaneHeader from '../../components/PaneHeader'
import type { PaneNode } from '../../types'

const basePane: PaneNode = {
  id: 'p1', aiType: 'claude', accountName: 'work', accountDir: '', borderColor: '#8B5CF6', cmd: '',
}

const baseProps = {
  zoomed: false,
  onZoom: () => {},
  onClose: () => {},
  onColorChange: () => {},
  onNoteChange: () => {},
}

describe('PaneHeader rename', () => {
  it('shows the custom label as text on an AI pane (logo alone is not distinguishable)', () => {
    render(<PaneHeader {...baseProps} pane={{ ...basePane, customLabel: 'API server' }} onRename={() => {}} />)
    expect(screen.getByText('API server')).toBeTruthy()
  })

  it('renames via double-click → type → Enter, trimming the value', () => {
    const onRename = vi.fn()
    render(<PaneHeader {...baseProps} pane={basePane} onRename={onRename} />)
    fireEvent.doubleClick(screen.getByTitle(/rename/i))
    const input = screen.getByPlaceholderText(/rename/i)
    fireEvent.change(input, { target: { value: '  DB pane  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('DB pane')
  })

  it('does not offer rename when onRename is not provided', () => {
    render(<PaneHeader {...baseProps} pane={basePane} />)
    expect(screen.queryByTitle(/rename/i)).toBeNull()
  })
})
