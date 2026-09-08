// Una linea en AGENTS.md (o CLAUDE.md) apuntando al hilo del equipo. Spec §10.2.
//
// AGENTS.md esta bajo la Linux Foundation y lo soportan ~25 herramientas; con esta linea
// el hilo pasa a ser alcanzable por Cursor, Codex, Copilot, Zed y Aider, no solo por los
// CLIs donde provisionamos hooks.
//
// Reglas, porque este archivo es del USUARIO y esta versionado: una sola linea, con
// marcador para poder reconocerla, idempotente, y NO se crea el archivo si no existe.
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export const POINTER_MARKER = '<!-- nest:team-thread -->'

const POINTER_LINE = `${POINTER_MARKER} El contexto vivo del equipo para este repo esta en \`.nest/team/_index.md\` — leelo antes de empezar.`

const CANDIDATES = ['AGENTS.md', 'CLAUDE.md'] as const

function targetFile(worktreePath: string): string | null {
  for (const name of CANDIDATES) {
    const p = join(worktreePath, name)
    if (existsSync(p)) return p
  }
  return null
}

function hasPointerLine(text: string): boolean {
  return text.split('\n').some((linea) => linea.trim() === POINTER_LINE)
}

/**
 * Best-effort de punta a punta: que no se pueda escribir el puntero NUNCA puede impedir
 * que se escriba el hilo, que es lo que el usuario pidio. Mismo criterio que
 * `handoff.ts:excluirNestDelRepo`.
 */
export function ensureAgentsPointer(worktreePath: string): 'written' | 'already' | 'skipped' {
  try {
    const path = targetFile(worktreePath)
    if (!path) return 'skipped'

    const actual = readFileSync(path, 'utf8')
    if (hasPointerLine(actual)) return 'already'

    // Agregar el POINTER_LINE preservando si el original tenia trailing newline.
    // Si actual termina en \n o esta vacio: NO agregar separador, el \n ya esta.
    // Si actual NO termina en \n: agregar \n para separar, luego otro \n antes del POINTER_LINE.
    // Esto permite que remove() distinga basado en si hay linea vacia antes del POINTER_LINE.
    const prefix = actual === '' || actual.endsWith('\n') ? '' : '\n'
    const sep = actual === '' || actual.endsWith('\n') ? '' : '\n'
    writeFileSync(path, `${actual}${prefix}${sep}${POINTER_LINE}\n`, 'utf8')
    return 'written'
  } catch (err) {
    console.warn('[team-thread] no se pudo escribir el puntero en AGENTS.md', err)
    return 'skipped'
  }
}

export function removeAgentsPointer(worktreePath: string): void {
  try {
    const path = targetFile(worktreePath)
    if (!path) return
    const actual = readFileSync(path, 'utf8')
    if (!hasPointerLine(actual)) return

    const lines = actual.split('\n')
    const pointerIdx = lines.findIndex((l) => l.trim() === POINTER_LINE)

    // Detectar si el original tenia trailing newline basado en la posicion del POINTER_LINE:
    // - Si pointerIdx es 1: no hay linea vacia antes (original tenia newline)
    // - Si pointerIdx es 2+ y hay linea vacia antes: original no tenia newline
    const hadOriginalNewline = pointerIdx > 0 && (pointerIdx === 1 || lines[pointerIdx - 1] !== '')

    let limpio = lines
      .filter((linea) => linea.trim() !== POINTER_LINE)
      .join('\n')

    // Colapsar multiples newlines al final (artefacto del filter)
    limpio = limpio.replace(/\n{2,}$/, '\n')

    // Restaurar el trailing newline original: si el original no tenia, remover el final
    if (!hadOriginalNewline && limpio.endsWith('\n')) {
      limpio = limpio.slice(0, -1)
    }

    writeFileSync(path, limpio, 'utf8')
  } catch (err) {
    console.warn('[team-thread] no se pudo quitar el puntero de AGENTS.md', err)
  }
}
