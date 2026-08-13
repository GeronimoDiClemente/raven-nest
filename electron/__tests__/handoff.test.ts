import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeHandoff, readHandoff } from '../integrations/handoff'

const dirs: string[] = []
function tmpWorktree(): string { const d = mkdtempSync(join(tmpdir(), 'handoff-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) { try { rmSync(dirs.pop()!, { recursive: true, force: true }) } catch { /* ignore */ } } })

describe('handoff file', () => {
  it('read returns null when no handoff exists', () => {
    expect(readHandoff(tmpWorktree())).toBeNull()
  })
  it('write then read round-trips, creating .nest/', () => {
    const wt = tmpWorktree()
    writeHandoff(wt, 'Explored auth.ts; the bug is a missing await on line 42.')
    expect(readHandoff(wt)).toBe('Explored auth.ts; the bug is a missing await on line 42.')
  })
  it('second write overwrites the first', () => {
    const wt = tmpWorktree()
    writeHandoff(wt, 'first summary')
    writeHandoff(wt, 'second summary')
    expect(readHandoff(wt)).toBe('second summary')
  })
})
