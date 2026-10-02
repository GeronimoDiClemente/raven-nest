// El contenido de una memoria, leído como Markdown y con los `[[links]]` navegables.
//
// Hasta el 2026-10-02 el panel mostraba el texto crudo en un <pre>: los agentes guardan
// Markdown, y un `[[...]]` era texto muerto aunque el grafo ya supiera adónde apuntaba.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MemoryMarkdown from '../../components/MemoryMarkdown'

function montar(text: string, links?: Array<{ name: string; syncId: string | null }>, onOpen = vi.fn()) {
  render(<MemoryMarkdown text={text} links={links} onOpen={onOpen} />)
  return onOpen
}

describe('MemoryMarkdown — el Markdown', () => {
  it('la negrita es negrita y nada más: no linkea', () => {
    montar('esto es **importante** de verdad', [])
    const b = screen.getByText('importante')
    expect(b.tagName).toBe('STRONG')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('un encabezado se muestra como encabezado, sin los #', () => {
    montar('## Por qué\ncuerpo')
    expect(screen.getByRole('heading', { name: 'Por qué' })).toBeInTheDocument()
  })

  it('una lista es una lista', () => {
    montar('- uno\n- dos')
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['uno', 'dos'])
  })

  it('el código en línea queda como código', () => {
    montar('corré `npm test` antes')
    expect(screen.getByText('npm test').tagName).toBe('CODE')
  })

  it('un bloque de código respeta el texto tal cual', () => {
    montar('```bash\nif [[ -n "$x" ]]; then\n  echo **no**\nfi\n```')
    const pre = screen.getByText(/echo \*\*no\*\*/)
    expect(pre.closest('pre')).not.toBeNull()
  })

  it('nunca interpreta HTML: un <script> en una memoria es texto', () => {
    const { container } = render(<MemoryMarkdown text={'<img src=x onerror="alert(1)">'} onOpen={vi.fn()} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument()
  })
})

describe('MemoryMarkdown — los [[links]]', () => {
  it('un link resuelto se puede tocar y abre esa memoria', () => {
    const onOpen = montar('sale de [[El candado de sync]]', [{ name: 'El candado de sync', syncId: 'obs-a' }])
    fireEvent.click(screen.getByRole('button', { name: 'El candado de sync' }))
    expect(onOpen).toHaveBeenCalledWith('obs-a')
  })

  it('resuelve sin importar mayúsculas, como el grafo', () => {
    const onOpen = montar('[[el CANDADO de sync]]', [{ name: 'El candado de sync', syncId: 'obs-a' }])
    fireEvent.click(screen.getByRole('button', { name: 'el CANDADO de sync' }))
    expect(onOpen).toHaveBeenCalledWith('obs-a')
  })

  it('con alias muestra el alias y navega al destino', () => {
    const onOpen = montar('ver [[candado|el lock]]', [{ name: 'candado', syncId: 'obs-a' }])
    fireEvent.click(screen.getByRole('button', { name: 'el lock' }))
    expect(onOpen).toHaveBeenCalledWith('obs-a')
  })

  it('con sección navega a la memoria entera', () => {
    const onOpen = montar('ver [[candado#por qué]]', [{ name: 'candado', syncId: 'obs-a' }])
    fireEvent.click(screen.getByRole('button', { name: 'candado#por qué' }))
    expect(onOpen).toHaveBeenCalledWith('obs-a')
  })

  it('un hueco no navega: se muestra como pendiente', () => {
    montar('falta [[algo que no existe]]', [{ name: 'algo que no existe', syncId: null }])
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('algo que no existe')).toHaveAttribute('title', expect.stringMatching(/not written yet/i))
  })

  it('un link dentro de una negrita también navega', () => {
    const onOpen = montar('**ver [[candado]]**', [{ name: 'candado', syncId: 'obs-a' }])
    fireEvent.click(screen.getByRole('button', { name: 'candado' }))
    expect(onOpen).toHaveBeenCalledWith('obs-a')
  })

  it('dentro de código no hay links: `[[ -f x ]]` es bash', () => {
    montar('`[[ -f x ]]`', [{ name: '-f x', syncId: 'obs-a' }])
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('sin la resolución (un main viejo) el link queda como texto, sin inventar destinos', () => {
    montar('ver [[candado]]')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/\[\[candado\]\]/)).toBeInTheDocument()
  })
})
