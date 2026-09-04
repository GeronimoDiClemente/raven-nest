// Graph template store: persists user-created (custom) graph templates and
// exposes them alongside the built-in seeds. Same validated/atomic/versioned-
// JSON pattern as worker-spec-store.ts / scheduler.ts / recipes.ts: a missing
// file → built-ins only, corrupt JSON → warn + built-ins, individual invalid
// entries dropped (never crash the whole file), writes are tmp+rename atomic.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import { ravenHome } from '../raven-home'
import { defaultGraphTemplates, toGraphTemplate, type GraphTemplate } from './graph-template'

/** Loads only the user's custom templates from disk (built-ins are code, not
 *  persisted). Missing file → []. Corrupt JSON → warn + []. Invalid entries
 *  dropped individually with a warn. */
export function loadCustomTemplates(filePath: string): GraphTemplate[] {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return []
  }
  try {
    const data = JSON.parse(raw) as { templates?: unknown }
    const list = Array.isArray(data.templates) ? data.templates : []
    const out: GraphTemplate[] = []
    let dropped = 0
    for (const item of list) {
      const t = toGraphTemplate(item)
      if (t && !t.builtIn) out.push(t)
      else dropped++
    }
    if (dropped > 0) console.warn('[graph-template] discarded', dropped, 'invalid templates from', filePath)
    return out
  } catch (err) {
    console.warn('[graph-template] graph-templates.json unreadable, using built-ins only', err)
    return []
  }
}

/** Atomic write (tmp + rename): a crash mid-write never corrupts the file. */
export function saveCustomTemplates(filePath: string, templates: GraphTemplate[]): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, templates }, null, 2))
    renameSync(tmp, filePath)
  } catch (err) {
    console.warn('[graph-template] graph-templates.json write failed', err)
  }
}

export function newGraphTemplateId(): string {
  return randomBytes(8).toString('hex')
}

export function defaultGraphTemplatePath(): string {
  return join(ravenHome(), '.raven-nest', 'graph-templates.json')
}

export class GraphTemplateStore {
  constructor(private filePath: string = defaultGraphTemplatePath()) {}

  /** Built-in seeds first, then the user's valid custom templates. */
  list(): GraphTemplate[] {
    return [...defaultGraphTemplates(), ...loadCustomTemplates(this.filePath)]
  }

  /** Upsert a custom template by id (built-ins are immutable and never stored).
   *  A template arriving with builtIn:true is stored as a custom copy — editing
   *  a seed produces a custom template, not a mutated seed. */
  save(template: GraphTemplate): GraphTemplate {
    const stored = { ...template, builtIn: false as const }
    const customs = loadCustomTemplates(this.filePath)
    const idx = customs.findIndex((t) => t.id === stored.id)
    if (idx >= 0) customs[idx] = stored
    else customs.push(stored)
    saveCustomTemplates(this.filePath, customs)
    return stored
  }

  delete(id: string): boolean {
    const customs = loadCustomTemplates(this.filePath)
    const next = customs.filter((t) => t.id !== id)
    saveCustomTemplates(this.filePath, next)
    return next.length !== customs.length
  }
}
