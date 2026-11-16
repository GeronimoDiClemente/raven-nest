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
  return text.split('\n').some((linea) => linea.trim().startsWith(POINTER_MARKER))
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

    // Agregar el POINTER_LINE:
    // - Si actual termina en \n: escribir actual + POINTER_LINE + \n (sin separador)
    // - Si actual NO termina en \n: escribir actual + \n + POINTER_LINE + \n
    // Round-trip es byte-exacto para archivos CON newline final (el caso comun).
    // Para archivos sin newline final se agrega uno (normalizacion aceptable).
    const sep = actual === '' || actual.endsWith('\n') ? '' : '\n'
    writeFileSync(path, `${actual}${sep}${POINTER_LINE}\n`, 'utf8')
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

    // Sacar exactamente la linea del puntero, nada mas. Zero heuristica, zero inferencia.
    const limpio = actual
      .split('\n')
      .filter((linea) => !linea.trim().startsWith(POINTER_MARKER))
      .join('\n')

    writeFileSync(path, limpio, 'utf8')
  } catch (err) {
    console.warn('[team-thread] no se pudo quitar el puntero de AGENTS.md', err)
  }
}
