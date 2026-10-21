// Preferencias de Memories (spec "Memory settings como pestaña" §6). Viven en AppSettings y se
// guardan con window.settings: por máquina, sobreviven al reinicio. Puro: el hook
// useMemoryPrefs es el único que habla con el preload.
import type { ColorBy } from './memory-graph-visuals'

export type EtiquetasDelGrafo = 'always' | 'zoom' | 'hover'

export interface PrefsDelEditor { livePreview: boolean; readableWidth: boolean; spellcheck: boolean; fontSize: number }

/** Lo que "Remember graph filters" guarda (decisión D14): el foco no, es navegación. */
export interface FiltrosGuardados {
  colorBy: ColorBy
  hideOrphans: boolean
  tiposOcultos: string[]
  escalaDeNodo: number
  distanciaDeLinks: number
  /** «Guessed links»: las aristas inferidas se ven. */
  inferidas: boolean
}

export interface PrefsDelGrafo { remember: boolean; labels: EtiquetasDelGrafo; animate: boolean; filtros?: FiltrosGuardados }
export interface MemoryPrefs { editor: PrefsDelEditor; graph: PrefsDelGrafo }

export const TAMANOS_DE_LETRA = [12, 13, 14, 15, 16, 17, 18] as const

export const DEFAULT_MEMORY_PREFS: MemoryPrefs = {
  // 13 = --fs, el cuerpo de la UI: el tamaño que el editor tenía antes de esta preferencia.
  editor: { livePreview: true, readableWidth: true, spellcheck: false, fontSize: 13 },
  graph: { remember: true, labels: 'zoom', animate: true },
}

/** Los valores de arranque de useGraphFilters y del interruptor de inferidas del workspace. */
export const FILTROS_POR_DEFECTO: FiltrosGuardados = {
  colorBy: 'type', hideOrphans: true, tiposOcultos: [], escalaDeNodo: 1, distanciaDeLinks: 50, inferidas: true,
}

const COLOR_BY: readonly ColorBy[] = ['type', 'project', 'tag']
const ETIQUETAS: readonly EtiquetasDelGrafo[] = ['always', 'zoom', 'hover']

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
// Los rangos son los de los sliders de GraphFiltersPanel: un valor de afuera no se dibuja.
const enRango = (v: unknown, d: number, min: number, max: number): number =>
  (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : d)

export function normalizarFiltros(raw: unknown): FiltrosGuardados | undefined {
  if (!esObjeto(raw)) return undefined
  const d = FILTROS_POR_DEFECTO
  return {
    colorBy: COLOR_BY.includes(raw.colorBy as ColorBy) ? (raw.colorBy as ColorBy) : d.colorBy,
    hideOrphans: bool(raw.hideOrphans, d.hideOrphans),
    tiposOcultos: Array.isArray(raw.tiposOcultos) ? raw.tiposOcultos.filter((x): x is string => typeof x === 'string') : [],
    escalaDeNodo: enRango(raw.escalaDeNodo, d.escalaDeNodo, 0.5, 2),
    distanciaDeLinks: enRango(raw.distanciaDeLinks, d.distanciaDeLinks, 20, 120),
    inferidas: bool(raw.inferidas, d.inferidas),
  }
}

/** Merge contra los defaults, campo por campo: un settings.json de una versión vieja (sin un
 *  campo nuevo) o tocado a mano no rompe nada ni pierde lo que sí es válido. */
export function normalizarMemoryPrefs(raw: unknown): MemoryPrefs {
  const r = esObjeto(raw) ? raw : {}
  const e = esObjeto(r.editor) ? r.editor : {}
  const g = esObjeto(r.graph) ? r.graph : {}
  const de = DEFAULT_MEMORY_PREFS.editor
  const dg = DEFAULT_MEMORY_PREFS.graph
  const fontSize = typeof e.fontSize === 'number' && (TAMANOS_DE_LETRA as readonly number[]).includes(e.fontSize) ? e.fontSize : de.fontSize
  const filtros = normalizarFiltros(g.filtros)
  return {
    editor: {
      livePreview: bool(e.livePreview, de.livePreview),
      readableWidth: bool(e.readableWidth, de.readableWidth),
      spellcheck: bool(e.spellcheck, de.spellcheck),
      fontSize,
    },
    graph: {
      remember: bool(g.remember, dg.remember),
      labels: ETIQUETAS.includes(g.labels as EtiquetasDelGrafo) ? (g.labels as EtiquetasDelGrafo) : dg.labels,
      animate: bool(g.animate, dg.animate),
      ...(filtros ? { filtros } : {}),
    },
  }
}

export function conFiltros(p: MemoryPrefs, filtros: FiltrosGuardados | undefined): MemoryPrefs {
  const { filtros: _anteriores, ...resto } = p.graph
  return { ...p, graph: filtros ? { ...resto, filtros } : resto }
}
