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
  '4T': 'M2 2h3.3v5H2z M6.3 2h3.4v5H6.3z M10.7 2h3.3v5h-3.3z M2 9h12v5H2z',
  '5T': 'M2 2h3.3v5H2z M6.3 2h3.4v5H6.3z M10.7 2h3.3v5h-3.3z M2 9h5v5H2z M9 9h5v5H9z',
  '5M': 'M2 2h5v12H2z M9 2h5v2.5H9z M9 6h5v2.5H9z M9 9.5h5v2.5H9z M9 13h5v1H9z',
  '6G': 'M2 2h3.3v5H2z M6.3 2h3.4v5H6.3z M10.7 2h3.3v5h-3.3z M2 9h3.3v5H2z M6.3 9h3.4v5H6.3z M10.7 9h3.3v5h-3.3z',
  '6M': 'M2 2h5v12H2z M9 2h5v2H9z M9 5h5v2H9z M9 8h5v2H9z M9 11h5v2H9z M9 14h5v0.5H9z',
  '7T': 'M2 2h2.4v5H2z M5.4 2h2.4v5H5.4z M8.8 2h2.4v5H8.8z M12.2 2h1.8v5h-1.8z M2 9h3.3v5H2z M6.3 9h3.4v5H6.3z M10.7 9h3.3v5h-3.3z',
  '7M': 'M2 2h5v12H2z M9 2h5v1.5H9z M9 4.5h5v1.5H9z M9 7h5v1.5H9z M9 9.5h5v1.5H9z M9 12h5v1.5H9z M9 14.5h5v0H9z',
  '8G': 'M2 2h3.3v5H2z M6.3 2h3.4v5H6.3z M10.7 2h3.3v5h-3.3z M2 9h2.4v5H2z M5.4 9h2.4v5H5.4z M8.8 9h2.4v5H8.8z M12.2 9h1.8v5h-1.8z',
  '8M': 'M2 2h5v12H2z M9 2h5v1.6H9z M9 4.5h5v1.6H9z M9 7h5v1.6H9z M9 9.5h5v1.6H9z M9 12h5v1.6H9z',
  '9G': 'M2 2h3.3v3.3H2z M6.3 2h3.4v3.3H6.3z M10.7 2h3.3v3.3h-3.3z M2 6.3h3.3v3.4H2z M6.3 6.3h3.4v3.4H6.3z M10.7 6.3h3.3v3.4h-3.3z M2 10.7h3.3v3.3H2z M6.3 10.7h3.4v3.3H6.3z M10.7 10.7h3.3v3.3h-3.3z',
  '9M': 'M2 2h5v12H2z M9 2h5v1.4H9z M9 3.9h5v1.4H9z M9 5.8h5v1.4H9z M9 7.7h5v1.4H9z M9 9.6h5v1.4H9z M9 11.5h5v1.4H9z M9 13.4h5v0.6H9z',
  '10G': 'M2 2h2.4v5H2z M5.4 2h2.4v5H5.4z M8.8 2h2.4v5H8.8z M12.2 2h1.8v5h-1.8z M2 9h2.4v5H2z M5.4 9h2.4v5H5.4z M8.8 9h2.4v5H8.8z M11 9h3v5h-3z',
  '10M': 'M2 2h5v12H2z M9 2h5v1.3H9z M9 3.8h5v1.3H9z M9 5.6h5v1.3H9z M9 7.4h5v1.3H9z M9 9.2h5v1.3H9z M9 11h5v1.3H9z M9 12.8h5v1.2H9z',
  '11G': 'M2 2h2.4v3.5H2z M5.4 2h2.4v3.5H5.4z M8.8 2h2.4v3.5H8.8z M12.2 2h1.8v3.5h-1.8z M2 6.5h2.4v3H2z M5.4 6.5h2.4v3H5.4z M8.8 6.5h2.4v3H8.8z M12.2 6.5h1.8v3h-1.8z M2 10.5h3.7v3.5H2z M6.5 10.5h3v3.5h-3z M10 10.5h4v3.5h-4z',
  '12G': 'M2 2h2.4v3.5H2z M5.4 2h2.4v3.5H5.4z M8.8 2h2.4v3.5H8.8z M12.2 2h1.8v3.5h-1.8z M2 6.5h2.4v3H2z M5.4 6.5h2.4v3H5.4z M8.8 6.5h2.4v3H8.8z M12.2 6.5h1.8v3h-1.8z M2 10.5h2.4v3.5H2z M5.4 10.5h2.4v3.5H5.4z M8.8 10.5h2.4v3.5H8.8z M12.2 10.5h1.8v3.5h-1.8z',
  '11M': 'M2 2h5v12H2z M9 2h5v1H9z M9 3.2h5v1H9z M9 4.4h5v1H9z M9 5.6h5v1H9z M9 6.8h5v1H9z M9 8h5v1H9z M9 9.2h5v1H9z M9 10.4h5v1H9z M9 11.6h5v1H9z M9 12.8h5v1.2H9z',
  '12M': 'M2 2h5v12H2z M9 2h5v1H9z M9 3.1h5v1H9z M9 4.2h5v1H9z M9 5.3h5v1H9z M9 6.4h5v1H9z M9 7.5h5v1H9z M9 8.6h5v1H9z M9 9.7h5v1H9z M9 10.8h5v1H9z M9 11.9h5v1H9z M9 13h5v1H9z',
  '5B': 'M2 2h12v5H2z M2 9h3v5H2z M5 9h3v5H5z M8 9h3v5H8z M11 9h3v5h-3z',
  '6C': 'M2 2h2v12H2z M4 2h2v12H4z M6 2h2v12H6z M8 2h2v12H8z M10 2h2v12H10z M12 2h2v12h-2z',
  '7B': 'M2 2h4v5H2z M6 2h4v5H6z M10 2h4v5h-4z M2 9h3v5H2z M5 9h3v5H5z M8 9h3v5H8z M11 9h3v5h-3z',
  '8B': 'M2 2h3v6H2z M5 2h3v6H5z M8 2h3v6H8z M11 2h3v6h-3z M2 8h3v6H2z M5 8h3v6H5z M8 8h3v6H8z M11 8h3v6h-3z',
  '9T': 'M2 2h2.4v5H2z M4.4 2h2.4v5H4.4z M6.8 2h2.4v5H6.8z M9.2 2h2.4v5H9.2z M11.6 2h2.4v5h-2.4z M2 9h3v5H2z M5 9h3v5H5z M8 9h3v5H8z M11 9h3v5h-3z',
  '10B': 'M2 2h2.4v6H2z M4.4 2h2.4v6H4.4z M6.8 2h2.4v6H6.8z M9.2 2h2.4v6H9.2z M11.6 2h2.4v6h-2.4z M2 8h2.4v6H2z M4.4 8h2.4v6H4.4z M6.8 8h2.4v6H6.8z M9.2 8h2.4v6H9.2z M11.6 8h2.4v6h-2.4z',
  '11B': 'M2 2h4v4H2z M6 2h4v4H6z M10 2h4v4h-4z M2 6h3v4H2z M5 6h3v4H5z M8 6h3v4H8z M11 6h3v4h-3z M2 10h3v4H2z M5 10h3v4H5z M8 10h3v4H8z M11 10h3v4h-3z',
  '12C': 'M2 2h2v6H2z M4 2h2v6H4z M6 2h2v6H6z M8 2h2v6H8z M10 2h2v6H10z M12 2h2v6h-2z M2 8h2v6H2z M4 8h2v6H4z M6 8h2v6H6z M8 8h2v6H8z M10 8h2v6H10z M12 8h2v6h-2z',
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
  '4T': { id: '4T', slotCount: 4, label: '3 over wide bottom',       icon: ICONS['4T'], root: v(h(pane(0), pane(1), pane(2)), pane(3)) },
  '5T': { id: '5T', slotCount: 5, label: 'Three over two',           icon: ICONS['5T'], root: v(h(pane(0), pane(1), pane(2)), h(pane(3), pane(4))) },
  '5M': { id: '5M', slotCount: 5, label: 'Master + 4 stack',         icon: ICONS['5M'], root: h(pane(0), v(pane(1), pane(2), pane(3), pane(4))) },
  '6G': { id: '6G', slotCount: 6, label: '3 × 2 grid',               icon: ICONS['6G'], root: v(h(pane(0), pane(1), pane(2)), h(pane(3), pane(4), pane(5))) },
  '6M': { id: '6M', slotCount: 6, label: 'Master + 5 stack',         icon: ICONS['6M'], root: h(pane(0), v(pane(1), pane(2), pane(3), pane(4), pane(5))) },
  '7T': { id: '7T', slotCount: 7, label: '4 over 3',                 icon: ICONS['7T'], root: v(
    h(pane(0), pane(1), pane(2), pane(3)),
    h(pane(4), pane(5), pane(6)),
  ) },
  '7M': { id: '7M', slotCount: 7, label: 'Master + 6 stack',         icon: ICONS['7M'], root: h(
    pane(0),
    v(pane(1), pane(2), pane(3), pane(4), pane(5), pane(6)),
  ) },
  '8G': { id: '8G', slotCount: 8, label: '3 over 4',                 icon: ICONS['8G'], root: v(
    h(pane(0), pane(1), pane(2)),
    h(pane(3), pane(4), pane(5), pane(6), pane(7)),
  ) },
  '8M': { id: '8M', slotCount: 8, label: 'Master + 7 stack',         icon: ICONS['8M'], root: h(
    pane(0),
    v(pane(1), pane(2), pane(3), pane(4), pane(5), pane(6), pane(7)),
  ) },
  '9G': { id: '9G', slotCount: 9, label: '3 × 3 grid',               icon: ICONS['9G'], root: v(
    h(pane(0), pane(1), pane(2)),
    h(pane(3), pane(4), pane(5)),
    h(pane(6), pane(7), pane(8)),
  ) },
  '9M': { id: '9M', slotCount: 9, label: 'Master + 8 stack',         icon: ICONS['9M'], root: h(
    pane(0),
    v(pane(1), pane(2), pane(3), pane(4), pane(5), pane(6), pane(7), pane(8)),
  ) },
  '10G': { id: '10G', slotCount: 10, label: '4 over 4 + 2',          icon: ICONS['10G'], root: v(
    h(pane(0), pane(1), pane(2), pane(3)),
    h(pane(4), pane(5), pane(6), pane(7), pane(8), pane(9)),
  ) },
  '10M': { id: '10M', slotCount: 10, label: 'Master + 9 stack',      icon: ICONS['10M'], root: h(
    pane(0),
    v(pane(1), pane(2), pane(3), pane(4), pane(5), pane(6), pane(7), pane(8), pane(9)),
  ) },
  '11G': { id: '11G', slotCount: 11, label: '4 + 4 + 3',             icon: ICONS['11G'], root: v(
    h(pane(0), pane(1), pane(2), pane(3)),
    h(pane(4), pane(5), pane(6), pane(7)),
    h(pane(8), pane(9), pane(10)),
  ) },
  '11M': { id: '11M', slotCount: 11, label: 'Master + 10 stack',     icon: ICONS['11M'], root: h(
    pane(0),
    v(pane(1), pane(2), pane(3), pane(4), pane(5), pane(6), pane(7), pane(8), pane(9), pane(10)),
  ) },
  '12G': { id: '12G', slotCount: 12, label: '4 × 3 grid',            icon: ICONS['12G'], root: v(
    h(pane(0), pane(1), pane(2), pane(3)),
    h(pane(4), pane(5), pane(6), pane(7)),
    h(pane(8), pane(9), pane(10), pane(11)),
  ) },
  '12M': { id: '12M', slotCount: 12, label: 'Master + 11 stack',     icon: ICONS['12M'], root: h(
    pane(0),
    v(pane(1), pane(2), pane(3), pane(4), pane(5), pane(6), pane(7), pane(8), pane(9), pane(10), pane(11)),
  ) },
  '5B': { id: '5B', slotCount: 5, label: 'Wide top + 4 below',       icon: ICONS['5B'], root: v(
    pane(0),
    h(pane(1), pane(2), pane(3), pane(4)),
  ) },
  '6C': { id: '6C', slotCount: 6, label: 'Six columns',              icon: ICONS['6C'], root: h(
    pane(0), pane(1), pane(2), pane(3), pane(4), pane(5),
  ) },
  '7B': { id: '7B', slotCount: 7, label: '3 over 4',                 icon: ICONS['7B'], root: v(
    h(pane(0), pane(1), pane(2)),
    h(pane(3), pane(4), pane(5), pane(6)),
  ) },
  '8B': { id: '8B', slotCount: 8, label: '4 × 2 grid',               icon: ICONS['8B'], root: v(
    h(pane(0), pane(1), pane(2), pane(3)),
    h(pane(4), pane(5), pane(6), pane(7)),
  ) },
  '9T': { id: '9T', slotCount: 9, label: '5 over 4',                 icon: ICONS['9T'], root: v(
    h(pane(0), pane(1), pane(2), pane(3), pane(4)),
    h(pane(5), pane(6), pane(7), pane(8)),
  ) },
  '10B': { id: '10B', slotCount: 10, label: '5 × 2 grid',            icon: ICONS['10B'], root: v(
    h(pane(0), pane(1), pane(2), pane(3), pane(4)),
    h(pane(5), pane(6), pane(7), pane(8), pane(9)),
  ) },
  '11B': { id: '11B', slotCount: 11, label: '3 + 4 + 4',             icon: ICONS['11B'], root: v(
    h(pane(0), pane(1), pane(2)),
    h(pane(3), pane(4), pane(5), pane(6)),
    h(pane(7), pane(8), pane(9), pane(10)),
  ) },
  '12C': { id: '12C', slotCount: 12, label: '6 × 2 grid',            icon: ICONS['12C'], root: v(
    h(pane(0), pane(1), pane(2), pane(3), pane(4), pane(5)),
    h(pane(6), pane(7), pane(8), pane(9), pane(10), pane(11)),
  ) },
}

export function getPreset(id: LayoutId): LayoutPreset {
  const preset = PRESETS[id]
  if (!preset) throw new Error(`unknown layout id: ${id}`)
  return preset
}
