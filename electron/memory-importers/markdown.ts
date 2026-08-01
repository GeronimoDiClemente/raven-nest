// CLAUDE.md / AGENTS.md / MEMORY.md importer — §5.2.B. Read-only against every source;
// writes go through MemoryStore.save() so redaction, FTS and the mutation log all apply
// (§5.2 preamble: "All adapters are read-only against their sources and write through
// the normal memory-store path").
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { MemoryStore, deriveImportSyncId, computeContentIdentity } from '../memory-store'
import { isDeniedImportPath } from '../memory-redaction'
import { chunkMarkdown } from './chunker'

export interface MarkdownImportResult {
  filesScanned: number
  filesSkippedDuplicate: number
  filesSkippedDenied: number
  chunksImported: number
}

/**
 * Imports one markdown file's chunks into `projectKey`. Idempotent via
 * `source='import'` + `source_ref='{sourceLabel}:{absPath}#{topicKey}'` — re-running
 * updates existing rows in place instead of duplicating (§5.3 guard 1).
 */
export function importMarkdownFile(
  store: MemoryStore,
  filePath: string,
  projectKey: string,
  sourceLabel: string
): number {
  if (isDeniedImportPath(filePath) || !existsSync(filePath)) return 0
  const raw = readFileSync(filePath, 'utf8')
  const chunks = chunkMarkdown(raw, sourceLabel)
  const scope = 'personal' as const
  const type = 'pattern' as const
  for (const chunk of chunks) {
    // Content-derived identity (see deriveImportSyncId in memory-store.ts): the same
    // convention text imported from two machines under different absolute paths (or via
    // a different importer entirely) converges on one row instead of two, the same
    // cross-device guarantee the engram importer relies on. chunk.topicKey is part of the
    // seed (Finding 1 fix) — it's deterministic from headingPath/sourceLabel, so both
    // devices still derive the same sync_id for the same chunk.
    const { hash } = computeContentIdentity(chunk.title, chunk.content)
    store.save({
      projectKey,
      scope,
      topicKey: chunk.topicKey,
      type,
      title: chunk.title,
      content: chunk.content,
      source: 'import',
      sourceRef: `${sourceLabel}:${filePath}#${chunk.topicKey}`,
      syncId: deriveImportSyncId(projectKey, scope, type, hash, chunk.topicKey),
    })
  }
  return chunks.length
}

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function listMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.md'))
      .map((d) => join(dir, d.name))
  } catch {
    return []
  }
}

export interface MarkdownImportSources {
  ravenHomeDir: string
  /** Every Claude account dir discovered under .raven-nest/accounts/claude/*. */
  claudeAccountDirs: string[]
  /** Enrolled project roots (for per-repo CLAUDE.md/AGENTS.md), mapped to their project_key. */
  projectRoots: Array<{ rootPath: string; projectKey: string }>
  globalProjectKey: string
}

/**
 * Discovers and imports every markdown memory source per §5.2.B, deduping files whose
 * content is byte-identical (the common case: account CLAUDE.md files symlinked back to
 * the same global file) so a file shared by five accounts is imported once.
 */
export function importAllMarkdownSources(store: MemoryStore, sources: MarkdownImportSources): MarkdownImportResult {
  const result: MarkdownImportResult = { filesScanned: 0, filesSkippedDuplicate: 0, filesSkippedDenied: 0, chunksImported: 0 }
  const seenHashes = new Set<string>()

  const candidates: Array<{ path: string; projectKey: string; label: string }> = []

  const globalClaudeMd = join(sources.ravenHomeDir, '.claude', 'CLAUDE.md')
  if (existsSync(globalClaudeMd)) candidates.push({ path: globalClaudeMd, projectKey: sources.globalProjectKey, label: 'claude-md' })

  for (const accountDir of sources.claudeAccountDirs) {
    const accountClaudeMd = join(accountDir, '.claude', 'CLAUDE.md')
    if (existsSync(accountClaudeMd)) candidates.push({ path: accountClaudeMd, projectKey: sources.globalProjectKey, label: 'claude-md' })
    const memoryFiles = listMdFiles(join(accountDir, '.claude', 'memory'))
    for (const f of memoryFiles) candidates.push({ path: f, projectKey: sources.globalProjectKey, label: 'claude-memory' })
    const memoryMd = join(accountDir, '.claude', 'MEMORY.md')
    if (existsSync(memoryMd)) candidates.push({ path: memoryMd, projectKey: sources.globalProjectKey, label: 'claude-memory' })
  }

  for (const project of sources.projectRoots) {
    for (const name of ['CLAUDE.md', 'AGENTS.md']) {
      const path = join(project.rootPath, name)
      if (existsSync(path)) candidates.push({ path, projectKey: project.projectKey, label: name === 'CLAUDE.md' ? 'claude-md' : 'agents-md' })
    }
  }

  for (const candidate of candidates) {
    result.filesScanned += 1
    if (isDeniedImportPath(candidate.path)) { result.filesSkippedDenied += 1; continue }
    let stat
    try { stat = statSync(candidate.path) } catch { continue }
    if (!stat.isFile()) continue

    const hash = fileHash(candidate.path)
    if (seenHashes.has(hash)) { result.filesSkippedDuplicate += 1; continue }
    seenHashes.add(hash)

    result.chunksImported += importMarkdownFile(store, candidate.path, candidate.projectKey, candidate.label)
  }

  return result
}
