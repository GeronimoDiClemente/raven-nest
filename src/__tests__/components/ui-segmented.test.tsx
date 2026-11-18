import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Segmented } from '@/components/ui/segmented'

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
]

function montar(value = 'a', onValueChange: (v: string) => void = () => {}) {
  return render(<Segmented options={options} value={value} onValueChange={onValueChange} aria-label="Mode" />)
}

describe('Segmented', () => {
  it('es un grupo con el aria-label dado y un botón type=button por opción', () => {
    montar()
    const grupo = screen.getByRole('group', { name: 'Mode' })
    const botones = screen.getAllByRole('button')
    expect(botones).toHaveLength(3)
    for (const b of botones) {
      expect(grupo.contains(b)).toBe(true)
      expect(b).toHaveAttribute('type', 'button')
    }
  })

  it('sólo la opción elegida lleva aria-pressed="true" y bg-sidebar-row-selected', () => {
    montar('b')
    const elegido = screen.getByRole('button', { name: 'Beta' })
    expect(elegido).toHaveAttribute('aria-pressed', 'true')
    expect(elegido.classList.contains('bg-sidebar-row-selected')).toBe(true)
    for (const nombre of ['Alpha', 'Gamma']) {
      const b = screen.getByRole('button', { name: nombre })
      expect(b).toHaveAttribute('aria-pressed', 'false')
      expect(b.classList.contains('bg-sidebar-row-selected')).toBe(false)
    }
  })

  it('un clic en otra opción llama onValueChange con su value', () => {
    const onValueChange = vi.fn()
    montar('a', onValueChange)
    fireEvent.click(screen.getByRole('button', { name: 'Gamma' }))
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('c')
  })

  it('un clic en la opción ya elegida también llama onValueChange (el spec no la excluye)', () => {
    const onValueChange = vi.fn()
    montar('a', onValueChange)
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
    expect(onValueChange).toHaveBeenCalledWith('a')
  })

  it('el label de la opción puede ser un nodo', () => {
    render(<Segmented options={[{ value: 'x', label: <span data-testid="n">Node</span> }]} value="x" onValueChange={() => {}} aria-label="M" />)
    expect(screen.getByTestId('n')).toBeInTheDocument()
  })

  it('mezcla className y pasa el resto de props al contenedor', () => {
    render(<Segmented options={options} value="a" onValueChange={() => {}} aria-label="Mode" className="mi-clase" data-testid="s" />)
    const raiz = screen.getByTestId('s')
    expect(raiz).toBe(screen.getByRole('group', { name: 'Mode' }))
    expect(raiz.classList.contains('mi-clase')).toBe(true)
  })
})
