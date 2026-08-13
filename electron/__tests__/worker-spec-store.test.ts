import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  loadWorkerSpecs, saveWorkerSpecs, newWorkerSpecId, type WorkerSpec,
} from '../integrations/worker-spec-store'

const tmpDirs: string[] = []
function tmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'worker-spec-test-'))
  tmpDirs.push(dir)
  return join(dir, 'sub', 'worker-specs.json') // sub/ missing: exercises mkdir -p
}
function makeSpec(over: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    id: 'w1', name: 'triage-bug',
    steps: [{ agent: 'codex', model: 'haiku', instructions: 'Triage this bug.' }],
    createdAt: 0, updatedAt: 0, ...over,
  }
}
afterEach(() => { while (tmpDirs.length) { try { rmSync(tmpDirs.pop()!, { recursive: true, force: true }) } catch { /* ignore */ } } })

describe('worker-spec-store persistence', () => {
  it('missing file → empty list', () => {
    expect(loadWorkerSpecs(join(tmpdir(), 'nope', 'x.json'))).toEqual([])
  })
  it('round-trips through atomic save + versioned wrapper', () => {
    const f = tmpFile()
    saveWorkerSpecs(f, [makeSpec()])
    expect(JSON.parse(readFileSync(f, 'utf8')).version).toBe(1)
    expect(loadWorkerSpecs(f)).toEqual([makeSpec()])
  })
  it('drops an invalid record but keeps valid ones', () => {
    const f = tmpFile()
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, JSON.stringify({ version: 1, workers: [makeSpec(), { id: 5 }, { name: 'no-id' }] }))
    expect(loadWorkerSpecs(f)).toEqual([makeSpec()])
  })
  it('drops a spec whose steps are empty or malformed', () => {
    const f = tmpFile()
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, JSON.stringify({ version: 1, workers: [
      makeSpec({ id: 'ok' }),
      makeSpec({ id: 'nosteps', steps: [] }),
      makeSpec({ id: 'badstep', steps: [{ model: 'x' } as never] }), // no agent
    ] }))
    expect(loadWorkerSpecs(f).map((w) => w.id)).toEqual(['ok'])
  })
  it('newWorkerSpecId returns a non-empty hex string', () => {
    expect(newWorkerSpecId()).toMatch(/^[0-9a-f]+$/)
  })
})
