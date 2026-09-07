// Per-repo defaults for graph runs: the review mode a new run inherits and the
// auto-repair retry cap. Same validated/atomic JSON pattern as worker-spec-store.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import { ravenHome } from '../raven-home'
import type { GraphMode } from './graph-runner'

export interface GraphConfig { defaultMode: GraphMode; maxReviewRounds: number }
const DEFAULT: GraphConfig = { defaultMode: 'auto', maxReviewRounds: 2 }

export function defaultGraphConfigPath(): string {
  return join(ravenHome(), '.raven-nest', 'graph-config.json')
}

export class GraphConfigStore {
  constructor(private filePath: string = defaultGraphConfigPath()) {}
  private load(): Record<string, GraphConfig> {
    try { return (JSON.parse(readFileSync(this.filePath, 'utf8')) as { repos?: Record<string, GraphConfig> }).repos ?? {} }
    catch { return {} }
  }
  get(repoPath: string): GraphConfig {
    const c = this.load()[repoPath]
    if (!c) return { ...DEFAULT }
    return {
      defaultMode: c.defaultMode === 'gate' || c.defaultMode === 'step' ? c.defaultMode : 'auto',
      maxReviewRounds: typeof c.maxReviewRounds === 'number' && c.maxReviewRounds >= 0 ? c.maxReviewRounds : 2,
    }
  }
  set(repoPath: string, cfg: GraphConfig): void {
    const repos = this.load(); repos[repoPath] = cfg
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.${randomBytes(6).toString('hex')}.tmp`
      writeFileSync(tmp, JSON.stringify({ version: 1, repos }, null, 2))
      renameSync(tmp, this.filePath)
    } catch (err) { console.warn('[graph-config] write failed', err) }
  }
}
