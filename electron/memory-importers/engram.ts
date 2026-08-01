// Engram SQLite importer — §5.2.A. Zero code/schema/runtime dependency on engram
// (Appendix A): this reads its SQLite file the way any importer reads a foreign format —
// from the outside, read-only, on a temp copy, version-tolerant.
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, copyFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, basename } from 'path'
import { MemoryStore, deriveImportSyncId, computeContentIdentity } from '../memory-store'
import type { ObservationType } from '../memory-protocol'
import { GLOBAL_PROJECT_KEY } from '../memory-project-key'

// The subset of engram's `observations` schema this adapter understands. Reading only
// these columns — rather than `SELECT *` — is what makes the adapter degrade instead of
// break when engram's schema drifts ahead of what we know (§5.2 "Schema drift").
//
// created_at/updated_at/last_seen_at/deleted_at are typed `string | number` — NOT `number`
// as docs/nest-memory-architecture.md §5.2.A's "map 1:1" implied. Verified against a real
// ~14 MB production engram.db: these columns hold SQLite TEXT datetimes in
// 'YYYY-MM-DD HH:MM:SS' format (SQLite's CURRENT_TIMESTAMP default, always UTC), not epoch
// integers. `number` is kept in the union only to tolerate a future engram schema that
// switches to epoch ms — see parseEngramTimestamp below for why raw values can't be
// passed through as-is.
interface EngramObservationRow {
  sync_id: string
  type: string
  title: string
  content: string
  project: string | null
  topic_key: string | null
  revision_count: number | null
  duplicate_count: number | null
  last_seen_at: string | number | null
  created_at: string | number
  updated_at: string | number
  deleted_at: string | number | null
}

/**
 * Converts an engram timestamp to epoch ms, the unit MemoryStore's own
 * created_at/updated_at/last_seen_at columns use (INTEGER, ms epoch — memory-store.ts).
 * Engram stores these as naive SQLite TEXT datetimes ('YYYY-MM-DD HH:MM:SS', no timezone,
 * always UTC per SQLite's CURRENT_TIMESTAMP convention) — passed through unconverted, this
 * string would land in an INTEGER-affinity column as TEXT, and SQLite's type-sorting rules
 * place any TEXT value after every INTEGER/REAL value in a comparison. Every imported row
 * would then sort as "infinitely new" (breaking `ORDER BY updated_at DESC`) and never match
 * the content-dedupe window's `created_at >= now - DEDUPE_WINDOW_MS` numeric comparison.
 * `new Date(naiveString)` parses as LOCAL time without an explicit zone, which is wrong
 * here by the host's UTC offset — hence the explicit 'Z' suffix.
 */
function parseEngramTimestamp(raw: string | number | null | undefined): number | undefined {
  if (raw === null || raw === undefined) return undefined
  if (typeof raw === 'number') return raw
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)
  const iso = `${raw.replace(' ', 'T')}${hasZone ? '' : 'Z'}`
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? undefined : ms
}

const KNOWN_TYPES = new Set<ObservationType>([
  'decision', 'bugfix', 'architecture', 'discovery', 'pattern', 'config', 'preference', 'session',
])

export interface EngramImportResult {
  imported: number
  skipped: number
  error?: string
}

/**
 * Resolves an engram `project` value (a lowercased basename) to a Nest project_key by
 * matching against the caller-supplied map of known repos; unmatched -> __global__, per
 * §5.2.A.
 */
function resolveProjectKeyForEngramProject(engramProject: string | null, knownProjects: Map<string, string>): string {
  if (!engramProject) return GLOBAL_PROJECT_KEY
  return knownProjects.get(engramProject.toLowerCase()) ?? GLOBAL_PROJECT_KEY
}

/**
 * Copies engram.db (+ -wal/-shm if present) to a temp dir and opens the copy read-only.
 * Never opens the original — an engram MCP process may hold it with a live WAL.
 */
function openReadOnlyCopy(engramDbPath: string): { db: Database.Database; cleanup: () => void } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'nest-engram-import-'))
  const dest = join(tmpDir, basename(engramDbPath))
  copyFileSync(engramDbPath, dest)
  for (const ext of ['-wal', '-shm']) {
    const src = `${engramDbPath}${ext}`
    if (existsSync(src)) {
      try { copyFileSync(src, `${dest}${ext}`) } catch { /* best effort */ }
    }
  }
  const db = new Database(dest, { readonly: true, fileMustExist: true })
  return {
    db,
    cleanup: () => {
      db.close()
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }
    },
  }
}

