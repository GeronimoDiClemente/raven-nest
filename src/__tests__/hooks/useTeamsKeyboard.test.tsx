// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTeamsKeyboard } from '../../hooks/useTeamsKeyboard'
import type { WorkspaceSection } from '../../components/TeamsWorkspace'

function pressChord(second: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: second }))
}

describe('useTeamsKeyboard g-chord mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('jumps to a section that still exists in TeamsWorkspace (g m -> members)', () => {
    const onSectionChange = vi.fn()
    renderHook(() => useTeamsKeyboard({
      onClose: vi.fn(),
      onSectionChange,
      currentSection: 'chat' as WorkspaceSection,
    }))

    pressChord('m')

    expect(onSectionChange).toHaveBeenCalledWith('members')
  })

  it('does not dispatch for the removed Repos/Issues/Activity chords', () => {
    const onSectionChange = vi.fn()
    renderHook(() => useTeamsKeyboard({
      onClose: vi.fn(),
      onSectionChange,
      currentSection: 'chat' as WorkspaceSection,
    }))

    pressChord('r')
    pressChord('i')
    pressChord('a')

    expect(onSectionChange).not.toHaveBeenCalled()
  })
})
