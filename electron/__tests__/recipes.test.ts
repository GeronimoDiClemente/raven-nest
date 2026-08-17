import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  defaultRecipes,
  loadRecipes,
  saveRecipes,
  describeCommand,
  recipeDescriptors,
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

  it('si el branch no está trackeado, las recetas de status no producen updateStatus', () => {
    // Las recetas H5 notify NO dependen del tracking (siempre emiten notify);
    // sólo las de status (pr.opened/pr.merged→updateStatus) hacen if(!t) return [].
    const recipes = defaultRecipes(emptyLookup)
    const opened = recipes.filter((r) => r.when === 'pr.opened').flatMap((r) => r.then(prOpened))
    const merged = recipes.filter((r) => r.when === 'pr.merged').flatMap((r) => r.then(prMerged))
    expect(opened.some((c) => c.cmd === 'updateStatus')).toBe(false)
    expect(merged.some((c) => c.cmd === 'updateStatus')).toBe(false)
  })

  it('pr.merged y ci.failed y changes.requested y review.requested producen notify', () => {
    const recipes = defaultRecipes(() => ({ pluginId: 'jira', providerId: 'P-1' }))
    const cmdsFor = (ev: DomainEvent) => recipes.filter(r => r.when === ev.type).flatMap(r => r.then(ev))
    expect(cmdsFor({ type: 'ci.failed', branch: 'feat/x', repoFullName: 'o/r', runUrl: 'u' } as DomainEvent)
      .some(c => c.cmd === 'notify')).toBe(true)
    expect(cmdsFor({ type: 'changes.requested', branch: 'feat/x', repoFullName: 'o/r', prNumber: 3 } as DomainEvent)
      .some(c => c.cmd === 'notify')).toBe(true)
    expect(cmdsFor({ type: 'review.requested', repoFullName: 'o/r', prNumber: 3, prTitle: 't' } as DomainEvent)
      .some(c => c.cmd === 'notify')).toBe(true)
  })

  it('pr.merged produce logOutcome (Calendar H6) con ref=branch y summary del merge', () => {
    const recipes = defaultRecipes(lookup)
    const cmds = recipes.filter((r) => r.when === 'pr.merged').flatMap((r) => r.then(prMerged))
    const logOutcome = cmds.find((c) => c.cmd === 'logOutcome')
    expect(logOutcome).toMatchObject({ cmd: 'logOutcome', ref: 'feat/x' })
    expect((logOutcome as { summary: string }).summary).toContain('o/r')
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
    expect(recipes.map((x) => x.when).sort()).toEqual(
      ['changes.requested', 'ci.failed', 'graph.completed', 'graph.completed', 'graph.gate_blocked', 'graph.node_needs_input', 'pr.merged', 'pr.merged', 'pr.merged', 'pr.opened', 'review.requested', 'session.opened', 'task.created'],
    )
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
    expect(recipes.map((x) => x.when).sort()).toEqual(
      ['changes.requested', 'ci.failed', 'graph.completed', 'graph.completed', 'graph.gate_blocked', 'graph.node_needs_input', 'pr.merged', 'pr.merged', 'pr.merged', 'pr.opened', 'review.requested', 'session.opened', 'task.created'],
    )
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

describe('describeCommand', () => {
  it('formatea cada tipo de comando en una etiqueta corta', () => {
    expect(describeCommand({ cmd: 'notify', channel: '#dev', message: 'x' })).toBe('notify #dev')
    expect(describeCommand({ cmd: 'notify', channel: '', message: 'x' })).toBe('notify #channel')
    expect(describeCommand({ cmd: 'updateStatus', pluginId: 'p', providerId: 'i', to: 'in_review' })).toBe('updateStatus: in_review')
    expect(describeCommand({ cmd: 'logOutcome', ref: 'r', summary: 's' })).toBe('logOutcome')
    expect(describeCommand({ cmd: 'setPresence', text: 't' })).toBe('setPresence')
    expect(describeCommand({ cmd: 'createTask', pluginId: 'p', title: 't' })).toBe('createTask')
    expect(describeCommand({ cmd: 'openSession' })).toBe('openSession')
    expect(describeCommand({ cmd: 'scheduleBlock', when: 'w', label: 'l' })).toBe('scheduleBlock')
  })
})

describe('recipeDescriptors (Recipes tab, read-only — Plan 5 Task 1)', () => {
  it('archivo inexistente → descriptores de los defaults, agrupados por when en orden de aparición', () => {
    const descriptors = recipeDescriptors(tmpFile())
    expect(descriptors).toEqual([
      { id: 'default:pr.opened', when: 'pr.opened', commands: ['updateStatus: in_review'] },
      { id: 'default:pr.merged', when: 'pr.merged', commands: ['updateStatus: done', 'notify #channel', 'logOutcome'] },
      { id: 'default:ci.failed', when: 'ci.failed', commands: ['notify #channel'] },
      { id: 'default:changes.requested', when: 'changes.requested', commands: ['notify #channel'] },
      { id: 'default:review.requested', when: 'review.requested', commands: ['notify #channel'] },
      { id: 'default:session.opened', when: 'session.opened', commands: ['setPresence'] },
      { id: 'default:graph.node_needs_input', when: 'graph.node_needs_input', commands: ['notify #channel'] },
      { id: 'default:graph.gate_blocked', when: 'graph.gate_blocked', commands: ['notify #channel'] },
      { id: 'default:graph.completed', when: 'graph.completed', commands: ['notify #channel', 'logOutcome'] },
    ])
    // task.created→noop no emite comandos: no tiene fila (nada que mostrar)
    expect(descriptors.some((d) => d.when === 'task.created')).toBe(false)
  })

  it('recetas guardadas reemplazan a los defaults (mismo swap-not-merge que loadRecipes) y se describen con describeCommand', () => {
    const file = tmpFile()
    const stored: StoredRecipe[] = [
      { id: 'custom-notify', when: 'pr.opened', emit: [{ cmd: 'notify', channel: '#dev', message: 'PR abierto' }] },
      {
        id: 'custom-done',
        when: 'pr.merged',
        emit: [
          { cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to: 'done' },
          { cmd: 'logOutcome', ref: 'x', summary: 'y' },
        ],
      },
    ]
    saveRecipes(file, stored)
    expect(recipeDescriptors(file)).toEqual([
      { id: 'custom-notify', when: 'pr.opened', commands: ['notify #dev'] },
      { id: 'custom-done', when: 'pr.merged', commands: ['updateStatus: done', 'logOutcome'] },
    ])
  })

  it('recipes.json presente pero sin recetas válidas → vuelve a caer en los defaults', () => {
    const file = tmpFile()
    saveRecipes(file, [])
    expect(recipeDescriptors(file)[0]).toEqual(
      { id: 'default:pr.opened', when: 'pr.opened', commands: ['updateStatus: in_review'] },
    )
  })
})
