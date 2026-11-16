// Los colores de la TUI, en los nombres de los 16 ANSI que entiende Ink. El de cada tipo es
// el de la app; el del estado, el del CLI. Con NO_COLOR no se pinta nada (https://no-color.org).
import type { ObservationType } from '../memory-protocol'
import type { Marca } from '../status-del-paquete'

export function hayColor(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.NO_COLOR
}

/** El color si se pinta; `undefined` (el del terminal) si no. */
export const pintar = (activo: boolean, color: string): string | undefined => (activo ? color : undefined)

/**
 * El color de cada tipo: el MISMO índice ANSI que la pantalla Memories de la app
 * (`MEMORY_TYPE_ANSI` en `src/lib/memory-type-legend.ts`). En una terminal de Nest el índice
 * sale del mismo tema que usa la app, así que el tipo se ve del mismo color en los dos lados.
 */
export const COLOR_DE_TIPO: Record<ObservationType, string> = {
  decision: 'blue', bugfix: 'red', architecture: 'magenta', discovery: 'cyan', pattern: 'green',
  handoff: 'yellow', config: 'gray', preference: 'gray', session: 'gray',
}

/** El orden de la leyenda de la app (`MEMORY_TYPES_IN_LEGEND_ORDER`). */
export const ORDEN_DE_TIPOS: ObservationType[] = [
  'decision', 'bugfix', 'architecture', 'discovery', 'pattern', 'handoff', 'config', 'preference', 'session',
]

/** Un tipo que no está en la leyenda no inventa color, como en la app. */
export const colorDeTipo = (tipo: string): string => COLOR_DE_TIPO[tipo as ObservationType] ?? 'gray'

/**
 * El agente que escribió la memoria (`originAi`), con el color de marca de su logo en la app
 * (`src/components/AILogos.tsx`). Es la excepción de marca de un tercero, como en la app.
 */
const PROVEEDORES: Record<string, { nombre: string; color: string }> = {
  claude: { nombre: 'Claude', color: '#D97757' },
  codex: { nombre: 'Codex', color: '#22C55E' },
  gemini: { nombre: 'Gemini', color: '#3186FF' },
  copilot: { nombre: 'Copilot', color: '#0D91E1' },
  opencode: { nombre: 'OpenCode', color: '#FFFFFF' },
  deepseek: { nombre: 'DeepSeek', color: '#4D6BFE' },
  grok: { nombre: 'Grok', color: '#E8E8E8' },
  qwen: { nombre: 'Qwen', color: '#6950EF' },
  cursor: { nombre: 'Cursor', color: '#D4D4D4' },
}

/** Un agente sin logo en la app va con su nombre tal cual y sin color. */
export function proveedor(ai: string): { nombre: string; color: string | null } {
  return PROVEEDORES[ai] ?? { nombre: ai, color: null }
}

/** `Decision`, `Bugfix`…: la etiqueta de la app. */
export const etiquetaDeTipo = (tipo: string): string => tipo.charAt(0).toUpperCase() + tipo.slice(1)

export const MARCA: Record<Marca, { simbolo: string; color: string }> = {
  ok: { simbolo: '✓', color: 'green' },
  aviso: { simbolo: '!', color: 'yellow' },
  pendiente: { simbolo: '●', color: 'yellow' },
  nada: { simbolo: '·', color: 'gray' },
  falla: { simbolo: '✗', color: 'red' },
}
