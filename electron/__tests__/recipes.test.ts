import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  defaultRecipes,
  loadRecipes,
  saveRecipes,
  type TrackedLookup,
  type StoredRecipe,
} from '../integrations/recipes'
import type { DomainEvent } from '../integrations/bus-types'

const prOpened: DomainEvent = { type: 'pr.opened', branch: 'feat/x', repoFullName: 'o/r' }
const prMerged: DomainEvent = { type: 'pr.merged', branch: 'feat/x', repoFullName: 'o/r' }
const taskCreated: DomainEvent = {
  type: 'task.created', taskId: 't1', pluginId: 'jira', providerId: 'ISSUE-9', repoFullName: 'o/r', branch: 'feat/x',
}

// Tracking fake: replica el branch→Tracked del TicketLoop sin importar ticket-loop.
const lookup: TrackedLookup = (branch) =>
  branch === 'feat/x' ? { pluginId: 'jira', providerId: 'ISSUE-9' } : undefined

const emptyLookup: TrackedLookup = () => undefined

const tmpDirs: string[] = []
function tmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'recipes-test-'))
  tmpDirs.push(dir)
  return join(dir, 'sub', 'recipes.json') // sub/ no existe: prueba mkdir -p
}

afterEach(() => {
  vi.restoreAllMocks()
  while (tmpDirs.length) {
    try { rmSync(tmpDirs.pop()!, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('defaultRecipes (replican H3)', () => {
  it('pr.opened matchea sólo pr.opened y produce updateStatus in_review resuelto', () => {
    const recipes = defaultRecipes(lookup)
    const r = recipes.find((x) => x.when === 'pr.opened')!
    expect(r).toBeDefined()
    expect(r.then(prOpened)).toEqual([
      { cmd: 'updateStatus', pluginId: 'jira', providerId: 'ISSUE-9', to: 'in_review' },
    ])
    // no matchea otros tipos
    expect(recipes.filter((x) => x.when === 'pr.opened')).toHaveLength(1)
  })

  it('pr.merged produce updateStatus done resuelto', () => {
    const r = defaultRecipes(lookup).find((x) => x.when === 'pr.merged')!
    expect(r.then(prMerged)).toEqual([
      { cmd: 'updateStatus', pluginId: 'jira', providerId: 'ISSUE-9', to: 'done' },
    ])
  })

  it('task.created es no-op en v1 (no dispara comandos, evita doble transición)', () => {
    const r = defaultRecipes(lookup).find((x) => x.when === 'task.created')!
    expect(r.then(taskCreated)).toEqual([])
  })

  it('si el branch no está trackeado, la receta no produce comando', () => {
    const recipes = defaultRecipes(emptyLookup)
    for (const r of recipes) {
      expect(r.then(prOpened)).toEqual([])
    }
  })

  it('resuelve el tracking al momento de then(ev) (lookup dinámico, no import global)', () => {
    let current: ReturnType<TrackedLookup> = undefined
    const dyn: TrackedLookup = () => current
    const r = defaultRecipes(dyn).find((x) => x.when === 'pr.merged')!
    expect(r.then(prMerged)).toEqual([])
    current = { pluginId: 'linear', providerId: 'ENG-1' }
    expect(r.then(prMerged)).toEqual([
      { cmd: 'updateStatus', pluginId: 'linear', providerId: 'ENG-1', to: 'done' },
    ])
  })
})

describe('loadRecipes / saveRecipes', () => {
  it('archivo inexistente → DEFAULT_RECIPES (replican H3)', () => {
    const recipes = loadRecipes(tmpFile(), lookup)
    const opened = recipes.find((x) => x.when === 'pr.opened')!
    expect(opened.then(prOpened)).toEqual([
      { cmd: 'updateStatus', pluginId: 'jira', providerId: 'ISSUE-9', to: 'in_review' },
    ])
    expect(recipes.map((x) => x.when).sort()).toEqual(['pr.merged', 'pr.opened', 'task.created'])
  })

  it('round-trip: save recetas declarativas → load reconstruye las mismas emisiones', () => {
    const file = tmpFile()
    const stored: StoredRecipe[] = [
      { id: 'custom-notify', when: 'pr.opened', emit: [{ cmd: 'notify', channel: '#dev', message: 'PR abierto' }] },
      { id: 'custom-done', when: 'pr.merged', emit: [{ cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to: 'done' }] },
    ]
    saveRecipes(file, stored)
    const loaded = loadRecipes(file, lookup)
    expect(loaded.map((x) => ({ id: x.id, when: x.when }))).toEqual([
      { id: 'custom-notify', when: 'pr.opened' },
      { id: 'custom-done', when: 'pr.merged' },
    ])
    expect(loaded[0].then(prOpened)).toEqual([{ cmd: 'notify', channel: '#dev', message: 'PR abierto' }])
    expect(loaded[1].then(prMerged)).toEqual([{ cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to: 'done' }])
  })

  it('archivo con JSON corrupto → warn + DEFAULT_RECIPES (no crashea)', () => {
    const file = tmpFile()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    saveRecipes(file, [{ id: 'x', when: 'pr.opened', emit: [{ cmd: 'notify', channel: '#c', message: 'm' }] }])
    // corromper el archivo
    const { writeFileSync } = require('fs') as typeof import('fs')
    writeFileSync(file, '{ not json')
    const recipes = loadRecipes(file, lookup)
    expect(warn).toHaveBeenCalled()
    expect(recipes.map((x) => x.when).sort()).toEqual(['pr.merged', 'pr.opened', 'task.created'])
  })

  it('load descarta recetas almacenadas con comandos inválidos', () => {
    const file = tmpFile()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { writeFileSync, mkdirSync } = require('fs') as typeof import('fs')
    const { dirname } = require('path') as typeof import('path')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({
      version: 1,
      recipes: [
        { id: 'ok', when: 'pr.opened', emit: [{ cmd: 'notify', channel: '#c', message: 'm' }] },
        { id: 'bad-cmd', when: 'pr.opened', emit: [{ cmd: 'notAThing' }] },
        { id: 'bad-shape', when: 42, emit: [] },
      ],
    }))
    const recipes = loadRecipes(file, lookup)
    expect(recipes.map((x) => x.id)).toEqual(['ok'])
    expect(warn).toHaveBeenCalled()
  })
})
