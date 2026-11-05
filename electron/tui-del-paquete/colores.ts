// Los colores de la TUI: los mismos 16 ANSI que el CLI (`estilo-del-paquete.ts`), en los
// nombres que entiende Ink. Con NO_COLOR no se pinta nada (https://no-color.org).
import type { GrupoDeTipo } from '../estilo-del-paquete'
import type { Marca } from '../status-del-paquete'

export function hayColor(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.NO_COLOR
}

/** El color si se pinta; `undefined` (el del terminal) si no. */
export const pintar = (activo: boolean, color: string): string | undefined => (activo ? color : undefined)

export const COLOR_DE_GRUPO: Record<GrupoDeTipo, string> = {
  decisions: 'blue', fixes: 'yellow', conventions: 'magenta', discoveries: 'green', sessions: 'gray',
}

export const MARCA: Record<Marca, { simbolo: string; color: string }> = {
  ok: { simbolo: '✓', color: 'green' },
  aviso: { simbolo: '!', color: 'yellow' },
  pendiente: { simbolo: '●', color: 'yellow' },
  nada: { simbolo: '·', color: 'gray' },
  falla: { simbolo: '✗', color: 'red' },
}
