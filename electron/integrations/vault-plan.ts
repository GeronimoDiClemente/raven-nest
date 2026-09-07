// The heart of the vault (§3.3): turns `MemoryRecord[]` + the previous manifest into a
// plan of filesystem effects, without touching `fs` itself. Pure, so this is where the
// bulk of the tests live (vault spec §13).
import { createHash } from 'crypto'
import { redact } from '../memory-redaction'
import type { MemoryProject, MemoryRecord } from './memory-port'
import { projectFolderName, resolveVaultFileNames } from './vault-naming'
import { renderNote, scrubSourceRef, type NoteContext } from './vault-note'

export interface VaultManifestEntry {
  filePath: string
  /** `record.contentHash` as of the last write — decides whether a row needs re-rendering at all. */
  sourceHash: string
  /** sha256 of the exact bytes written to `filePath` — compared against the live on-disk hash for edit detection (§10). */
  fileHash: string
}

export interface VaultManifest {
  entries: Record<string, VaultManifestEntry>
}

export function emptyManifest(): VaultManifest {
  return { entries: {} }
}

export interface VaultConfig {
  includeSuperseded: boolean
  includeTeamScope: boolean
}

export interface VaultWrite {
  syncId: string
  filePath: string
  content: string
  fileHash: string
  sourceHash: string
}

export interface VaultMove {
  syncId: string
  fromPath: string
  toPath: string
}

export type VaultDeleteReason = 'tombstone' | 'excluded' | 'stale-path' | 'disabled-project'

export interface VaultDelete {
  syncId: string
  filePath: string
  reason: VaultDeleteReason
}

export interface VaultConflict {
  syncId: string
  /** Where the user's edited file currently lives — vault-apply moves ITS bytes to `conflictPath`. */
  filePath: string
  conflictPath: string
  freshContent: string
  freshFileHash: string
  freshSourceHash: string
  freshPath: string
}

export interface VaultWarning {
  syncId: string
  kind: 'possible-secret' | 'null-content-active-row'
  message: string
}

export interface VaultIndexWrite {
  /** Relative path, e.g. "raven-nest--3f9a12c7/_index.md". */
  filePath: string
  content: string
}

