// Injected port to Nest Memory. The store lives in feat/nest-memory-phase1 and this
// branch must not import it (see docs/MEMORY_INTEGRATIONS_CONTRACT.md) — same pattern
// Bauti used for PtyMemoryIntegration in pty-manager.ts.
import type { ObservationType } from '../memory-protocol'

export type MemoryObservationType =
  | 'decision' | 'bugfix' | 'architecture' | 'discovery'
  | 'pattern' | 'config' | 'preference' | 'session'

export interface MemorySaveInput {
  cwd: string
  title: string
  content: string
  type: MemoryObservationType
  topicKey?: string
  tags?: string[]
  sourceRef: string
  originAi?: string
  gitBranch?: string
}

export interface MemorySink {
  save(input: MemorySaveInput): void
}

/** Default when the memory branch isn't merged / memory is disconnected. */
export const NULL_SINK: MemorySink = { save: () => {} }

// ── Read side, added for Task 5 (memory vault) ──────────────────────────────
// Superset of ObservationSummary — the vault's frontmatter needs (near) every column of
// `observations`, not just what an agent's search/context reply needs. See
// docs/superpowers/specs/2026-08-26-memory-vault-design.md §3.1.

/** Full projection of one `observations` row, for the vault's frontmatter. */
export interface MemoryRecord {
  syncId: string
  projectKey: string
  scope: 'personal' | 'project' | 'team'
  topicKey: string | null
  type: ObservationType
  title: string
  /** null = tombstone (deleteObservation nulls content). */
  content: string | null
  tags: string[]
  source: 'mcp' | 'hook' | 'pty' | 'import' | 'ui'
  originAi: string | null
  originAccount: string | null
  gitBranch: string | null
  authorDisplay: string | null
  sourceRef: string | null
  contentHash: string
  revisionCount: number
  duplicateCount: number
  createdAt: number
  updatedAt: number
  deleted: boolean
  supersededBy: string | null
}

export interface MemoryProject {
  projectKey: string
  displayName: string
  /** Only the `org/repo` segment of the remote, never the full URL — see vault §4.2. */
  remoteSlug: string | null
  enrolled: boolean
}

export interface MemoryReader {
  listProjects(): MemoryProject[]
  /** All rows of a project, including superseded and tombstones. */
  listRecords(projectKey: string): MemoryRecord[]
  /** Cheap watermark to decide whether a regeneration pass is needed — vault spec §7. */
  watermark(projectKey: string): { maxUpdatedAt: number; count: number }
}

/** Default when `memory.db` can't be opened readonly (missing, FS read-only, no -shm). */
export const NULL_READER: MemoryReader = {
  listProjects: () => [],
  listRecords: () => [],
  watermark: () => ({ maxUpdatedAt: 0, count: 0 }),
}
