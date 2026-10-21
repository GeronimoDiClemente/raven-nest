import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import EditorGraphSection from '../../components/memories/settings/EditorGraphSection'
import { DEFAULT_MEMORY_PREFS, FILTROS_POR_DEFECTO, type MemoryPrefs } from '../../lib/memory-prefs'

const montar = (prefs: MemoryPrefs = DEFAULT_MEMORY_PREFS, extra: { disabled?: boolean } = {}) => {
  const onChange = vi.fn()
  const onResetGraph = vi.fn()
  render(<EditorGraphSection prefs={prefs} onChange={onChange} onResetGraph={onResetGraph} {...extra} />)
  /** Aplica el último cambio a las prefs con que se montó. */
  const ultimo = (): MemoryPrefs => onChange.mock.calls[onChange.mock.calls.length - 1][0](prefs)
  return { onChange, onResetGraph, ultimo }
}

describe('EditorGraphSection', () => {
  it('muestra las filas del spec con sus defaults', () => {
    montar()
    expect(screen.getByRole('switch', { name: 'Live preview' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Readable line width' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Spellcheck' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch', { name: 'Remember graph filters' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Animate graph' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText("Hide Markdown syntax except on the line you're editing.")).toBeInTheDocument()
    expect(screen.getByText('Turn off on slow machines: nodes appear already in place.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Font size' })).toHaveTextContent('13 px')
    expect(screen.getByRole('combobox', { name: 'Labels' })).toHaveTextContent('When zoomed in')
  })

  it('cada switch cambia sólo su campo', () => {
    const { ultimo } = montar()
    fireEvent.click(screen.getByRole('switch', { name: 'Live preview' }))
    expect(ultimo().editor).toEqual({ ...DEFAULT_MEMORY_PREFS.editor, livePreview: false })
    fireEvent.click(screen.getByRole('switch', { name: 'Animate graph' }))
    expect(ultimo().graph.animate).toBe(false)
  })

  it('el tamaño de letra y las etiquetas se eligen de su lista', async () => {
    const { ultimo } = montar()
    fireEvent.click(screen.getByRole('combobox', { name: 'Font size' }))
    fireEvent.click(await screen.findByRole('option', { name: '16 px' }))
    expect(ultimo().editor.fontSize).toBe(16)
    fireEvent.click(screen.getByRole('combobox', { name: 'Labels' }))
    fireEvent.click(await screen.findByRole('option', { name: 'On hover' }))
    expect(ultimo().graph.labels).toBe('hover')
  })

  it('apagar Remember borra los filtros guardados', () => {
    const conFiltros: MemoryPrefs = { ...DEFAULT_MEMORY_PREFS, graph: { ...DEFAULT_MEMORY_PREFS.graph, filtros: FILTROS_POR_DEFECTO } }
    const { ultimo } = montar(conFiltros)
    fireEvent.click(screen.getByRole('switch', { name: 'Remember graph filters' }))
    expect(ultimo().graph.remember).toBe(false)
    expect(ultimo().graph.filtros).toBeUndefined()
  })

  it('Reset avisa; deshabilitada no deja tocar nada', () => {
    const { onResetGraph } = montar()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onResetGraph).toHaveBeenCalled()
  })

  it('mientras las prefs no cargaron, todo está deshabilitado', () => {
    montar(DEFAULT_MEMORY_PREFS, { disabled: true })
    expect(screen.getByRole('switch', { name: 'Live preview' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  })
})
