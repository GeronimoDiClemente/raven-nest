// Orquesta el import de memorias externas (markdown de CLAUDE.md/proyectos + bases engram)
// contra el store local. Antes de esta pieza esto solo corria dentro del handler
// `memory:connect` de main.ts ("first-connect import", spec §5.1 paso 5) — atado a que el
// usuario conecte a Cloud. La Task 7 del hub (docs/superpowers/plans/
// 2026-09-03-memoria-por-cuenta-multi-dispositivo.md) necesita mostrarle a TODO usuario,
// incluido Free (que nunca conecta), cuantas memorias ya tiene — asi que esta misma logica
// tiene que poder correr en el arranque local, sin login. Extraida tal cual estaba, sin
// cambiar su comportamiento: best-effort en cada paso (un fallo en uno no aborta el resto).
import { basename } from 'path'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { MemoryStore } from './memory-store'
import { resolveProjectKey, GLOBAL_PROJECT_KEY } from './memory-project-key'
import { importAllMarkdownSources } from './memory-importers/markdown'
import { importEngramDatabase, discoverEngramDatabases } from './memory-importers/engram'

export interface LocalMemoryImportInput {
  ravenHomeDir: string
  /** `Object.values(localPathsStore.getAllLocalPaths())` — repos con carpeta local conocida en esta maquina. */
  localPathRepos: string[]
  /** `accountStore.list('claude').map((name) => accountStore.getDir('claude', name))`. */
  claudeAccountDirs: string[]
}

export function runLocalMemoryImport(store: MemoryStore, input: LocalMemoryImportInput): void {
  const globalKey = resolveProjectKey({})

  const knownRepoRoots: Array<{ path: string; projectKey: string; remoteUrl: string | null }> = []
  try {
    for (const localPath of input.localPathRepos) {
      if (!existsSync(localPath)) continue // stale entry — repo no longer on disk
      let remoteUrl: string | null = null
      try {
        remoteUrl = execSync('git remote get-url origin', { cwd: localPath, encoding: 'utf8', timeout: 3000 }).trim()
      } catch { /* no remote configured — resolveProjectKey falls back to the path hash */ }
      knownRepoRoots.push({ path: localPath, projectKey: resolveProjectKey({ remoteUrl, rootPath: localPath }), remoteUrl })
    }
  } catch (err) {
    console.warn('[memory-local-import] failed to enumerate known repo roots', err instanceof Error ? err.message : err)
  }

  try {
    for (const repo of knownRepoRoots) {
      store.ensureProject({
        projectKey: repo.projectKey,
        displayName: basename(repo.path) || repo.path,
        rootPath: repo.path,
        remoteUrl: repo.remoteUrl,
      })
    }
    store.ensureProject({ projectKey: globalKey, displayName: GLOBAL_PROJECT_KEY })
  } catch (err) {
    console.warn('[memory-local-import] failed to register known projects', err instanceof Error ? err.message : err)
  }

  try {
    importAllMarkdownSources(store, {
      ravenHomeDir: input.ravenHomeDir,
      claudeAccountDirs: input.claudeAccountDirs,
      projectRoots: knownRepoRoots.map((r) => ({ rootPath: r.path, projectKey: r.projectKey })),
      globalProjectKey: globalKey,
    })
  } catch (err) {
    console.warn('[memory-local-import] markdown import failed', err instanceof Error ? err.message : err)
  }

  try {
    // engram's `project` column is a lowercased folder basename (§5.2.A), never a full
    // path — key this map the same way so resolveProjectKeyForEngramProject can match it.
    const knownProjects = new Map(knownRepoRoots.map((r) => [basename(r.path).toLowerCase(), r.projectKey]))
    for (const dbPath of discoverEngramDatabases(input.ravenHomeDir, input.claudeAccountDirs)) {
      importEngramDatabase(store, dbPath, { knownProjects })
    }
  } catch (err) {
    console.warn('[memory-local-import] engram import failed', err instanceof Error ? err.message : err)
  }
}
