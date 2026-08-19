import { describe, it, expect } from 'vitest'
import { modelPathFor } from '../../lib/editor-model-path'

// Los modelos de Monaco son GLOBALES y se keyean por el prop `path` del
// wrapper. Con el relPath pelado, dos panes sobre worktrees distintos con el
// mismo archivo compartían UN modelo: el contenido de uno pisaba al otro y
// Ctrl+S clobbereaba el archivo equivocado (finding crítico #1, 2026-08-18).
describe('modelPathFor', () => {
  it('gives DIFFERENT model paths to the same relPath in different worktrees', () => {
    const a = modelPathFor('C:\\repos\\main', 'src/App.tsx')
    const b = modelPathFor('C:\\repos\\main-wt-feature', 'src/App.tsx')
    expect(a).not.toBe(b)
  })

  it('is stable for the same worktree+relPath (dos panes comparten documento)', () => {
    expect(modelPathFor('/wt', 'a.ts')).toBe(modelPathFor('/wt', 'a.ts'))
  })

  it('keeps the file extension at the end (Monaco infiere lenguaje por extensión)', () => {
    expect(modelPathFor('/wt', 'src/utils.ts')).toMatch(/\.ts$/)
    expect(modelPathFor('/wt', 'src/utils.ts')).toMatch(/\/src\/utils\.ts$/)
  })

  it('produces URI-safe paths (sin ":" ni "\\" que Uri.parse malinterprete)', () => {
    const p = modelPathFor('C:\\Users\\x\\repo', 'src/a.ts')
    expect(p).not.toMatch(/[:\\]/)
  })

  it('collapses the two Windows forms of the same worktree into ONE model', () => {
    // git worktree list entrega C:/dev/repo (POSIX) y dialog/clone C:\dev\repo
    // (nativo) — es el MISMO worktree físico. Dos tokens distintos = dos
    // buffers Monaco divergentes del mismo archivo y el último Ctrl+S pisa
    // al otro.
    expect(modelPathFor('C:\\dev\\repo', 'src/a.ts')).toBe(modelPathFor('C:/dev/repo', 'src/a.ts'))
  })

  it('distinguishes root-level foo.ts from nested src/foo.ts in the SAME worktree', () => {
    // El matching viejo por sufijo endsWith('/foo.ts') confundía estos dos
    // (finding crítico #3): el path calificado exacto no puede.
    expect(modelPathFor('/wt', 'foo.ts')).not.toBe(modelPathFor('/wt', 'src/foo.ts'))
  })
})
