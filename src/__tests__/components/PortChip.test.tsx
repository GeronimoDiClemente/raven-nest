import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PortChip } from '../../components/PortChip'

describe('<PortChip>', () => {
  beforeEach(() => {
    ;(window as unknown as { electronShell?: { openExternal: (url: string) => void } }).electronShell = {
      openExternal: vi.fn(),
    }
  })

  it('renders the port number and arrow', () => {
    render(<PortChip port={3000} />)
    const btn = screen.getByRole('button')
    expect(btn).toHaveTextContent(':3000')
    expect(btn).toHaveTextContent('↗')
  })

  it('on plain click dispatches nest:pty-url with the localhost url', () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    render(<PortChip port={4000} paneId="pane-1" />)
    fireEvent.click(screen.getByRole('button'))
    const matchingCalls = dispatch.mock.calls.filter(c => (c[0] as Event).type === 'nest:pty-url')
    expect(matchingCalls.length).toBe(1)
    const ev = matchingCalls[0]![0] as CustomEvent
    expect(ev.detail).toEqual({ paneId: 'pane-1', url: 'http://localhost:4000' })
    dispatch.mockRestore()
  })

  it('on Shift+click opens externally instead of dispatching', () => {
    const openExternal = (window as unknown as { electronShell: { openExternal: ReturnType<typeof vi.fn> } }).electronShell.openExternal
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    render(<PortChip port={5173} paneId="pane-2" />)
    fireEvent.click(screen.getByRole('button'), { shiftKey: true })
    expect(openExternal).toHaveBeenCalledWith('http://localhost:5173')
    const ptyUrlCalls = dispatch.mock.calls.filter(c => (c[0] as Event).type === 'nest:pty-url')
    expect(ptyUrlCalls.length).toBe(0)
    dispatch.mockRestore()
  })
})
