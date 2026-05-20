import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs'
import { ravenHome } from './raven-home'

interface PersistedState {
  paths: Record<string, string>
  migrations: Record<string, string>
}

function emptyState(): PersistedState {
  return { paths: {}, migrations: {} }
}

function fileFor(): { dir: string; file: string } {
  const dir = join(ravenHome(), '.raven-nest')
  return { dir, file: join(dir, 'local-paths.json') }
}

function load(): PersistedState {
  const { dir, file } = fileFor()
  if (!existsSync(file)) return emptyState()
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (err) {
    console.warn('[local-paths-store] read failed, starting fresh:', (err as Error).message)
    return emptyState()
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      paths: (parsed.paths && typeof parsed.paths === 'object') ? parsed.paths as Record<string, string> : {},
      migrations: (parsed.migrations && typeof parsed.migrations === 'object') ? parsed.migrations as Record<string, string> : {},
    }
  } catch {
    try {
      const bak = join(dir, `local-paths.${Date.now()}.corrupt.bak`)
      renameSync(file, bak)
      console.warn(`[local-paths-store] corrupted JSON, moved to ${bak}`)
    } catch (err) {
      console.warn('[local-paths-store] failed to quarantine corrupted file:', (err as Error).message)
    }
    return emptyState()
  }
}

function persist(state: PersistedState): void {
  const { dir, file } = fileFor()
  mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(state))
  renameSync(tmp, file)
}

export class LocalPathsStore {
  getLocalPath(repoId: string): string | null {
    return load().paths[repoId] ?? null
  }

  setLocalPath(repoId: string, path: string): void {
    const state = load()
    state.paths[repoId] = path
    persist(state)
  }

  deleteLocalPath(repoId: string): void {
    const state = load()
    if (!(repoId in state.paths)) return
    delete state.paths[repoId]
    persist(state)
  }

  getAllLocalPaths(): Record<string, string> {
    return { ...load().paths }
  }

  getMigrationFlag(key: string): string | null {
    return load().migrations[key] ?? null
  }

  setMigrationFlag(key: string, value: string): void {
    const state = load()
    state.migrations[key] = value
    persist(state)
  }
}
