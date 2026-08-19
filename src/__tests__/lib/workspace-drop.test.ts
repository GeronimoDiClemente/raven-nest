import { describe, it, expect } from 'vitest'
import { WORKTREE_DRAG_MIME, FILE_DRAG_MIME, EDITOR_TAB_DRAG_MIME, workspaceAcceptsDrag, workspaceDropAction, workspaceDropEffect, decodeFileDrag } from '../../lib/dragTypes'

function fakeDataTransfer(data: Record<string, string>) {
  return {
    types: Object.keys(data),
    getData: (type: string) => data[type] ?? '',
  }
}

describe('workspaceAcceptsDrag', () => {
  it('accepts a worktree drag', () => {
    expect(workspaceAcceptsDrag([WORKTREE_DRAG_MIME])).toBe(true)
  })

  it('accepts an Explorer file drag', () => {
    expect(workspaceAcceptsDrag([FILE_DRAG_MIME])).toBe(true)
  })

  it('accepts an editor tab drag (soltarla en el fondo = pane nuevo)', () => {
    expect(workspaceAcceptsDrag([EDITOR_TAB_DRAG_MIME])).toBe(true)
  })

  it('rejects foreign drags (OS files, text)', () => {
    expect(workspaceAcceptsDrag(['Files'])).toBe(false)
    expect(workspaceAcceptsDrag(['text/plain'])).toBe(false)
    expect(workspaceAcceptsDrag([])).toBe(false)
  })
})

// El dropEffect del target DEBE matchear el effectAllowed del origen o
// Chromium INVALIDA el drop en silencio (gotcha documentado, ya nos mordió
// dos veces): las tabs arrastran con 'move', el resto con 'copy'. El
// dragover del workspace burbujea DESPUÉS del pane y pisa su dropEffect —
// setear 'copy' fijo mataba la mudanza de tabs entre panes.
describe('workspaceDropEffect', () => {
  it("is 'move' for editor tab drags", () => {
    expect(workspaceDropEffect([EDITOR_TAB_DRAG_MIME])).toBe('move')
  })

  it("is 'copy' for file and worktree drags", () => {
    expect(workspaceDropEffect([FILE_DRAG_MIME])).toBe('copy')
    expect(workspaceDropEffect([WORKTREE_DRAG_MIME])).toBe('copy')
  })
})

describe('workspaceDropAction', () => {
  it('maps a worktree payload to a worktree action', () => {
    const dt = fakeDataTransfer({ [WORKTREE_DRAG_MIME]: '/repos/nest' })
    expect(workspaceDropAction(dt)).toEqual({ kind: 'worktree', path: '/repos/nest' })
  })

  it('maps an Explorer file payload to a file action', () => {
    const dt = fakeDataTransfer({
      [FILE_DRAG_MIME]: JSON.stringify({ relPath: 'src/App.tsx', worktreePath: '/repos/nest' }),
    })
    expect(workspaceDropAction(dt)).toEqual({ kind: 'file', relPath: 'src/App.tsx', worktreePath: '/repos/nest' })
  })

  it('returns null for malformed file JSON', () => {
    const dt = fakeDataTransfer({ [FILE_DRAG_MIME]: 'no-es-json{' })
    expect(workspaceDropAction(dt)).toBeNull()
  })

  // El payload es la autoridad sobre el worktree: sin worktreePath no hay
  // forma segura de saber QUÉ archivo es — mejor no abrir nada que abrir
  // el relPath contra el worktree activo equivocado.
  it('returns null when the file payload lacks relPath or worktreePath', () => {
    const sinWorktree = fakeDataTransfer({ [FILE_DRAG_MIME]: JSON.stringify({ relPath: 'a.ts' }) })
    expect(workspaceDropAction(sinWorktree)).toBeNull()
    const sinRelPath = fakeDataTransfer({ [FILE_DRAG_MIME]: JSON.stringify({ worktreePath: '/repos/nest' }) })
    expect(workspaceDropAction(sinRelPath)).toBeNull()
  })

  it('returns null when no known payload is present', () => {
    expect(workspaceDropAction(fakeDataTransfer({ 'text/plain': 'x' }))).toBeNull()
  })

  // Una tab de editor soltada en el fondo (o rechazada por un pane
  // cross-worktree que la deja burbujear) se mueve a un pane NUEVO — sin
  // esto el gesto se perdía en silencio: el workspace no entendía el MIME.
  it('maps an editor tab payload to an editorTab action', () => {
    const dt = fakeDataTransfer({
      [EDITOR_TAB_DRAG_MIME]: JSON.stringify({ sourcePaneId: 'p1', relPath: 'a.ts', dirty: true, worktreePath: '/wt' }),
    })
    expect(workspaceDropAction(dt)).toEqual({ kind: 'editorTab', sourcePaneId: 'p1', relPath: 'a.ts' })
  })

  it('rejects malformed or incomplete editor tab payloads', () => {
    expect(workspaceDropAction(fakeDataTransfer({ [EDITOR_TAB_DRAG_MIME]: '{roto' }))).toBeNull()
    expect(workspaceDropAction(fakeDataTransfer({ [EDITOR_TAB_DRAG_MIME]: JSON.stringify({ relPath: 'a.ts' }) }))).toBeNull()
  })
})

// Decoder ÚNICO del wire format del drag de archivos: EditorPane y el
// workspace decodifican el mismo MIME — dos decoders a mano divergen
// ("anda en el fondo, rompe en el pane").
describe('decodeFileDrag', () => {
  it('decodes a valid payload', () => {
    expect(decodeFileDrag(JSON.stringify({ relPath: 'a.ts', worktreePath: '/wt' })))
      .toEqual({ relPath: 'a.ts', worktreePath: '/wt' })
  })

  it('rejects empty relPath / worktreePath and malformed JSON', () => {
    expect(decodeFileDrag(JSON.stringify({ relPath: '', worktreePath: '/wt' }))).toBeNull()
    expect(decodeFileDrag(JSON.stringify({ relPath: 'a.ts' }))).toBeNull()
    expect(decodeFileDrag('{roto')).toBeNull()
  })
})
