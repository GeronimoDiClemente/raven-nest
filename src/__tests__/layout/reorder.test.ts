import { describe, it, expect } from 'vitest'
import { reorder } from '../../layout/reorder'

// dnd-kit anima el reordenamiento como un arrayMove (mover con desplazamiento),
// pero el estado hacía un swap (intercambio posicional). Para movimientos NO
// adyacentes los dos difieren, y el desajuste dejaba transforms residuales que
// descolocaban el WebContentsView del browser (se "desaparecía" al soltar).
describe('reorder (arrayMove, no swap)', () => {
  it('mueve el item de from a to desplazando los demás (no un intercambio)', () => {
    // mover el primero al final: arrayMove desplaza; un swap dejaría ['c','b','a']
    expect(reorder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })

  it('un movimiento adyacente coincide con el intercambio (caso del reporte)', () => {
    // mover el de la derecha (2) al medio (1)
    expect(reorder(['izq', 'medio', 'der'], 2, 1)).toEqual(['izq', 'der', 'medio'])
  })

  it('devuelve el MISMO array (ref) si algún índice está fuera de rango', () => {
    const arr = ['a', 'b', 'c']
    expect(reorder(arr, -1, 1)).toBe(arr)
    expect(reorder(arr, 0, 5)).toBe(arr)
  })
})
