import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, realpathSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { GraphRunStore } from '../integrations/graph-run-store'
import type { GraphRun } from '../integrations/graph-runner'

let dir: string
let file: string

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'gr-')))
  file = join(dir, 'graph-runs.json')
})

function makeRun(overrides: Partial<GraphRun> = {}): GraphRun {
  return {
    runId: 'r1',
    ticketId: 't1',
    templateId: 'full',
    worktreePath: '/w',
    branch: 'feat/x',
    startedAt: 0,
    nodes: { architect: { state: 'running' } },
    ...overrides,
  }
}

describe('GraphRunStore', () => {
  it('returns an empty list when no file exists', () => {
    expect(new GraphRunStore(file).list()).toEqual([])
  })

  it('persists a run with its dedup seen set and reads it back', () => {
    const s = new GraphRunStore(file)
    s.save(makeRun(), ['gate_blocked:t1:gate'])

    const reloaded = new GraphRunStore(file).get('r1')
    expect(reloaded).not.toBeNull()
    expect(reloaded!.run.ticketId).toBe('t1')
    expect(reloaded!.run.nodes.architect.state).toBe('running')
    expect(reloaded!.seen).toEqual(['gate_blocked:t1:gate'])
  })

  it('upserts by runId instead of duplicating', () => {
    const s = new GraphRunStore(file)
    s.save(makeRun(), [])
    s.save(makeRun({ nodes: { architect: { state: 'done' } } }), ['needs_input:t1:rev'])

    const listed = new GraphRunStore(file).list()
    expect(listed).toHaveLength(1)
    expect(listed[0].run.nodes.architect.state).toBe('done')
    expect(listed[0].seen).toEqual(['needs_input:t1:rev'])
  })

  it('finds the active run for a ticket', () => {
    const s = new GraphRunStore(file)
    s.save(makeRun(), [])
    s.save(makeRun({ runId: 'r2', ticketId: 't2' }), [])

    expect(s.getByTicket('t2')!.run.runId).toBe('r2')
    expect(s.getByTicket('nope')).toBeNull()
  })

  it('deletes a run by runId', () => {
    const s = new GraphRunStore(file)
    s.save(makeRun(), [])
    expect(s.delete('r1')).toBe(true)
    expect(new GraphRunStore(file).list()).toEqual([])
    expect(s.delete('r1')).toBe(false)
  })

  it('corrupt JSON → empty list, no throw', () => {
    writeFileSync(file, '{ not json')
    expect(new GraphRunStore(file).list()).toEqual([])
  })

  it('drops invalid entries on load instead of discarding the whole file', () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        runs: [
          { run: makeRun(), seen: [] },
          { run: { runId: 'bad' }, seen: [] }, // missing required GraphRun fields
          { seen: [] }, // no run at all
        ],
      }),
    )
    const listed = new GraphRunStore(file).list()
    expect(listed).toHaveLength(1)
    expect(listed[0].run.runId).toBe('r1')
  })

  it('tolerates a missing/invalid seen field by defaulting to []', () => {
    writeFileSync(
      file,
      JSON.stringify({ version: 1, runs: [{ run: makeRun() }] }),
    )
    expect(new GraphRunStore(file).get('r1')!.seen).toEqual([])
  })
})
