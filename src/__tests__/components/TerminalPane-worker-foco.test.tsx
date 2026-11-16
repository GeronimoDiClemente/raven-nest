// TerminalPane le pide a useXterm no tomar el foco al montar sólo si el pane es un worker.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { PaneNode } from '../../types'
import { TEMA_NEST } from '../../lib/terminal-themes'

const h = vi.hoisted(() => ({ opciones: [] as unknown[] }))
vi.mock('../../hooks/useXterm', () => ({
  useXterm: (...args: unknown[]) => {
    h.opciones.push(args[7])
    return {
      containerRef: { current: null }, write: () => {}, focus: () => {}, resize: () => {},
      findNext: () => {}, findPrev: () => {}, clearSearch: () => {}, temaActivo: TEMA_NEST,
    }
  },
}))
vi.mock('@dnd-kit/sortable', () => ({ useSortable: () => ({ setNodeRef: () => {}, attributes: {}, listeners: {}, isOver: false }) }))
vi.mock('../../hooks/useTerminalShare', () => ({ useTerminalShare: () => ({ shareCode: null, isSharing: false, startSharing: () => {}, stopSharing: () => {} }) }))

import TerminalPane from '../../components/TerminalPane'

const base: PaneNode = { id: 'p', aiType: 'claude', accountName: 'a', accountDir: '/acc/claude/a', borderColor: '#fff', cmd: 'claude' }

function montar(pane: PaneNode) {
  render(
    <TerminalPane pane={pane} isDragging={false} zoomed={false} zoomingOut={false} onZoom={() => {}} onClose={() => {}}
      onColorChange={() => {}} onNoteChange={() => {}} onInput={() => {}} onBusyChange={() => {}} onFocus={() => {}} fontSize={13} />,
  )
}

beforeEach(() => {
  h.opciones = []
  ;(window as unknown as { pty: unknown }).pty = {
    exists: vi.fn(async () => true), getBuffer: vi.fn(async () => ''), create: vi.fn(), resize: vi.fn(), write: vi.fn(), kill: vi.fn(), onData: vi.fn(), onExit: vi.fn(),
  }
})

describe('TerminalPane · foco de un worker', () => {
  it('un pane normal conserva el autofocus', () => {
    montar(base)
    expect(h.opciones.at(-1)).toEqual({ autofocus: true })
  })

  it('un worker de orquestación no toma el foco al montar', () => {
    montar({ ...base, orchestration: { role: 'worker', workerId: 'w', coordinatorPaneId: 'c', colorIndex: 0 } })
    expect(h.opciones.at(-1)).toEqual({ autofocus: false })
  })
})
