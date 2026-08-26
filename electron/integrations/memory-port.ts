// Injected port to Nest Memory. The store lives in feat/nest-memory-phase1 and this
// branch must not import it (see docs/MEMORY_INTEGRATIONS_CONTRACT.md) — same pattern
// Bauti used for PtyMemoryIntegration in pty-manager.ts.

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
