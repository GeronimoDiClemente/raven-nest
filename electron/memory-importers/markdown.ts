// CLAUDE.md / AGENTS.md / MEMORY.md importer — §5.2.B. Read-only against every source;
// writes go through MemoryStore.save() so redaction, FTS and the mutation log all apply
// (§5.2 preamble: "All adapters are read-only against their sources and write through
// the normal memory-store path").
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { basename, join } from 'path'
import { createHash } from 'crypto'
import { MemoryStore, deriveImportSyncId, computeContentIdentity } from '../memory-store'
import { isDeniedImportPath } from '../memory-redaction'
import { chunkMarkdown, chunkMemoryNote } from './chunker'

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
  // Dos formatos distintos bajo el mismo importer. Un CLAUDE.md es un documento largo que
  // hay que cortar en secciones; una nota de `memory/` es UN hecho por archivo con
  // frontmatter, y cortarla por `##` la tira entera (60 de 63 archivos reales no tienen
  // ninguno). El label ya distingue cuál es cuál.
  const chunks = sourceLabel === 'claude-memory'
    ? chunkMemoryNote(raw, sourceLabel, basename(filePath))
    : chunkMarkdown(raw, sourceLabel)
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

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
}

/**
 * El nombre que Claude Code le da a la carpeta de un proyecto dentro de
 * `{accountDir}/.claude/projects/`: el path absoluto con **todo lo que no es alfanumérico
 * convertido en `-`**. Verificado el 2026-09-03 contra cuatro carpetas reales de esta
 * máquina, incluida una con `@` y `,` en el nombre.
 *
 * La función va en un solo sentido a propósito: del slug NO se puede volver al path (un `-`
 * real y un `/` producen el mismo carácter). Por eso el matcheo se hace slugificando los
 * roots que ya conocemos, nunca parseando el slug.
 */
export function claudeProjectSlug(rootPath: string): string {
  return rootPath.replace(/[^A-Za-z0-9]/g, '-')
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

    // Donde viven de verdad. `{accountDir}/.claude/memory/` de arriba es una ruta que este
    // importer buscaba y que Claude Code no usa: las memorias van en una carpeta POR
    // PROYECTO, `{accountDir}/.claude/projects/<slug>/memory/`. Medido en la Mac del
    // 2026-09-03: cero archivos en la vieja, 63 en la nueva — o sea que el import del primer
    // connect traía nada. La ruta vieja se conserva por si alguna versión la usó.
    //
    // Y como cada carpeta ES un proyecto, sus memorias van al project_key de ese repo en vez
    // de amontonarse en `__global__`. El slug no se parsea (no se puede: es ambiguo); se
    // slugifican los roots conocidos y se compara.
    const porSlug = new Map(sources.projectRoots.map((p) => [claudeProjectSlug(p.rootPath), p.projectKey]))
    const proyectosDir = join(accountDir, '.claude', 'projects')
    for (const slug of listDirs(proyectosDir)) {
      // Un repo que el usuario no enroló todavía no tiene project_key propio: sus memorias
      // van a global antes que perderse.
      const projectKey = porSlug.get(slug) ?? sources.globalProjectKey
      for (const f of listMdFiles(join(proyectosDir, slug, 'memory'))) {
        candidates.push({ path: f, projectKey, label: 'claude-memory' })
      }
    }
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

    // La clave del dedupe lleva el project_key. Sin él, dos proyectos con un `MEMORY.md` de
    // contenido idéntico perdían uno de los dos — el dedupe existe para el CLAUDE.md global
    // symlinkeado en cada cuenta, que siempre cae en el mismo project_key, así que sumarle
    // el proyecto no afloja ese caso y deja de tirar memorias de proyectos distintos.
    const hash = `${fileHash(candidate.path)}|${candidate.projectKey}`
    if (seenHashes.has(hash)) { result.filesSkippedDuplicate += 1; continue }
    seenHashes.add(hash)

    result.chunksImported += importMarkdownFile(store, candidate.path, candidate.projectKey, candidate.label)
  }

  return result
}
