// Applies a VaultPlan to disk — the only vault module that touches `fs`, together with
// vault-config.ts and memory-readonly-reader.ts. See vault spec §7 (batching), §10 (edit
// detection needs live on-disk hashes) and §12.
import { createHash, randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, appendFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { VaultManifest, VaultManifestEntry, VaultPlan, VaultWarning } from './vault-plan'

const BATCH_SIZE = 200
const MANIFEST_REL_PATH = '.nest-vault/manifest.json'
const TOMBSTONES_REL_PATH = '.nest-vault/tombstones.jsonl'

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function abs(rootDir: string, relPath: string): string {
  return join(rootDir, ...relPath.split('/'))
}

/** Atomic write: `.tmp` + `rename`, so a crash mid-write never leaves a truncated `.md` (§13). */
function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, path)
}

export function readManifest(rootDir: string): VaultManifest {
  try {
    const raw = readFileSync(abs(rootDir, MANIFEST_REL_PATH), 'utf8')
    const data = JSON.parse(raw) as { entries?: Record<string, VaultManifestEntry> }
    return { entries: data.entries && typeof data.entries === 'object' ? data.entries : {} }
  } catch {
    return { entries: {} }
  }
}

function writeManifest(rootDir: string, manifest: VaultManifest): void {
  writeFileAtomic(abs(rootDir, MANIFEST_REL_PATH), JSON.stringify(manifest, null, 2))
}

function appendTombstones(rootDir: string, entries: Array<{ syncId: string; deletedAt: number; file: string }>): void {
  if (entries.length === 0) return
  const path = abs(rootDir, TOMBSTONES_REL_PATH)
  mkdirSync(dirname(path), { recursive: true })
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
  appendFileSync(path, lines, 'utf8')
}

/**
 * Reads every file the manifest currently tracks and hashes it, for `planVault`'s edit
 * detection — a path the manifest tracks but that no longer exists on disk (moved away by
 * a previous pass, or genuinely deleted by hand) is simply absent from the result, never
 * an error: `planVault` treats "no entry" as "nothing to compare", not as a conflict.
 */
export function computeOnDiskHashes(rootDir: string, manifest: VaultManifest): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of Object.values(manifest.entries)) {
    try {
      out[entry.filePath] = sha256(readFileSync(abs(rootDir, entry.filePath), 'utf8'))
    } catch {
      // Missing/unreadable — omitted on purpose, see doc comment above.
    }
  }
  return out
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

export interface VaultApplyResult {
  written: number
  moved: number
  deleted: number
  conflicts: number
  warnings: VaultWarning[]
}

/**
 * Applies `plan` to `rootDir` and returns the manifest that should be persisted for the
 * NEXT pass. Batches every fs-touching step by `BATCH_SIZE` with a `setImmediate` yield
 * between batches (§7) so a 10k-row full pass never blocks Electron main's event loop.
 */
export async function applyVaultPlan(rootDir: string, plan: VaultPlan): Promise<{ manifest: VaultManifest; result: VaultApplyResult }> {
  const manifest = readManifest(rootDir)
  const tombstoneEntries: Array<{ syncId: string; deletedAt: number; file: string }> = []
  let batchCount = 0
  const maybeYield = async (): Promise<void> => {
    batchCount += 1
    if (batchCount % BATCH_SIZE === 0) await yieldToEventLoop()
  }

  // Conflicts first: preserve the user's edited bytes before anything else touches that
  // path, and re-point the manifest at the fresh mirror we write alongside it.
  for (const c of plan.conflicts) {
    const original = readFileSync(abs(rootDir, c.filePath), 'utf8')
    writeFileAtomic(abs(rootDir, c.conflictPath), original)
    writeFileAtomic(abs(rootDir, c.freshPath), c.freshContent)
    if (c.filePath !== c.freshPath) {
      try { unlinkSync(abs(rootDir, c.filePath)) } catch { /* already gone */ }
    }
    manifest.entries[c.syncId] = { filePath: c.freshPath, sourceHash: c.freshSourceHash, fileHash: c.freshFileHash }
    await maybeYield()
  }

  for (const w of plan.writes) {
    writeFileAtomic(abs(rootDir, w.filePath), w.content)
    manifest.entries[w.syncId] = { filePath: w.filePath, sourceHash: w.sourceHash, fileHash: w.fileHash }
    await maybeYield()
  }

  for (const m of plan.moves) {
    const from = abs(rootDir, m.fromPath)
    const to = abs(rootDir, m.toPath)
    mkdirSync(dirname(to), { recursive: true })
    if (existsSync(from)) renameSync(from, to)
    const existing = manifest.entries[m.syncId]
    if (existing) manifest.entries[m.syncId] = { ...existing, filePath: m.toPath }
    await maybeYield()
  }

  for (const d of plan.deletes) {
    const path = abs(rootDir, d.filePath)
    try { unlinkSync(path) } catch { /* already gone */ }
    if (d.reason === 'tombstone') {
      tombstoneEntries.push({ syncId: d.syncId, deletedAt: Date.now(), file: d.filePath })
    }
    // A 'stale-path' delete fires alongside a fresh write at the row's new path (same
    // syncId) — do not drop that fresh manifest entry. Every other reason means the row
    // has nothing tracked going forward.
    if (d.reason !== 'stale-path') delete manifest.entries[d.syncId]
    await maybeYield()
  }

  for (const idx of plan.indexWrites) {
    writeFileAtomic(abs(rootDir, idx.filePath), idx.content)
    await maybeYield()
  }

  writeFileAtomic(abs(rootDir, 'README.md'), plan.readme)
  appendTombstones(rootDir, tombstoneEntries)
  writeManifest(rootDir, manifest)

  return {
    manifest,
    result: {
      written: plan.writes.length,
      moved: plan.moves.length,
      deleted: plan.deletes.length,
      conflicts: plan.conflicts.length,
      warnings: plan.warnings,
    },
  }
}
