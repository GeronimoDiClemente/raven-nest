import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export function makeTmpDir(prefix = 'raven-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function cleanupTmp(path: string): void {
  try { rmSync(path, { recursive: true, force: true }) } catch {}
}