export function importEngramDatabase(
  store: MemoryStore,
  engramDbPath: string,
  opts: { knownProjects?: Map<string, string> } = {}
): EngramImportResult {
  if (!existsSync(engramDbPath)) return { imported: 0, skipped: 0, error: 'not found' }

  const runId = `engram-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  store.startImportRun({ id: runId, source: 'engram', sourcePath: engramDbPath })

  let copy: { db: Database.Database; cleanup: () => void } | null = null
  let imported = 0
  let skipped = 0
  try {
    copy = openReadOnlyCopy(engramDbPath)

    // Only select columns this adapter recognizes — a newer engram schema with extra
    // columns still imports cleanly; a schema missing a column we expect throws, caught
    // below and reported as a partial-import warning rather than a crash (§5.2, R-7).
    const rows = copy.db
      .prepare(
        `SELECT sync_id, type, title, content, project, topic_key, revision_count,
                duplicate_count, last_seen_at, created_at, updated_at, deleted_at
         FROM observations`
      )
      .all() as EngramObservationRow[]

    const knownProjects = opts.knownProjects ?? new Map()

    for (const row of rows) {
      if (row.deleted_at !== null && row.deleted_at !== undefined) { skipped += 1; continue }
      if (!row.sync_id || !row.title || !row.content) { skipped += 1; continue }

      const projectKey = resolveProjectKeyForEngramProject(row.project, knownProjects)
      const type: ObservationType = KNOWN_TYPES.has(row.type as ObservationType) ? (row.type as ObservationType) : 'discovery'
      const scope = 'personal' as const // engram's `project` scope is NOT carried across — user re-decides sharing from zero (§5.2.A)
      const sourceRef = `engram:${row.sync_id}`
      const createdAt = parseEngramTimestamp(row.created_at)
      // Pre-compute the same redact+hash sequence save() will independently arrive at,
      // so the syncId below is derived from the identical content_hash it will persist —
      // see computeContentIdentity's doc comment in memory-store.ts.
      const { hash } = computeContentIdentity(row.title, row.content)

      store.save({
        projectKey,
        scope,
        topicKey: row.topic_key,
        type,
        title: row.title,
        content: row.content,
        source: 'import',
        sourceRef,
        // Content-derived identity (see deriveImportSyncId in memory-store.ts): the same
        // observation content produces the same sync_id no matter which machine's
        // engram.db it came from (each has its own, unrelated engram sync_id) or which
        // importer produced it, so the server's upsert-by-sync_id dedupes it cross-device
        // instead of the old source-id-based derivation, which diverged (261 duplicate
        // groups, reproduced live). topic_key is part of the seed (Finding 1 fix) — two
        // engram rows with identical title/content but different topic_key are DISTINCT
        // identities, not a collision.
        syncId: deriveImportSyncId(projectKey, scope, type, hash, row.topic_key),
        // Bug 1 fix: preserve engram's original dates instead of collapsing all imported
        // history to the import moment. last_seen_at falls back to created_at when engram
        // never recorded a last-seen touch for this row.
        createdAt,
        updatedAt: parseEngramTimestamp(row.updated_at) ?? createdAt,
        lastSeenAt: parseEngramTimestamp(row.last_seen_at) ?? createdAt,
      })
      imported += 1
    }

    store.updateImportRun(runId, { imported, skipped, state: 'done' })
    return { imported, skipped }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    store.updateImportRun(runId, { imported, skipped, state: 'failed', error: message })
    // Degrade, don't fail the whole connect flow — a partial import beats a failed one (R-7).
    return { imported, skipped, error: message }
  } finally {
    copy?.cleanup()
  }
}

/** Glob-free discovery: engram stores one DB per AI account dir, plus an optional global one. */
export function discoverEngramDatabases(ravenHomeDir: string, accountDirs: string[]): string[] {
  const candidates = [join(ravenHomeDir, '.engram', 'engram.db'), ...accountDirs.map((d) => join(d, '.engram', 'engram.db'))]
  return candidates.filter((p) => existsSync(p))
}
