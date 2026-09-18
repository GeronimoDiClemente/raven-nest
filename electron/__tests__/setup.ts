// Shared test helpers for electron-side tests.
// Registered as `setupFiles` in vitest.config.ts so the module is preloaded
// in every test worker; tests still need to `import { makeTmpDir } from './setup'`
// to use the helpers (these are exports, not globals).
import { mkdtempSync, rmSync, realpathSync } from 'fs'
import { usarAbridorPorDefecto, usarAbridorDeLecturaPorDefecto } from '../sqlite-motor'
import { abrirConBetterSqlite3, abrirSoloLecturaConBetterSqlite3 } from '../sqlite-better'

// Los tests construyen `new MemoryStore(path)` sin pasar abridor —88 lugares— y esperan el
// motor nativo, que es el que corre en la app.
//
// Se importa `sqlite-motor` y NO `memory-store`: importar el store acá lo carga antes de que
// un test pueda instalar su `vi.mock('fs')`, y el módulo se queda con el `fs` real. Eso rompió
// tres tests de migración que simulan fallos de `rename` — pasaban a no ver nunca el fallo.
usarAbridorPorDefecto(abrirConBetterSqlite3)
usarAbridorDeLecturaPorDefecto(abrirSoloLecturaConBetterSqlite3)
import { tmpdir } from 'os'
import { join } from 'path'

export function makeTmpDir(prefix = 'raven-test-'): string {
  // realpathSync resolves symlinks: on macOS os.tmpdir() is `/var/folders/...`
  // which is a symlink to `/private/var/folders/...`. `git worktree list`
  // reports the resolved realpath, so without this the store keys (from git)
  // wouldn't match the path the test holds, and hydrateFromGit lookups return
  // null.
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)))
}

export function cleanupTmp(path: string): void {
  try { rmSync(path, { recursive: true, force: true }) }
  catch (e) { console.warn(`cleanupTmp(${path}) failed:`, e) }
}
