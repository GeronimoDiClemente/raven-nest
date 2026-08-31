import { describe, it, expect } from 'vitest'
import { shouldConfirmTabClose } from '../../lib/tab-close'

describe('shouldConfirmTabClose', () => {
  it('confirms when the workspace has terminals of its own', () => {
    expect(shouldConfirmTabClose({ panes: [{}, {}] })).toBe(true)
  })

  it('does not confirm an empty workspace (nothing to lose)', () => {
    expect(shouldConfirmTabClose({ panes: [] })).toBe(false)
  })

  it('confirms closing the Hub when it has pinned terminals, even though its own panes are empty', () => {
    // The Hub owns no panes (panes: []); its content is the curated hubPanes set.
    // Closing it discards that curation, so it must still confirm.
    expect(shouldConfirmTabClose({ panes: [], isHub: true, hubPanes: ['a', 'b'] })).toBe(true)
  })

  it('does not confirm an empty Hub with no pins', () => {
    expect(shouldConfirmTabClose({ panes: [], isHub: true, hubPanes: [] })).toBe(false)
  })
})
