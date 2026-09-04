// La Task 7 del hub (docs/superpowers/plans/2026-09-03-memoria-por-cuenta-multi-dispositivo.md)
// exige mostrar "importamos N memorias de M proyectos" a TODO usuario, incluido Free — que
// nunca conecta a Cloud. Antes de esta pieza, `importAllMarkdownSources` + el import de engram
// solo corrían dentro del handler `memory:connect` de main.ts. `runLocalMemoryImport` es esa
// misma orquestación, extraída para poder llamarla también en el arranque local, sin login.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryStore } from '../memory-store'
import { GLOBAL_PROJECT_KEY } from '../memory-project-key'
import { runLocalMemoryImport } from '../memory-local-import'

describe('runLocalMemoryImport', () => {
  let dir: string
  let store: MemoryStore

  beforeEach(() => {
    dir = makeTmpDir('raven-local-import-')
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('registra el proyecto global aunque no haya ningun repo ni cuenta conocidos', () => {
    runLocalMemoryImport(store, { ravenHomeDir: dir, localPathRepos: [], claudeAccountDirs: [] })

    const keys = store.listProjects().map((p) => p.projectKey)
    expect(keys).toContain(GLOBAL_PROJECT_KEY)
  })

  it('importa un CLAUDE.md existente sin necesitar login/connect', () => {
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(
      join(dir, '.claude', 'CLAUDE.md'),
      '## Preferencia\nUsar pnpm workspaces en todos los proyectos nuevos del equipo.\n'
    )

    expect(store.count()).toBe(0)
    runLocalMemoryImport(store, { ravenHomeDir: dir, localPathRepos: [], claudeAccountDirs: [] })

    expect(store.count()).toBeGreaterThan(0)
  })
})
