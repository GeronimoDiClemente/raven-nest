// workspace-shell-design §2: "un contador se muestra solo si el dato ya
// esta disponible sin un fetch nuevo... y nunca cero, que seria mentira."
// This is the shared row both TeamsWorkspace and PersonalWorkspace render
// their nav items through — these tests pin the one behavior that rule
// depends on: omitting `count` renders nothing, not a zero.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import WorkspaceNavButton from '../../components/WorkspaceNavButton'

describe('WorkspaceNavButton', () => {
  it('renders no trailing badge when neither count nor dotStatus is given', () => {
    render(<WorkspaceNavButton icon={<svg />} label="Chat" active={false} onClick={vi.fn()} />)
    const btn = screen.getByRole('button', { name: 'Chat' })
    expect(btn.querySelector('.tw-nav-trailing')).toBeNull()
    expect(btn.textContent).not.toMatch(/0/)
  })

  it('never renders a bare "0" as a stand-in for absent data — count must be passed explicitly', () => {
    // Absence is the contract: a caller that hasn't fetched yet must pass
    // `undefined`, never coerce a missing value to 0.
    render(<WorkspaceNavButton icon={<svg />} label="Snippets" active={false} onClick={vi.fn()} count={undefined} />)
    expect(screen.getByRole('button', { name: 'Snippets' }).querySelector('.tw-nav-count')).toBeNull()
  })

  it('renders a real zero when the caller explicitly passes one (a real 0 is not a lie)', () => {
    render(<WorkspaceNavButton icon={<svg />} label="Invites" active={false} onClick={vi.fn()} count={0} />)
    expect(screen.getByRole('button', { name: 'Invites' }).querySelector('.tw-nav-count')?.textContent).toBe('0')
  })

  it('renders the count in a mono/tabular-nums badge without changing the accessible name', () => {
    render(<WorkspaceNavButton icon={<svg />} label="Members" active={false} onClick={vi.fn()} count={3} />)
    // Exact-name match must still resolve — the badge is aria-hidden.
    const btn = screen.getByRole('button', { name: 'Members' })
    expect(btn.querySelector('.tw-nav-count')?.textContent).toBe('3')
    expect(btn.querySelector('.tw-nav-trailing')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('renders a status dot with the given token modifier', () => {
    render(<WorkspaceNavButton icon={<svg />} label="Members" active={false} onClick={vi.fn()} dotStatus="warn" />)
    expect(screen.getByRole('button', { name: 'Members' }).querySelector('.tw-nav-dot--warn')).not.toBeNull()
  })

  it('renders both a count and a dot together when both are given', () => {
    render(<WorkspaceNavButton icon={<svg />} label="Members" active={false} onClick={vi.fn()} count={5} dotStatus="warn" />)
    const btn = screen.getByRole('button', { name: 'Members' })
    expect(btn.querySelector('.tw-nav-count')?.textContent).toBe('5')
    expect(btn.querySelector('.tw-nav-dot--warn')).not.toBeNull()
  })

  it('marks the row active and fires onClick', () => {
    const onClick = vi.fn()
    render(<WorkspaceNavButton icon={<svg />} label="Chat" active onClick={onClick} />)
    const btn = screen.getByRole('button', { name: 'Chat' })
    expect(btn.className).toContain('active')
    btn.click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
