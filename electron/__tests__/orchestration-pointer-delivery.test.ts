import { describe, it, expect, vi } from 'vitest'
import { OrchestrationState } from '../orchestration/orchestration-state'
import {
  PointerDelivery,
  QUIET_MS,
  ENTER_DELAY_MS,
  RECHECK_MS,
  DRAFT_HOLD_MAX_MS,
  type PointerDeps
} from '../orchestration/pointer-delivery'
import { pointerLine } from '../orchestration/prompts'

const PERMISO = 'Do you want to proceed? (yes/no)'

function armar() {
  let t = 100_000
  const timers: { id: number; at: number; fn: () => void }[] = []
  let seq = 0
  const writes: { paneId: string; data: string }[] = []
  const est = { tail: '', lastOut: null as number | null, alive: true }
  const deps: PointerDeps = {
    now: () => t,
    setTimer: (fn, ms) => {
      const id = ++seq
      timers.push({ id, at: t + ms, fn })
      return () => {
        const i = timers.findIndex((x) => x.id === id)
        if (i >= 0) timers.splice(i, 1)
      }
    },
    writePty: (paneId, data) => void writes.push({ paneId, data }),
    bufferTail: () => est.tail,
    lastOutputAt: () => est.lastOut,
    isAlive: () => est.alive
  }
  const advance = (ms: number) => {
    const fin = t + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const next = timers[0]
      if (!next || next.at > fin) break
      timers.shift()
      t = Math.max(t, next.at)
      next.fn()
    }
    t = fin
  }
  const state = new OrchestrationState()
  const w = state.addWorker(
    {
      workerId: 'w1',
      coordinatorPaneId: 'c',
      paneId: 'pw',
      label: 'W1',
      branch: 'b',
      worktreePath: '/wt',
      baseBranch: 'main',
      agent: 'claude'
    },
    t
  )
  const push = () => state.push(w.workerId, 'done', 'listo', t)
  const pd = new PointerDelivery(deps, state)
  return { pd, state, est, writes, advance, push, now: () => t, timers }
}

