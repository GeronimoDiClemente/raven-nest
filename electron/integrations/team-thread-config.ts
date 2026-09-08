// Settings del hilo de equipo, por proyecto. Un solo JSON con un objeto por projectKey.
// El default es apagado a proposito (spec §3, decision 2): compartir es opt-in.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { ObservationType } from '../memory-protocol'
import { DEFAULT_THREAD_TYPES } from './team-thread-plan'

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

function leerArchivo(path: string): Archivo {
  try {
    const raw = readFileSync(path, 'utf8')
    const data = JSON.parse(raw) as unknown
    return data && typeof data === 'object' ? (data as Archivo) : {}
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
