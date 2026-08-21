import { describe, it, expect } from 'vitest'
import { paneOverlayLabel } from '../../lib/pane-overlay-label'
import { AI_CONFIG } from '../../types'
import type { PaneNode } from '../../types'

function pane(over: Partial<PaneNode>): PaneNode {
  return {
    id: 'p', aiType: 'claude', accountName: '', accountDir: '',
    borderColor: '#123456', cmd: '', ...over,
  } as PaneNode
}

describe('paneOverlayLabel', () => {
  it('editor con archivo abierto → basename del archivo, con fileName para el ícono', () => {
    const info = paneOverlayLabel(pane({ aiType: 'editor', activeEditorTabPath: 'src/tools/generar_sheet.py' }))
    expect(info.text).toBe('generar_sheet.py')
    expect(info.fileName).toBe('generar_sheet.py')
  })

  it('editor sin archivo abierto → cae al label del tipo, sin fileName', () => {
    const info = paneOverlayLabel(pane({ aiType: 'editor' }))
    expect(info.text).toBe('Editor')
    expect(info.fileName).toBeUndefined()
  })

  it('browser con URL → hostname sin el prefijo www', () => {
    const info = paneOverlayLabel(pane({ aiType: 'browser', url: 'https://www.youtube.com/watch?v=x' }))
    expect(info.text).toBe('youtube.com')
    expect(info.fileName).toBeUndefined()
  })

  it('browser con localhost → muestra el host tal cual', () => {
    expect(paneOverlayLabel(pane({ aiType: 'browser', url: 'http://localhost:8000' })).text).toBe('localhost')
  })

  it('browser sin URL navegable (about:blank / undefined) → label del tipo', () => {
    expect(paneOverlayLabel(pane({ aiType: 'browser', url: 'about:blank' })).text).toBe('Browser')
    expect(paneOverlayLabel(pane({ aiType: 'browser', url: undefined })).text).toBe('Browser')
  })

  it('terminal → label del tipo (comportamiento previo intacto), sin fileName', () => {
    const info = paneOverlayLabel(pane({ aiType: 'claude' }))
    expect(info.text).toBe(AI_CONFIG.claude.label)
    expect(info.fileName).toBeUndefined()
  })
})

describe('paneOverlayLabel — rutas de Windows', () => {
  // Bug: usaba split('/') propio en vez del basename de lib/path.ts, que es el
  // que maneja '\'. Con un relPath de Windows el fantasma mostraba la ruta
  // entera en vez del nombre del archivo.
  it('toma el basename de una ruta con backslashes', () => {
    const pane = {
      id: 'p1', aiType: 'editor', accountName: '', accountDir: '', borderColor: '#888', cmd: '',
      activeEditorTabPath: String.raw`src\tools\generar_sheet.py`,
    } as unknown as Parameters<typeof paneOverlayLabel>[0]
    expect(paneOverlayLabel(pane).text).toBe('generar_sheet.py')
  })
})
