import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { TeamThreadGraph } from '../../components/TeamThreadGraph'
import type { TeamThreadBranch } from '../../types'

const AHORA = Date.UTC(2026, 8, 8, 12, 0)

const BRANCHES: TeamThreadBranch[] = [
  { slug: 'sidebar', branch: 'feat/sidebar-tabs', estado: 'activa', ultimoAutor: 'Bauti', ultimaEntrada: AHORA - 3600_000, entradas: 2 },
  { slug: 'bridge', branch: 'smoke/memory-bridge', estado: 'cerrada', ultimoAutor: 'Gero', ultimaEntrada: AHORA - 40 * 86400_000, entradas: 5 },
]

describe('TeamThreadGraph', () => {
  // I5: el default es GLOBAL. El grafo sintetiza una estrella `_index -> rama` y no lee los
  // wikilinks de las notas, con lo cual el modo local colapsa a "el foco solo" — un nodo.
  it('global por default: dibuja un nodo por rama', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /open note/i })).toHaveLength(2)
  })

  it('"Show current branch" pasa a local: queda solo la rama en foco', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    fireEvent.click(screen.getByText('Show current branch'))
    expect(screen.getAllByRole('button', { name: /open note/i })).toHaveLength(1)
  })

  it('y se puede volver a global', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    fireEvent.click(screen.getByText('Show current branch'))
    fireEvent.click(screen.getByText('Show all branches'))
    expect(screen.getAllByRole('button', { name: /open note/i })).toHaveLength(2)
  })

  it('el click en un nodo abre la nota de esa rama', () => {
    const onOpenNote = vi.fn()
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={onOpenNote} />)
    fireEvent.click(screen.getByRole('button', { name: /open note for feat\/sidebar-tabs/i }))
    expect(onOpenNote).toHaveBeenCalledWith('sidebar')
  })

  it('distingue visualmente lo cerrado y lo viejo', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    const cerrada = screen.getByRole('button', { name: /open note for smoke\/memory-bridge/i })
    expect(cerrada).toHaveAttribute('data-estado', 'cerrada')
    expect(cerrada).toHaveAttribute('data-frescura', 'viejo')
  })

  it('el estado y la frescura tambien viajan en el aria-label, no solo en color/borde', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    expect(screen.getByRole('button', { name: /open note for feat\/sidebar-tabs — active, updated today/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open note for smoke\/memory-bridge — closed, stale/i })).toBeInTheDocument()
  })

  it('apagado muestra el llamado a activarlo y ningun nodo', () => {
    render(<TeamThreadGraph branches={[]} focus={null} ahora={AHORA} enabled={false} onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    expect(screen.getByText(/share this project's thread/i)).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /open note/i })).toHaveLength(0)
  })
})

// Review de Task 9: dos hallazgos de calidad, cubiertos con tests en vez de solo con
// una captura mirada a ojo. Ambos manejan el rAF a mano (mock de
// requestAnimationFrame que encola el callback en vez de dispararlo con un timer) para
// no depender de tiempo real: la simulación tarda unos cientos de ticks en asentarse, y
// drenar la cola sincrónicamente corre esos ticks en microsegundos.
describe('TeamThreadGraph — física del layout', () => {
  // Ramas con nombres largos a proposito: son las que en la review original hacian
  // tocarse las etiquetas de texto si la separacion de equilibrio quedaba corta.
  const RAMAS_LARGAS: TeamThreadBranch[] = Array.from({ length: 7 }, (_, i) => ({
    slug: `b${i}`,
    branch: `feat/branch-number-${i}-largo`,
    estado: 'activa',
    ultimoAutor: 'x',
    ultimaEntrada: AHORA - i * 3 * 86400_000,
    entradas: 1,
  }))

  function mockRaf() {
    const cola: FrameRequestCallback[] = []
    let llamadas = 0
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      llamadas++
      cola.push(cb)
      return llamadas
    })
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    // Drena la cola sincrónicamente: cada callback ejecutado puede volver a encolarse
    // a sí mismo (así es como el loop real se reprograma), así que se sigue tirando
    // hasta que no quede nada agendado — eso es "convergió, dejó de pedir más frames".
    const converger = () => {
      // `act`: los callbacks llaman `setTick` fuera de cualquier evento de React (no
      // hay `fireEvent` de por medio), así que sin `act` React encola los re-renders
      // pero no los aplica al DOM antes de que el test siga leyendo — y lo que se lee
      // termina siendo la semilla inicial, no la posición asentada.
      act(() => {
        let guard = 0
        while (cola.length > 0 && guard < 20_000) {
          const cb = cola.shift()!
          cb(0)
          guard++
        }
      })
    }
    return { rafSpy, cafSpy, llamadasHechas: () => llamadas, converger }
  }

  // Important 1 (review): el efecto del loop dependía de `graph.edges`, una referencia
  // que cambia en cada render de TeamThreadPanel (pasa `ahora={Date.now()}` inline) sin
  // que la topología cambie. Eso reactivaba el rAF después de haber convergido — justo
  // lo que el corte por energía existe para evitar.
  it('un re-render que no cambia la topologia no reanuda el loop ya asentado', () => {
    const { llamadasHechas, converger, rafSpy, cafSpy } = mockRaf()

    const { rerender } = render(
      <TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />,
    )
    converger()
    const llamadasAlAsentarse = llamadasHechas()
    expect(llamadasAlAsentarse).toBeGreaterThan(0)

    // Mismo set de ramas, mismas aristas — solo cambia `ahora`, como pasaria en
    // cualquier re-render de TeamThreadPanel que no toca la topologia.
    rerender(
      <TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA + 1} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />,
    )
    converger()

    expect(llamadasHechas()).toBe(llamadasAlAsentarse)

    rafSpy.mockRestore()
    cafSpy.mockRestore()
  })

  // Minor 3 (review): en vez de depender de que alguien mire una captura a mano, esto
  // afirma la separacion real entre nodos-rama una vez asentada la simulacion.
  it('los nodos terminan separados entre si, no amontonados en el mismo punto', () => {
    const { converger, rafSpy, cafSpy } = mockRaf()

    render(
      <TeamThreadGraph branches={RAMAS_LARGAS} focus={null} ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />,
    )
    converger()

    const nodos = screen.getAllByRole('button', { name: /open note/i })
    expect(nodos.length).toBe(RAMAS_LARGAS.length)
    const posiciones = nodos.map((n) => ({
      x: Number(n.getAttribute('cx')),
      y: Number(n.getAttribute('cy')),
    }))

    let distanciaMinima = Infinity
    for (let i = 0; i < posiciones.length; i++) {
      for (let j = i + 1; j < posiciones.length; j++) {
        const d = Math.hypot(posiciones[i].x - posiciones[j].x, posiciones[i].y - posiciones[j].y)
        distanciaMinima = Math.min(distanciaMinima, d)
      }
    }
    // Medido: con las 7 ramas de arriba y los parametros actuales del componente, el
    // equilibrio da ~220 unidades de separacion minima. 150 deja margen para variacion
    // sin ser tan laxo como para dejar pasar un colapso al centro.
    expect(distanciaMinima).toBeGreaterThan(150)

    rafSpy.mockRestore()
    cafSpy.mockRestore()
  })
})
