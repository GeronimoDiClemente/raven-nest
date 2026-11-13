// Donde vive el hilo y donde deja su contabilidad. Modulo aparte y chiquito para que los
// tests puedan usarlo sin arrastrar `main.ts` entero.
import { join } from 'path'
import type { VaultApplyPaths } from './vault-apply'

/** Ocultas para que Obsidian las ignore, igual que `.nest-vault/` en el vault personal. */
export const TEAM_THREAD_PATHS: VaultApplyPaths = {
  manifest: '.manifest.json',
  tombstones: '.tombstones.jsonl',
  readme: 'README.md',
}

/** Uno por worktree, completo (spec §3, decision 7). */
export function teamThreadRootDir(worktreePath: string): string {
  return join(worktreePath, '.nest', 'team')
}
