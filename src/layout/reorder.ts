import { arrayMove } from '@dnd-kit/sortable'

// Reordena moviendo el item de `from` a `to` (inserción con desplazamiento),
// alineado con lo que ANIMA dnd-kit (rectSortingStrategy). Reemplaza el swap
// posicional que teníamos: con swap, dnd-kit animaba un arrayMove pero el
// estado hacía un intercambio, y el desajuste dejaba transforms residuales que
// descolocaban el WebContentsView del browser al soltar (parecía desaparecer).
export function reorder<T>(arr: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
  return arrayMove(arr, from, to)
}
