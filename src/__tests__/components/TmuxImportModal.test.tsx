import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TmuxImportModal } from '../../components/TmuxImportModal'
import { parseTmuxConf } from '../../lib/tmux/parse'
import { DEFAULT_SETTINGS } from '../../lib/keybindings'

const CONF = [
  'bind h select-pane -L', // maps to prevPane; combo Ctrl+Alt+h conflicts below
  'bind n next-window', // maps to nextTab; free
  'bind Enter copy-mode', // mappable? no -> unsupported bind
  'run-shell "~/x.sh"', // unsupported construct
].join('\n')

function renderModal() {
  const onApply = vi.fn()
  const onClose = vi.fn()
  const current = { ...DEFAULT_SETTINGS.keybindings, globalSearch: 'Ctrl+Alt+h' }
  const plan = parseTmuxConf(CONF, { current })
  render(<TmuxImportModal plan={plan} current={current} onApply={onApply} onClose={onClose} />)
  return { onApply, onClose }
}

describe('TmuxImportModal', () => {
  it('lists the mappable binds and shows unsupported ones separately', () => {
    renderModal()
    expect(screen.getByText('bind n next-window')).toBeTruthy()
    expect(screen.getByText(/copy-mode/)).toBeTruthy()
    expect(screen.getByText(/run-shell/)).toBeTruthy()
  })

  it('applies only the selected, non-conflicting binds on import', () => {
    const { onApply, onClose } = renderModal()
    // prevPane conflicts (globalSearch already uses Ctrl+Alt+h) -> starts off;
    // nextTab is free -> starts on.
    fireEvent.click(screen.getByRole('button', { name: /^import/i }))
    expect(onApply).toHaveBeenCalledWith({ nextTab: 'Ctrl+Alt+n' })
    expect(onClose).toHaveBeenCalled()
  })

  it('cancels without applying', () => {
    const { onApply, onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
