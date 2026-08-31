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

// Igual que `reorder` pero por id — los tabs de workspace se arrastran por id.
// Va aparte del `swap` de los panes a proposito: en una barra de tabs mover uno
// debe INSERTARLO y correr al resto (lo que anima dnd-kit con
// horizontalListSortingStrategy), no intercambiarlo con el de destino.
export function reorderById<T extends { id: string }>(arr: T[], fromId: string, toId: string): T[] {
  const from = arr.findIndex(x => x.id === fromId)
  const to = arr.findIndex(x => x.id === toId)
  if (from === -1 || to === -1) return arr
  return reorder(arr, from, to)
}
