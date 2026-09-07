// The only vault module that touches SQLite — a SEPARATE `readonly: true` handle to the
// account's `memory.db`, never the live MemoryStore instance. Same file, WAL mode, N
// readers + 1 writer: the daemon writes, this reads, neither blocks the other (vault spec
// §3.2). Lives in the same Electron main process as MemoryStore, so there isn't even
// cross-process contention.
import Database from 'better-sqlite3'
import { resolveStorePath } from '../memory-store'
import { normalizeRemote } from '../memory-project-key'
import type { ObservationType } from '../memory-protocol'
import { NULL_READER, type MemoryProject, type MemoryReader, type MemoryRecord } from './memory-port'

interface ObservationRowLite {
  sync_id: string
  project_key: string
  scope: string
  topic_key: string | null
  type: string
  title: string
  content: string | null
  tags: string | null
  source: string
  origin_ai: string | null
  origin_account: string | null
  git_branch: string | null
  author_display: string | null
  source_ref: string | null
  content_hash: string
  revision_count: number
  duplicate_count: number
  created_at: number
  updated_at: number
  deleted: number
  superseded_by: string | null
}

function toRecord(row: ObservationRowLite): MemoryRecord {
  return {
    syncId: row.sync_id,
    projectKey: row.project_key,
    scope: row.scope as MemoryRecord['scope'],
    topicKey: row.topic_key,
    type: row.type as ObservationType,
    title: row.title,
    content: row.content,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
    source: row.source as MemoryRecord['source'],
    originAi: row.origin_ai,
    originAccount: row.origin_account,
    gitBranch: row.git_branch,
    authorDisplay: row.author_display,
    sourceRef: row.source_ref,
    contentHash: row.content_hash,
    revisionCount: row.revision_count,
    duplicateCount: row.duplicate_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deleted: row.deleted === 1,
    supersededBy: row.superseded_by,
  }
}

/**
 * Opens a readonly handle to the CURRENTLY ACTIVE account's store (per-account path,
 * `resolveStorePath` — Task 1 of the multi-device memory plan). Never throws: every
 * documented failure mode (db missing, `-shm` unmappable, read-only filesystem) is caught
 * and degrades to `NULL_READER` — the vault reports "memoria no disponible" instead of
 * breaking the app (V-R6).
 */
export function openReadonlyReader(ravenHomeDir: string, userId: string | null): { reader: MemoryReader; close: () => void } {
  const dbPath = resolveStorePath(ravenHomeDir, userId)
  let db: Database.Database
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
  } catch {
    return { reader: NULL_READER, close: () => {} }
  }

  const reader: MemoryReader = {
    listProjects(): MemoryProject[] {
      try {
        const rows = db
          .prepare('SELECT project_key, display_name, remote_url, enrolled FROM projects')
          .all() as Array<{ project_key: string; display_name: string; remote_url: string | null; enrolled: number }>
        return rows.map((r) => ({
          projectKey: r.project_key,
          displayName: r.display_name,
          remoteSlug: r.remote_url ? normalizeRemote(r.remote_url) : null,
          enrolled: r.enrolled === 1,
        }))
      } catch {
        return []
      }
    },

    listRecords(projectKey: string): MemoryRecord[] {
      try {
        const rows = db
          .prepare('SELECT * FROM observations WHERE project_key = ? ORDER BY updated_at ASC')
          .all(projectKey) as ObservationRowLite[]
        return rows.map(toRecord)
      } catch {
        return []
      }
    },

    watermark(projectKey: string): { maxUpdatedAt: number; count: number } {
      try {
        const row = db
          .prepare('SELECT MAX(updated_at) as m, COUNT(*) as c FROM observations WHERE project_key = ?')
          .get(projectKey) as { m: number | null; c: number }
        return { maxUpdatedAt: row.m ?? 0, count: row.c }
      } catch {
        return { maxUpdatedAt: 0, count: 0 }
      }
    },
  }

  return {
    reader,
    close: () => {
      try { db.close() } catch { /* already closed / handle gone */ }
    },
  }
}
