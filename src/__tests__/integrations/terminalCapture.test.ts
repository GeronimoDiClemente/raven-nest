// src/__tests__/integrations/terminalCapture.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Terminal } from '@xterm/xterm'

const registry = new Map<string, Terminal>()
vi.mock('../../terminal-instances', () => ({
  getTerminal: (paneId: string) => registry.get(paneId),
}))

import { captureTerminalOutput } from '../../integrations/terminalCapture'

// Fake mínimo del buffer API de xterm: solo lo que usa captureTerminalOutput
// (type, baseY, cursorY, getLine().translateToString(true)).
function makeFakeTerminal(rows: string[], opts: { baseY?: number; cursorY?: number; type?: 'normal' | 'alternate' } = {}): Terminal {
  const { baseY = 0, cursorY = rows.length - 1, type = 'normal' } = opts
  return {
    buffer: {
      active: {
        type,
        baseY,
        cursorY,
        getLine: (y: number) => {
          if (y < 0 || y >= rows.length) return undefined
          return { translateToString: () => rows[y] }
        },
      },
    },
  } as unknown as Terminal
}

describe('captureTerminalOutput', () => {
  beforeEach(() => { registry.clear() })

  it('devuelve "" si no hay paneId', () => {
    expect(captureTerminalOutput(null)).toBe('')
  })

  it('devuelve "" si no hay terminal registrado para el pane', () => {
    expect(captureTerminalOutput('pane-1')).toBe('')
  })

  it('devuelve "" si el buffer activo es alternate (vim/less/fzf)', () => {
    registry.set('pane-1', makeFakeTerminal(['irrelevant'], { type: 'alternate' }))
    expect(captureTerminalOutput('pane-1')).toBe('')
  })

  it('lee desde el cursor hacia arriba, saltea líneas vacías finales y devuelve el orden original', () => {
    const rows = [
      '$ echo start',
      'start',
      '$ run something long output line 1',
      'output line 1',
      'output line 2',
      '',
      '',
    ]
    registry.set('pane-1', makeFakeTerminal(rows, { baseY: 0, cursorY: rows.length - 1 }))
    expect(captureTerminalOutput('pane-1')).toBe(
      '$ echo start\nstart\n$ run something long output line 1\noutput line 1\noutput line 2',
    )
  })

  it('respeta maxLines devolviendo solo las últimas N líneas no vacías', () => {
    const rows = [
      '$ echo start',
      'start',
      '$ run something long output line 1',
      'output line 1',
      'output line 2',
      '',
      '',
    ]
    registry.set('pane-1', makeFakeTerminal(rows, { baseY: 0, cursorY: rows.length - 1 }))
    expect(captureTerminalOutput('pane-1', 2)).toBe('output line 1\noutput line 2')
  })

  it('funciona con scrollback (baseY > 0)', () => {
    const rows = ['old line 0', 'old line 1', 'current prompt line']
    // baseY=1 simula que la línea 0 salió de la ventana visible; el cursor
    // está en la fila visible 1, que corresponde a la línea absoluta 2.
    registry.set('pane-1', makeFakeTerminal(rows, { baseY: 1, cursorY: 1 }))
    expect(captureTerminalOutput('pane-1')).toBe('old line 0\nold line 1\ncurrent prompt line')
  })
})
