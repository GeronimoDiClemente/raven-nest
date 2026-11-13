// Spec §11 riesgo 2 + §4.5 (los conflictos van en la fila de estado, no escondidos en una
// carpeta). Lectura pura de disco: no regenera nada, no escribe nada.
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import { readManifest, DEFAULT_APPLY_PATHS } from './integrations/vault-apply'

/** El directorio donde applyVaultPlan preserva los bytes editados a mano (vault-hash.ts). */
const CONFLICTS_DIR = '_conflicts'

export interface VaultHealth {
  noteCount: number
  conflictCount: number
  /** mtime del manifiesto: la ultima vez que el vault se regenero de verdad. */
  lastGeneratedAt: number | null
}

export function readVaultHealth(rootDir: string): VaultHealth {
  // readManifest ya devuelve `{ entries: {} }` ante cualquier fallo de lectura o de parseo.
  const manifest = readManifest(rootDir, DEFAULT_APPLY_PATHS)
  const noteCount = Object.keys(manifest.entries).length

  let lastGeneratedAt: number | null = null
  try {
    lastGeneratedAt = statSync(join(rootDir, ...DEFAULT_APPLY_PATHS.manifest.split('/'))).mtimeMs
  } catch {
    lastGeneratedAt = null
  }

  let conflictCount = 0
  try {
    conflictCount = readdirSync(join(rootDir, CONFLICTS_DIR)).filter((f) => f.endsWith('.md')).length
  } catch {
    conflictCount = 0
  }

  return { noteCount, conflictCount, lastGeneratedAt }
}
