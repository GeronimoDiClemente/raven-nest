// Shared test helpers for electron-side tests.
// Registered as `setupFiles` in vitest.config.ts so the module is preloaded
// in every test worker; tests still need to `import { makeTmpDir } from './setup'`
// to use the helpers (these are exports, not globals).
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export function makeTmpDir(prefix = 'raven-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function cleanupTmp(path: string): void {
  try { rmSync(path, { recursive: true, force: true }) }
  catch (e) { console.warn(`cleanupTmp(${path}) failed:`, e) }
}
