// Settings del hilo de equipo, por proyecto. Un solo JSON con un objeto por projectKey.
// El default es apagado a proposito (spec §3, decision 2): compartir es opt-in.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { ObservationType } from '../memory-protocol'
import { DEFAULT_THREAD_TYPES } from './team-thread-plan'

// Mismo patron que `accountSegment` en vault-config.ts (privada ahi, replicada aca a
// proposito: son 3 lineas triviales y exportarla obligaria a tocar un modulo del vault
// que no es de esta task).
function accountSegment(userId: string | null): string {
  return userId && userId.trim() ? userId : '_local'
}

/** `{ravenHome}/.raven-nest/team-thread-settings/<account>.json` — un archivo por cuenta,
 *  mismo layout que `vaultSettingsPath`. */
export function teamThreadSettingsPath(ravenHomeDir: string, userId: string | null): string {
  return join(ravenHomeDir, '.raven-nest', 'team-thread-settings', `${accountSegment(userId)}.json`)
}

export interface TeamThreadSettings {
  enabled: boolean
  includedTypes: ObservationType[]
  /** La linea en AGENTS.md/CLAUDE.md. Es el unico artefacto que toca un archivo
   *  versionado del usuario, por eso tiene su propio interruptor (spec §10.2). */
  writeAgentsPointer: boolean
}

function defaults(): TeamThreadSettings {
  return { enabled: false, includedTypes: [...DEFAULT_THREAD_TYPES], writeAgentsPointer: true }
}

type Archivo = Record<string, Partial<TeamThreadSettings>>

function validarSettings(data: unknown): Partial<TeamThreadSettings> {
  if (!data || typeof data !== 'object') return {}
  const obj = data as Record<string, unknown>
  const result: Partial<TeamThreadSettings> = {}

  if (typeof obj.enabled === 'boolean') {
    result.enabled = obj.enabled
  }

  if (typeof obj.writeAgentsPointer === 'boolean') {
    result.writeAgentsPointer = obj.writeAgentsPointer
  }

  if (Array.isArray(obj.includedTypes) && obj.includedTypes.every((v) => typeof v === 'string')) {
    result.includedTypes = obj.includedTypes as ObservationType[]
  }

  return result
}

function leerArchivo(path: string): Archivo {
  try {
    const raw = readFileSync(path, 'utf8')
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== 'object') return {}
    const archivo = data as Record<string, unknown>
    const resultado: Archivo = {}
    for (const [key, value] of Object.entries(archivo)) {
      resultado[key] = validarSettings(value)
    }
    return resultado
  } catch {
    return {}
  }
}

export function loadTeamThreadSettings(path: string, projectKey: string): TeamThreadSettings {
  return { ...defaults(), ...(leerArchivo(path)[projectKey] ?? {}) }
}

/**
 * Espejo de `TEAM_SCOPE_PLANS` de server/src/push.ts. El servidor sigue siendo el que
 * manda (§9.3: lo que se chequea solo en el cliente no esta chequeado); esto existe para
 * que prender el toggle NO produzca filas que el servidor va a rechazar con
 * `team_scope_not_allowed` mientras el usuario ve el hilo local poblado y cree que
 * compartio (I1 de la review final de rama).
 *
 * `undefined` = todavia no hubo una respuesta de `status()` que diga el plan. En ese caso
 * NO se bloquea: no saber no es lo mismo que saber que no. El servidor rechaza igual y la
 * fila queda personal, que es el estado de hoy — pero no se le niega al usuario una accion
 * legitima porque la app arranco hace 3 segundos.
 */
export function planAllowsTeamSharing(plan: string | undefined | null): boolean {
  if (plan === undefined || plan === null || plan === '') return true
  return plan === 'team' || plan === 'enterprise'
}

/**
 * Los projectKeys con el hilo PRENDIDO. Es el gate barato del poll de 60s y de la
 * reconciliacion al arranque (spec §8.1): leer un JSON chico es mucho mas barato que
 * enumerar worktrees y preguntarle a git el remote de cada repo, y con el hilo apagado en
 * todos lados —el estado por default— esos dos disparadores no hacen nada mas que esto.
 */
export function enabledTeamThreadProjectKeys(path: string): string[] {
  return Object.entries(leerArchivo(path))
    .filter(([, s]) => s.enabled === true)
    .map(([projectKey]) => projectKey)
}

export function saveTeamThreadSettings(
  path: string,
  projectKey: string,
  patch: Partial<TeamThreadSettings>,
): TeamThreadSettings {
  const archivo = leerArchivo(path)
  const merged: TeamThreadSettings = { ...defaults(), ...(archivo[projectKey] ?? {}), ...patch }
  archivo[projectKey] = merged
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(archivo, null, 2), 'utf8')
  return merged
}
