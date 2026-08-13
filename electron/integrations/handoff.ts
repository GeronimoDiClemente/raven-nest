import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

function handoffPath(worktreePath: string): string {
  return join(worktreePath, '.nest', 'handoff.md')
}

/** Read the current handoff summary for a worktree, or null if none written yet. */
export function readHandoff(worktreePath: string): string | null {
  try { return readFileSync(handoffPath(worktreePath), 'utf8') } catch { return null }
}

/** Write/overwrite the handoff summary. Creates .nest/ if missing (same as
 *  startWorkOnWorktree's TASK.md write). Best-effort: a disk failure warns
 *  instead of throwing into the IPC caller. */
export function writeHandoff(worktreePath: string, content: string): void {
  try {
    mkdirSync(join(worktreePath, '.nest'), { recursive: true })
    writeFileSync(handoffPath(worktreePath), content)
  } catch (err) {
    console.warn('[handoff] write failed', err)
  }
}
