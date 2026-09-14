// The heart of the vault (§3.3): turns `MemoryRecord[]` + the previous manifest into a
// plan of filesystem effects, without touching `fs` itself. Pure, so this is where the
// bulk of the tests live (vault spec §13).
import { redact } from '../memory-redaction'
import { conflictPathFor, sha256 } from './vault-hash'
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

/**
 * El `_index.md` de una carpeta que ya no corresponde a ningun proyecto.
 *
 * Pasa cuando un proyecto cambia de nombre: la carpeta sale de
 * `remoteSlug || displayName || projectKey`, asi que el nombre nuevo es otra carpeta, las
 * notas se mudan (`stale-path` + write) y la vieja queda con un indice que lista archivos que
 * ya no estan.
 *
 * Antes no pasaba nunca porque `ensureProject()` era insert-only y un nombre congelado en el
 * hash se quedaba congelado para siempre. Al arreglar eso (2026-09-13) el renombre se volvio
 * posible, y con el la carpeta fantasma — en la carpeta que el usuario abre con Obsidian, que
 * es justo donde la basura se ve.
 */
export interface VaultIndexDelete {
  filePath: string
  /** La carpeta, para intentar borrarla si quedo vacia. */
  folder: string
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
  /** Indices de carpetas que ya no existen — ver VaultIndexDelete. */
  indexDeletes: VaultIndexDelete[]
  readme: string
}

interface Disposition {
  excluded: boolean
  reason?: 'excluded-superseded' | 'excluded-team'
  subfolder: '' | '_superseded/' | '_team/'
}

/**
 * Las de equipo van a `_team/` y no mezcladas con las tuyas (decision V-1 de la spec).
 *
 * Espejarlas es lo correcto —si no, el vault deja de ser "toda mi memoria" justo para el tier
 * que paga— pero mezclarlas seria peor que no espejarlas: el zip de "mi memoria" pasaria a
 * tener texto escrito por tus companeros, con su nombre adentro, sin que se note al mirar la
 * carpeta. En `_team/` se ve de donde viene cada cosa con abrir el explorador, y el README lo
 * dice con todas las letras.
 *
 * `_superseded/` gana sobre `_team/`: una memoria reemplazada es historia, y la historia del
 * equipo tambien es historia. Que una fila viva en dos carpetas segun dos ejes distintos
 * obligaria a inventar `_team/_superseded/`, que nadie va a mirar.
 */
function classify(record: MemoryRecord, config: VaultConfig): Disposition {
  if (record.supersededBy !== null) {
    return config.includeSuperseded
      ? { excluded: false, subfolder: '_superseded/' }
      : { excluded: true, reason: 'excluded-superseded', subfolder: '' }
  }
  if (record.scope === 'team') {
    return config.includeTeamScope
      ? { excluded: false, subfolder: '_team/' }
      : { excluded: true, reason: 'excluded-team', subfolder: '' }
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
  /**
   * Las carpetas que el manifiesto dice que escribimos la vez pasada. Se derivan de los paths
   * que ya tiene —el primer segmento de cada uno— en vez de guardarse aparte: un segundo
   * registro de la misma verdad es un segundo lugar del que se puede desincronizar.
   */
  const carpetasPrevias = new Set<string>()
  for (const entry of Object.values(manifest.entries)) {
    const i = entry.filePath.indexOf('/')
    if (i > 0) carpetasPrevias.add(entry.filePath.slice(0, i))
  }
  const carpetasActuales = new Set<string>()

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
    carpetasActuales.add(folder)
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
          message: 'Active row with null content — should not happen (only a tombstone nulls content); mirrored with an empty body.',
        })
      }
      const { redacted } = redact(`${record.title}\n${record.content ?? ''}`)
      if (redacted) {
        warnings.push({
          syncId: record.syncId,
          kind: 'possible-secret',
          message: `"${record.title}" still matches a known secret pattern — review it before sharing this vault.`,
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

  const indexDeletes: VaultIndexDelete[] = []
  for (const previa of carpetasPrevias) {
    if (carpetasActuales.has(previa)) continue
    indexDeletes.push({ filePath: `${previa}/_index.md`, folder: previa })
  }

  return { writes, moves, deletes, conflicts, warnings, indexWrites, indexDeletes, readme: README_CONTENT }
}