export interface VaultPlan {
  writes: VaultWrite[]
  moves: VaultMove[]
  deletes: VaultDelete[]
  conflicts: VaultConflict[]
  warnings: VaultWarning[]
  indexWrites: VaultIndexWrite[]
  readme: string
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function conflictPathFor(filePath: string): string {
  const slash = filePath.lastIndexOf('/')
  const dir = slash === -1 ? '' : filePath.slice(0, slash + 1)
  const name = slash === -1 ? filePath : filePath.slice(slash + 1)
  return `${dir}_conflicts/${name}`
}

interface Disposition {
  excluded: boolean
  reason?: 'excluded-superseded' | 'excluded-team'
  subfolder: '' | '_superseded/'
}

function classify(record: MemoryRecord, config: VaultConfig): Disposition {
  if (record.supersededBy !== null) {
    return config.includeSuperseded
      ? { excluded: false, subfolder: '_superseded/' }
      : { excluded: true, reason: 'excluded-superseded', subfolder: '' }
  }
  if (record.scope === 'team' && !config.includeTeamScope) {
    return { excluded: true, reason: 'excluded-team', subfolder: '' }
  }
  return { excluded: false, subfolder: '' }
}

const README_CONTENT = `# Nest Memory Vault

**This folder is a mirror. Nest regenerates it. Edits made here do not reach Nest yet —
they are preserved in \`_conflicts/\`, not applied.**

- One project per folder, one observation per note.
- \`_superseded/\` holds historical versions a newer note replaced — kept for the graph,
  out of the way of the folder you actually read.
- \`_team/\` (inside a project folder, when present) holds memories written by teammates,
  shared explicitly with that project's team.
- \`_disabled/\` holds notes from a project you removed from Nest Memory — kept, not deleted.
- \`_conflicts/\` holds a note you edited by hand, exactly as you left it, the moment Nest
  detected the edit — it is never overwritten or deleted automatically.
- \`.nest-vault/\` is Nest's own bookkeeping (Obsidian ignores dot-directories).

Open this folder in Obsidian for graph view, backlinks and full-text search. On Windows,
consider excluding this folder from real-time antivirus scanning — regenerating thousands
of small files is much faster without it.
`

function renderIndex(projectFolder: string, displayName: string, entries: Array<{ syncId: string; title: string; filePath: string }>): string {
  const lines = [`# ${displayName}`, '', `${entries.length} observation(s).`, '']
  for (const e of [...entries].sort((a, b) => a.title.localeCompare(b.title))) {
    const name = e.filePath.slice(e.filePath.lastIndexOf('/') + 1).replace(/\.md$/, '')
    lines.push(`- [[${name}]] — ${e.title}`)
  }
  return lines.join('\n') + '\n'
}

export interface PlanVaultInput {
  records: MemoryRecord[]
  projects: MemoryProject[]
  manifest: VaultManifest
  config: VaultConfig
  /** Live on-disk hash of every file the manifest currently tracks, keyed by relative path — computed by the effectful caller BEFORE calling planVault, so this function never touches `fs`. A path absent from this map is treated as "unreadable/missing", which is never itself a conflict (nothing to compare against). */
  onDiskHashes: Record<string, string>
}

/**
 * Turns the current state of `observations` into a plan of writes/moves/deletes — see the
 * module doc comment for the shape of the decision. `records` may span multiple projects;
 * grouping and per-project index generation happen internally.
 */
export function planVault(input: PlanVaultInput): VaultPlan {
  const { records, projects, manifest, config, onDiskHashes } = input
  const projectByKey = new Map(projects.map((p) => [p.projectKey, p]))

  const writes: VaultWrite[] = []
  const moves: VaultMove[] = []
  const deletes: VaultDelete[] = []
  const conflicts: VaultConflict[] = []
  const warnings: VaultWarning[] = []
  const indexWrites: VaultIndexWrite[] = []

  // Group by project so file-name collisions are resolved within each project's folder,
  // not globally (two different projects can legitimately reuse the same title+suffix).
  const byProject = new Map<string, MemoryRecord[]>()
  for (const r of records) {
    const bucket = byProject.get(r.projectKey)
    if (bucket) bucket.push(r)
    else byProject.set(r.projectKey, [r])
  }

  for (const [projectKey, projectRecords] of byProject) {
    const project = projectByKey.get(projectKey) ?? null
    const folder = projectFolderName(projectKey, project)
    const displayName = project?.displayName ?? projectKey
    const disabled = project !== null && !project.enrolled

    // supersedes/supersededBy edges, derived per §5.3 by inverting superseded_by across
    // this project's rows — no schema, no extra column.
    const supersedesOf = new Map<string, string[]>()
    for (const r of projectRecords) {
      if (r.supersededBy) {
        const list = supersedesOf.get(r.supersededBy)
        if (list) list.push(r.syncId)
        else supersedesOf.set(r.supersededBy, [r.syncId])
      }
    }

    const fileNames = resolveVaultFileNames(projectRecords.map((r) => ({ syncId: r.syncId, title: r.title })))

    const activeIndexEntries: Array<{ syncId: string; title: string; filePath: string }> = []
    let projectTouched = false

    for (const record of projectRecords) {
      const previous = manifest.entries[record.syncId]

      // Tombstone: the row was deleted at the source. If we never wrote it, there's
      // nothing to remove — a silent no-op, not a delete.
      if (record.deleted) {
        if (previous) {
          deletes.push({ syncId: record.syncId, filePath: previous.filePath, reason: 'tombstone' })
          projectTouched = true
        }
        continue
      }

      if (disabled) {
        if (previous && !previous.filePath.startsWith('_disabled/')) {
          const toPath = `_disabled/${previous.filePath}`
          moves.push({ syncId: record.syncId, fromPath: previous.filePath, toPath })
          projectTouched = true
        }
        continue
      }

      const disposition = classify(record, config)
      if (disposition.excluded) {
        if (previous) {
          deletes.push({ syncId: record.syncId, filePath: previous.filePath, reason: 'excluded' })
          projectTouched = true
        }
        continue
      }

      const fileName = fileNames.get(record.syncId) ?? `${record.syncId}.md`
      const targetPath = `${folder}/${disposition.subfolder}${fileName}`

      if (record.content === null) {
        warnings.push({
          syncId: record.syncId,
          kind: 'null-content-active-row',
          message: 'Fila activa con content null — no debería pasar (sólo un tombstone nulea content); se mirrorea con cuerpo vacío.',
        })
      }
      const { redacted } = redact(`${record.title}\n${record.content ?? ''}`)
      if (redacted) {
        warnings.push({
          syncId: record.syncId,
          kind: 'possible-secret',
          message: `"${record.title}" todavía matchea un patrón de secreto conocido — revisala antes de compartir este vault.`,
        })
      }

      const noteCtx: NoteContext = {
        projectDisplayName: displayName,
        supersededByAlias: record.supersededBy,
        supersedesAliases: supersedesOf.get(record.syncId) ?? [],
      }
      const scrubbedRecord: MemoryRecord = { ...record, sourceRef: record.sourceRef ? scrubSourceRef(record.sourceRef) : null }
      const content = renderNote(scrubbedRecord, noteCtx)
      const fileHash = sha256(content)

      activeIndexEntries.push({ syncId: record.syncId, title: record.title, filePath: targetPath })

      // Edit detection FIRST, before any write/move/delete decision for this row (§10):
      // if the file the manifest says it wrote no longer matches what's on disk, the user
      // touched it — preserve their bytes in `_conflicts/` and write the fresh mirror
      // alongside, never silently overwriting.
      if (previous) {
        const onDisk = onDiskHashes[previous.filePath]
        if (onDisk !== undefined && onDisk !== previous.fileHash) {
          conflicts.push({
            syncId: record.syncId,
            filePath: previous.filePath,
            conflictPath: conflictPathFor(previous.filePath),
            freshContent: content,
            freshFileHash: fileHash,
            freshSourceHash: record.contentHash,
            freshPath: targetPath,
          })
          projectTouched = true
          continue
        }
      }

      const unchanged = previous && previous.sourceHash === record.contentHash && previous.filePath === targetPath
      if (unchanged) continue

      if (previous && previous.filePath !== targetPath && previous.sourceHash === record.contentHash) {
        // Location changed, content didn't — a cheap rename beats a full rewrite.
        moves.push({ syncId: record.syncId, fromPath: previous.filePath, toPath: targetPath })
        projectTouched = true
        continue
      }

      writes.push({ syncId: record.syncId, filePath: targetPath, content, fileHash, sourceHash: record.contentHash })
      projectTouched = true
      if (previous && previous.filePath !== targetPath) {
        deletes.push({ syncId: record.syncId, filePath: previous.filePath, reason: 'stale-path' })
      }
    }

    if (projectTouched) {
      indexWrites.push({ filePath: `${folder}/_index.md`, content: renderIndex(folder, displayName, activeIndexEntries) })
    }
  }

  return { writes, moves, deletes, conflicts, warnings, indexWrites, readme: README_CONTENT }
}