describe('PointerDelivery', () => {
  it('entrega cuando lleva 3 s quieto', () => {
    const h = armar()
    h.est.lastOut = h.now() - QUIET_MS
    h.push()
    h.pd.notify('c')
    expect(h.writes).toEqual([{ paneId: 'c', data: pointerLine(1) }])
    expect(h.state.pending('c')[0].delivery).toBe('pointed')
  })

  it('no entrega con output reciente y reintenta', () => {
    const h = armar()
    h.est.lastOut = h.now() - 100
    h.push()
    h.pd.notify('c')
    expect(h.writes).toEqual([])
    h.advance(RECHECK_MS)
    expect(h.writes).toEqual([])
    h.advance(RECHECK_MS) // ya pasaron > 3 s desde el último output
    expect(h.writes[0]).toEqual({ paneId: 'c', data: pointerLine(1) })
  })

  it('no escribe con borrador pendiente', () => {
    const h = armar()
    h.push()
    h.pd.onUserInput('c', 'hola')
    h.pd.notify('c')
    h.advance(RECHECK_MS * 3)
    expect(h.writes).toEqual([])
  })

  it('entrega después de que el usuario manda Enter', () => {
    const h = armar()
    h.push()
    h.pd.onUserInput('c', 'hola')
    h.pd.notify('c')
    h.advance(RECHECK_MS)
    expect(h.writes).toEqual([])
    h.pd.onUserInput('c', '\r')
    h.advance(RECHECK_MS)
    expect(h.writes[0]).toEqual({ paneId: 'c', data: pointerLine(1) })
  })

  it('suelta el borrador pasado DRAFT_HOLD_MAX_MS', () => {
    const h = armar()
    h.push()
    h.pd.onUserInput('c', 'hola')
    h.pd.notify('c')
    h.advance(DRAFT_HOLD_MAX_MS + RECHECK_MS)
    expect(h.writes[0]).toEqual({ paneId: 'c', data: pointerLine(1) })
  })

  it('no entrega con prompt de permiso en pantalla', () => {
    const h = armar()
    h.est.tail = PERMISO
    h.push()
    h.pd.notify('c')
    h.advance(RECHECK_MS * 3)
    expect(h.writes).toEqual([])
    h.est.tail = ''
    h.advance(RECHECK_MS)
    expect(h.writes).toHaveLength(1)
  })

  it('Enter va 500 ms después del texto', () => {
    const h = armar()
    h.push()
    h.pd.notify('c')
    expect(h.writes.map((x) => x.data)).toEqual([pointerLine(1)])
    h.advance(ENTER_DELAY_MS - 1)
    expect(h.writes).toHaveLength(1)
    h.advance(1)
    expect(h.writes.map((x) => x.data)).toEqual([pointerLine(1), '\r'])
  })

  it('difiere el Enter si apareció un borrador en esos 500 ms', () => {
    const h = armar()
    h.push()
    h.pd.notify('c')
    h.pd.onUserInput('c', 'x')
    h.advance(ENTER_DELAY_MS)
    expect(h.writes.map((x) => x.data)).toEqual([pointerLine(1)])
    h.advance(RECHECK_MS)
    expect(h.writes.map((x) => x.data)).toEqual([pointerLine(1)]) // sigue diferido
    h.pd.onUserInput('c', '\x7f') // borra el borrador
    h.advance(RECHECK_MS)
    expect(h.writes.map((x) => x.data)).toEqual([pointerLine(1), '\r'])
  })

  it('difiere el Enter si apareció un diálogo en esos 500 ms', () => {
    const h = armar()
    h.push()
    h.pd.notify('c')
    h.est.tail = PERMISO
    h.advance(ENTER_DELAY_MS + RECHECK_MS)
    expect(h.writes).toHaveLength(1)
    h.est.tail = ''
    h.advance(RECHECK_MS)
    expect(h.writes.map((x) => x.data)).toEqual([pointerLine(1), '\r'])
  })

  it('un solo puntero en vuelo', () => {
    const h = armar()
    h.push()
    h.pd.notify('c')
    h.push()
    h.pd.notify('c')
    h.advance(ENTER_DELAY_MS - 1)
    expect(h.writes.filter((x) => x.data !== '\r')).toHaveLength(1)
    h.advance(ENTER_DELAY_MS * 3)
    // terminado el vuelo, el mensaje 'pending' que llegó en el medio arma otro puntero
    expect(h.writes.filter((x) => x.data !== '\r')).toHaveLength(2)
  })

  it('mensajes ya apuntados no disparan otro puntero', () => {
    const h = armar()
    h.push()
    h.pd.notify('c')
    h.advance(ENTER_DELAY_MS)
    h.pd.notify('c')
    h.advance(RECHECK_MS * 3)
    expect(h.writes.map((x) => x.data)).toEqual([pointerLine(1), '\r'])
  })

  it('cancela entregas del coordinador muerto', () => {
    const h = armar()
    h.est.lastOut = h.now()
    h.push()
    h.pd.notify('c')
    h.est.alive = false
    h.advance(RECHECK_MS * 5)
    expect(h.writes).toEqual([])
    expect(h.timers).toHaveLength(0)
  })

  it('no escribe el Enter si el coordinador murió entre texto y Enter', () => {
    const h = armar()
    h.push()
    h.pd.notify('c')
    h.est.alive = false
    h.advance(ENTER_DELAY_MS * 4)
    expect(h.writes).toHaveLength(1)
  })

  it('cancel limpia timers y permite re-notificar', () => {
    const h = armar()
    h.est.lastOut = h.now()
    h.push()
    h.pd.notify('c')
    h.pd.cancel('c')
    expect(h.timers).toHaveLength(0)
    h.advance(RECHECK_MS * 3)
    expect(h.writes).toEqual([])
    h.pd.notify('c')
    h.advance(RECHECK_MS * 2)
    expect(h.writes[0]).toEqual({ paneId: 'c', data: pointerLine(1) })
  })

  it('watchWorker avisa una vez por episodio', () => {
    const h = armar()
    const cb = vi.fn()
    const off = h.pd.watchWorker('pw', cb)
    h.est.tail = PERMISO
    h.est.lastOut = h.now()
    h.pd.onOutput('pw')
    expect(cb).not.toHaveBeenCalled() // todavía no está quieto
    h.advance(QUIET_MS + RECHECK_MS) // el recheck periódico lo ve quieto
    expect(cb).toHaveBeenCalledTimes(1)
    h.advance(RECHECK_MS * 5)
    h.pd.onOutput('pw')
    expect(cb).toHaveBeenCalledTimes(1)
    h.est.tail = 'working...' // la condición se despeja
    h.pd.onOutput('pw')
    h.est.tail = PERMISO // episodio nuevo
    h.pd.onOutput('pw')
    expect(cb).toHaveBeenCalledTimes(2)
    off()
    expect(h.timers).toHaveLength(0)
    h.est.tail = 'x'
    h.pd.onOutput('pw')
    h.est.tail = PERMISO
    h.pd.onOutput('pw')
    expect(cb).toHaveBeenCalledTimes(2)
  })

  // --- inferencia del borrador ---
  const bloquea = (h: ReturnType<typeof armar>, ...inputs: string[]): boolean => {
    h.push()
    for (const i of inputs) h.pd.onUserInput('c', i)
    h.pd.notify('c')
    h.advance(RECHECK_MS * 2)
    return h.writes.length === 0
  }

  it('Ctrl-C, Ctrl-U y Esc suelto borran el borrador', () => {
    for (const k of ['\x03', '\x15', '\x1b']) {
      expect(bloquea(armar(), 'hola', k)).toBe(false)
    }
  })

  it('borrar todo con backspace libera, borrar a medias no', () => {
    expect(bloquea(armar(), 'ab', '\x7f', '\x7f')).toBe(false)
    expect(bloquea(armar(), 'ab', '\x7f')).toBe(true)
    expect(bloquea(armar(), '\x7f\x7f', 'a')).toBe(true) // piso en 0
  })

  it('Alt+Enter, barra+Enter y \\n no envían: el borrador sigue', () => {
    expect(bloquea(armar(), 'hola', '\x1b\r')).toBe(true)
    expect(bloquea(armar(), 'hola\\', '\r')).toBe(true)
    expect(bloquea(armar(), 'hola', '\n')).toBe(true)
    expect(bloquea(armar(), 'hola', '\r')).toBe(false)
  })

  it('las secuencias de escape del terminal no cuentan como borrador', () => {
    for (const seq of [
      '\x1b[I',
      '\x1b[O',
      '\x1b[A',
      '\x1bOP',
      '\x1b[12;40R',
      '\x1b[<0;10;5M',
      '\x1b[M ab',
      '\x1b[200~\x1b[201~'
    ]) {
      expect(bloquea(armar(), seq)).toBe(false)
    }
  })

  it('el texto pegado entre marcadores sí cuenta', () => {
    expect(bloquea(armar(), '\x1b[200~pegado\x1b[201~')).toBe(true)
    expect(bloquea(armar(), '\x1b[200~a\rb\x1b[201~')).toBe(true) // \r pegado no envía
  })

  it('mensaje que llega en la ventana del Enter arma un segundo puntero', () => {
    const h = armar()
    h.push()
    h.pd.notify('c')
    h.advance(ENTER_DELAY_MS - 100)
    h.push()
    h.pd.notify('c')
    h.advance(RECHECK_MS * 3)
    const textos = h.writes.filter((x) => x.data !== '\r').map((x) => x.data)
    expect(textos).toEqual([pointerLine(1), pointerLine(2)])
  })

  it('si el usuario envía con Enter mientras el del puntero está pendiente, se descarta el \r propio', () => {
    const h = armar()
    h.push()
    h.pd.notify('c')
    h.pd.onUserInput('c', 'x') // difiere
    h.advance(ENTER_DELAY_MS)
    h.pd.onUserInput('c', '\r')
    h.advance(RECHECK_MS * 3)
    expect(h.writes.map((x) => x.data)).toEqual([pointerLine(1)])
  })

  it('el watch se detiene con el pane muerto y sobrevive a un callback que tira', () => {
    const h = armar()
    const cb = vi.fn(() => {
      throw new Error('boom')
    })
    h.pd.watchWorker('pw', cb)
    h.est.tail = PERMISO
    h.advance(RECHECK_MS)
    expect(cb).toHaveBeenCalledTimes(1)
    h.est.tail = ''
    h.advance(RECHECK_MS)
    h.est.tail = PERMISO
    h.advance(RECHECK_MS)
    expect(cb).toHaveBeenCalledTimes(2) // la cadena siguió viva
    h.est.alive = false
    h.advance(RECHECK_MS)
    expect(h.timers).toHaveLength(0)
  })

  it('un writePty que tira cancela el vuelo sin reintentar', () => {
    const h = armar()
    let n = 0
    const d = (h.pd as unknown as { deps: PointerDeps }).deps
    d.writePty = () => {
      n++
      throw new Error('pty cerrado')
    }
    h.push()
    expect(() => h.pd.notify('c')).not.toThrow()
    h.advance(RECHECK_MS * 5)
    expect(n).toBe(1)
    expect(h.timers).toHaveLength(0)
  })

  it('forget limpia el borrador; cancel (pane vivo) lo conserva', () => {
    const h = armar()
    h.push()
    h.pd.onUserInput('c', 'hola')
    h.pd.cancel('c')
    h.pd.notify('c')
    h.advance(RECHECK_MS * 2)
    expect(h.writes).toHaveLength(0)
    h.pd.forget('c')
    h.pd.notify('c')
    expect(h.writes).toHaveLength(1)
  })

  it('el agente consume los mensajes (n=0) con un borrador vivo: el próximo notify no escribe', () => {
    const h = armar()
    h.push()
    h.pd.onUserInput('c', 'hola')
    h.pd.notify('c')
    h.state.markDelivered('c') // el agente leyó la bandeja por su cuenta
    h.advance(RECHECK_MS) // intentarTexto ve n === 0 y termina el vuelo
    h.push()
    h.pd.notify('c')
    h.advance(RECHECK_MS * 3)
    expect(h.writes).toEqual([])
  })

  it('un Esc partido en dos chunks no es un Esc suelto', () => {
    const h = armar()
    expect(bloquea(h, 'hola', '\x1b', '[I')).toBe(true)
    const h2 = armar()
    expect(bloquea(h2, 'hola', '\x1b[1', ';5R')).toBe(true)
    expect(bloquea(armar(), '\x1b', '[I')).toBe(false)
  })

  it('un Esc suelto sin continuación borra el borrador tras ESC_FLUSH', () => {
    const h = armar()
    h.push()
    h.pd.onUserInput('c', 'hola')
    h.pd.onUserInput('c', '\x1b')
    h.pd.notify('c')
    h.advance(RECHECK_MS)
    expect(h.writes[0]).toEqual({ paneId: 'c', data: pointerLine(1) })
  })

  it('un pegado partido en chunks con \\r adentro no envía', () => {
    const h = armar()
    expect(bloquea(h, '\x1b[200~uno', '\rdos', '\x1b[201~')).toBe(true)
    expect(bloquea(armar(), '\x1b[200~uno', '\r')).toBe(true) // sigue en paste
    // fuera del paste, un \r sí envía
    expect(bloquea(armar(), '\x1b[200~uno\x1b[201~', '\r')).toBe(false)
  })

  it('los payloads OSC y DCS no cuentan como borrador', () => {
    expect(bloquea(armar(), '\x1b]11;rgb:0000/0000/0000\x07')).toBe(false)
    expect(bloquea(armar(), '\x1b]10;rgb:ffff\x1b\\')).toBe(false)
    expect(bloquea(armar(), '\x1bP1$r0m\x1b\\')).toBe(false)
    expect(bloquea(armar(), '\x1b]11;rgb:00', '00\x07')).toBe(false) // partido
  })

  it('cuenta por code point: un emoji se borra con un solo backspace', () => {
    expect(bloquea(armar(), '😀', '\x7f')).toBe(false)
    expect(bloquea(armar(), '😀😀', '\x7f')).toBe(true)
  })
})
