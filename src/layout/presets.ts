import type { LayoutId } from '../types'

export type Split =
  | { kind: 'pane'; slot: number }
  | { kind: 'h' | 'v'; children: Split[] }

export interface LayoutPreset {
  id: LayoutId
  slotCount: number
  label: string
  icon: string         // inline SVG path data
  root: Split
}

const pane = (slot: number): Split => ({ kind: 'pane', slot })
const h = (...children: Split[]): Split => ({ kind: 'h', children })
const v = (...children: Split[]): Split => ({ kind: 'v', children })

// SVG path data for 16x16 mosaics. Used by LayoutSelector mini-mockups.
const ICONS: Record<LayoutId, string> = {
  '1':  'M2 2h12v12H2z',
  '2V': 'M2 2h5v12H2z M9 2h5v12H9z',
  '2H': 'M2 2h12v5H2z M2 9h12v5H2z',
  '3C': 'M2 2h3.3v12H2z M6.3 2h3.4v12H6.3z M10.7 2h3.3v12h-3.3z',
  '3M': 'M2 2h5v12H2z M9 2h5v5H9z M9 9h5v5H9z',
  '3T': 'M2 2h5v5H2z M9 2h5v5H9z M2 9h12v5H2z',
  '4Q': 'M2 2h5v5H2z M9 2h5v5H9z M2 9h5v5H2z M9 9h5v5H9z',
  '4M': 'M2 2h5v12H2z M9 2h5v3.3H9z M9 6.3h5v3.4H9z M9 10.7h5v3.3H9z',
  '5T': 'M2 2h3.3v5H2z M6.3 2h3.4v5H6.3z M10.7 2h3.3v5h-3.3z M2 9h5v5H2z M9 9h5v5H9z',
  '6G': 'M2 2h3.3v5H2z M6.3 2h3.4v5H6.3z M10.7 2h3.3v5h-3.3z M2 9h3.3v5H2z M6.3 9h3.4v5H6.3z M10.7 9h3.3v5h-3.3z',
  '9G': 'M2 2h3.3v3.3H2z M6.3 2h3.4v3.3H6.3z M10.7 2h3.3v3.3h-3.3z M2 6.3h3.3v3.4H2z M6.3 6.3h3.4v3.4H6.3z M10.7 6.3h3.3v3.4h-3.3z M2 10.7h3.3v3.3H2z M6.3 10.7h3.4v3.3H6.3z M10.7 10.7h3.3v3.3h-3.3z',
}

export const PRESETS: Record<LayoutId, LayoutPreset> = {
  '1':  { id: '1',  slotCount: 1, label: 'Single',                   icon: ICONS['1'],  root: pane(0) },
  '2V': { id: '2V', slotCount: 2, label: 'Two columns',              icon: ICONS['2V'], root: h(pane(0), pane(1)) },
  '2H': { id: '2H', slotCount: 2, label: 'Two rows',                 icon: ICONS['2H'], root: v(pane(0), pane(1)) },
  '3C': { id: '3C', slotCount: 3, label: 'Three columns',            icon: ICONS['3C'], root: h(pane(0), pane(1), pane(2)) },
  '3M': { id: '3M', slotCount: 3, label: 'Master + stack',           icon: ICONS['3M'], root: h(pane(0), v(pane(1), pane(2))) },
  '3T': { id: '3T', slotCount: 3, label: 'Top split + bottom',       icon: ICONS['3T'], root: v(h(pane(0), pane(1)), pane(2)) },
  '4Q': { id: '4Q', slotCount: 4, label: 'Quadrants',                icon: ICONS['4Q'], root: v(h(pane(0), pane(1)), h(pane(2), pane(3))) },
  '4M': { id: '4M', slotCount: 4, label: 'Master + 3 stack',         icon: ICONS['4M'], root: h(pane(0), v(pane(1), pane(2), pane(3))) },
  '5T': { id: '5T', slotCount: 5, label: 'Three over two',           icon: ICONS['5T'], root: v(h(pane(0), pane(1), pane(2)), h(pane(3), pane(4))) },
  '6G': { id: '6G', slotCount: 6, label: '3 × 2 grid',               icon: ICONS['6G'], root: v(h(pane(0), pane(1), pane(2)), h(pane(3), pane(4), pane(5))) },
  '9G': { id: '9G', slotCount: 9, label: '3 × 3 grid',               icon: ICONS['9G'], root: v(
    h(pane(0), pane(1), pane(2)),
    h(pane(3), pane(4), pane(5)),
    h(pane(6), pane(7), pane(8)),
  ) },
}

export function getPreset(id: LayoutId): LayoutPreset {
  const preset = PRESETS[id]
  if (!preset) throw new Error(`unknown layout id: ${id}`)
  return preset
}
