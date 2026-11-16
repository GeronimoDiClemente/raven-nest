// Con dos celdas browser abiertas, cerrar una dejaba a la otra sorda: el desmontaje
// llamaba `window.browser.removeListeners()`, que borra los oyentes de `browser:navigated`
// de TODAS las celdas. El puente falso de acá imita la semántica del preload real
// (on suma, la baja saca sólo su handler, removeListeners borra todo).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import BrowserCell from '../../components/BrowserCell'
import type { PaneNode } from '../../types'

type Oyente = (paneId: string, url: string) => void
const oyentes = new Set<Oyente>()

function emitirNavegacion(paneId: string, url: string) {
  for (const cb of [...oyentes]) cb(paneId, url)
}

function pane(id: string): PaneNode {
  return {
    id,
    aiType: 'browser',
    accountName: '',
    accountDir: '',
    borderColor: '#888',
    cmd: '',
    url: `https://${id}.test/`,
  } as PaneNode
}

beforeEach(() => {
  oyentes.clear()
  ;(window as unknown as { browser: unknown }).browser = {
    create: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    reposition: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
    back: vi.fn(), forward: vi.fn(), reload: vi.fn(),
    onNavigated: (cb: Oyente) => {
      oyentes.add(cb)
      return () => { oyentes.delete(cb) }
    },
    removeListeners: () => { oyentes.clear() },
  }
  ;(window as unknown as { port: unknown }).port = {
    listForWorkspace: vi.fn(async () => []),
    listAll: vi.fn(async () => []),
  }
})

describe('BrowserCell · browser:navigated con varias celdas', () => {
  it('las dos celdas reciben su navegación y cerrar una no deja sorda a la otra', () => {
    const a = render(<BrowserCell pane={pane('a')} onClose={() => {}} />)
    render(<BrowserCell pane={pane('b')} onClose={() => {}} />)
    expect(oyentes.size).toBe(2)

    act(() => {
      emitirNavegacion('a', 'https://a.test/uno')
      emitirNavegacion('b', 'https://b.test/uno')
    })
    expect(screen.getByDisplayValue('https://a.test/uno')).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://b.test/uno')).toBeInTheDocument()

    a.unmount()
    expect(oyentes.size).toBe(1)

    act(() => { emitirNavegacion('b', 'https://b.test/dos') })
    expect(screen.getByDisplayValue('https://b.test/dos')).toBeInTheDocument()
  })
})
