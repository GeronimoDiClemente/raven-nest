import { describe, it, expect, beforeEach } from 'vitest'
import { stashTabBuffer, takeTabBuffer, dropTabBuffer, __resetHandoffForTests } from '../../lib/editor-buffer-handoff'

// Mover una tab entre panes (botón o drag & drop) tiene que PRESERVAR el
// buffer sin guardar: contents es estado interno de cada EditorPane y no
// viaja con la tab. El pane origen deja el buffer acá al iniciar la mudanza
// y el pane destino lo consume en su carga, en vez de leer el disco.
describe('editor-buffer-handoff', () => {
  beforeEach(() => __resetHandoffForTests())

  it('hands a stashed buffer to exactly one taker', () => {
    stashTabBuffer('/wt', 'src/a.ts', { content: 'editado', eol: '\n', dirty: true })
    expect(takeTabBuffer('/wt', 'src/a.ts')).toEqual({ content: 'editado', eol: '\n', dirty: true })
    // consumido: una segunda toma no debe resucitar el buffer viejo
    expect(takeTabBuffer('/wt', 'src/a.ts')).toBeUndefined()
  })

  it('keys by worktree AND relPath — same file in another worktree is another buffer', () => {
    stashTabBuffer('/wt-a', 'src/a.ts', { content: 'de wt-a', eol: '\n', dirty: true })
    expect(takeTabBuffer('/wt-b', 'src/a.ts')).toBeUndefined()
    expect(takeTabBuffer('/wt-a', 'src/a.ts')?.content).toBe('de wt-a')
  })

  it('hands off across the two Windows forms of the same worktree', () => {
    // El pane origen puede tener el repoPath nativo (C:\, de local-paths) y
    // el destino la forma POSIX (C:/, de worktree-store). Si la key no los
    // colapsa, el buffer dirty no se consume y el edit se pierde al mover.
    stashTabBuffer('C:\\dev\\repo', 'src/a.ts', { content: 'editado', eol: '\r\n', dirty: true })
    expect(takeTabBuffer('C:/dev/repo', 'src/a.ts')?.content).toBe('editado')
  })

  it('drop discards a stash that never got consumed (drag cancelado)', () => {
    stashTabBuffer('/wt', 'src/a.ts', { content: 'x', eol: '\r\n', dirty: false })
    dropTabBuffer('/wt', 'src/a.ts')
    expect(takeTabBuffer('/wt', 'src/a.ts')).toBeUndefined()
  })
})
