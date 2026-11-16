// Las ramas de workers que esperan la decisión de Gero (spec §6.7): un JSON chico en
// `<ravenHome>/.raven-nest/orchestration-review.json`. Sobrevive a un reinicio de Nest: el
// worktree y la rama siguen en disco aunque el pane y el coordinador ya no existan, y la
// decisión (merge / PR / discard) se toma cuando Gero quiera.

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { writeFileAtomic } from '../memory-provisioner' // utilidad pura (escritura atómica)
import type { WorkerRecord } from './orchestration-state'

export type ReviewEntry = Pick<
  WorkerRecord,
  'workerId' | 'label' | 'colorIndex' | 'branch' | 'worktreePath' | 'baseBranch' | 'status' | 'finishedAt'
> & { repoPath: string }

const ESTADOS = new Set(['done', 'exited', 'stopped', 'starting', 'working', 'needs_input'])

function valida(x: unknown): x is ReviewEntry {
  if (!x || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  return (
    typeof e.workerId === 'string' &&
    typeof e.label === 'string' &&
    typeof e.colorIndex === 'number' &&
    typeof e.branch === 'string' &&
    typeof e.worktreePath === 'string' &&
    typeof e.baseBranch === 'string' &&
    typeof e.repoPath === 'string' &&
    typeof e.status === 'string' &&
    ESTADOS.has(e.status) &&
    (e.finishedAt === undefined || typeof e.finishedAt === 'number')
  )
}

export class ReviewStore {
  private entries: ReviewEntry[]

  constructor(private readonly path: string) {
    this.entries = this.leer()
  }

  list(): ReviewEntry[] {
    return this.entries.map((e) => ({ ...e }))
  }

  get(workerId: string): ReviewEntry | undefined {
    const e = this.entries.find((x) => x.workerId === workerId)
    return e ? { ...e } : undefined
  }

  upsert(e: ReviewEntry): void {
    const limpio: ReviewEntry = {
      workerId: e.workerId,
      label: e.label,
      colorIndex: e.colorIndex,
      branch: e.branch,
      worktreePath: e.worktreePath,
      baseBranch: e.baseBranch,
      status: e.status,
      repoPath: e.repoPath,
      ...(e.finishedAt !== undefined ? { finishedAt: e.finishedAt } : {})
    }
    const i = this.entries.findIndex((x) => x.workerId === e.workerId)
    if (i >= 0) this.entries[i] = limpio
    else this.entries.push(limpio)
    this.guardar()
  }

  remove(workerId: string): void {
    const antes = this.entries.length
    this.entries = this.entries.filter((x) => x.workerId !== workerId)
    if (this.entries.length !== antes) this.guardar()
  }

  private leer(): ReviewEntry[] {
    try {
      if (!existsSync(this.path)) return []
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as { entries?: unknown }
      return Array.isArray(raw?.entries) ? raw.entries.filter(valida) : []
    } catch {
      // Un archivo roto no tumba la orquestación: arranca vacío (las ramas siguen en git).
      return []
    }
  }

  private guardar(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileAtomic(this.path, JSON.stringify({ version: 1, entries: this.entries }, null, 2))
  }
}
