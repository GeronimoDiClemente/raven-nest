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
