// Shared test helpers for electron-side tests.
// Registered as `setupFiles` in vitest.config.ts so the module is preloaded
// in every test worker; tests still need to `import { makeTmpDir } from './setup'`
// to use the helpers (these are exports, not globals).
import { mkdtempSync, rmSync, realpathSync } from 'fs'
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
