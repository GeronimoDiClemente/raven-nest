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
    if (actual.includes(POINTER_MARKER)) return 'already'

    const sep = actual === '' || actual.endsWith('\n') ? '' : '\n'
    writeFileSync(path, `${actual}${sep}\n${POINTER_LINE}\n`, 'utf8')
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
    if (!actual.includes(POINTER_MARKER)) return
    const limpio = actual
      .split('\n')
      .filter((linea) => !linea.includes(POINTER_MARKER))
      .join('\n')
      .replace(/\n{3,}$/, '\n')
    writeFileSync(path, limpio, 'utf8')
  } catch (err) {
    console.warn('[team-thread] no se pudo quitar el puntero de AGENTS.md', err)
  }
}
