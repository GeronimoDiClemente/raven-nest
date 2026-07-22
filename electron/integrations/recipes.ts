// Motor de recetas del bus v1. Las `Recipe`s (definidas en event-bus.ts para
// evitar ciclos) mapean eventos → comandos; acá viven las DEFAULT_RECIPES que
// REPLICAN H3 (PR abierto → in_review, merge → done) y la persistencia opcional
// a `<ravenHome>/.raven-nest/recipes.json`. Cadena de imports permitida:
// ticket-loop → event-bus → bus-types → ticket-types. Este módulo importa
// event-bus (tipo Recipe) y bus-types (Command/DomainEvent/guards); NUNCA
// importa ticket-loop.ts — la resolución branch→ticket llega por inyección
// (`TrackedLookup`), no por import global.
import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { dirname } from 'path'
import type { Recipe } from './event-bus'
import type { Command, DomainEvent } from './bus-types'
import { isCommand } from './bus-types'

/**
 * Subconjunto del `Tracked` del TicketLoop que las DEFAULT_RECIPES necesitan
 * para resolver un branch. Estructural: el `Tracked` real (con key/repoFullName/
 * lastPr) es asignable a esto. Se declara acá para no importar ticket-loop.ts.
 */
export interface TrackedRef {
  pluginId: string
  providerId: string
}

/**
 * Resuelve el ticket trackeado para un branch (o undefined si no hay). Lo provee
 * el TicketLoop (inyección); las recetas lo consultan en `then(ev)`, cuando el
 * emit garantiza que el tracking del branch todavía está vivo.
 */
export type TrackedLookup = (branch: string) => TrackedRef | undefined

/** Extrae el branch de los eventos que lo llevan (pr.opened/pr.merged). */
function branchOf(ev: DomainEvent): string | undefined {
  return 'branch' in ev ? (ev as { branch: string }).branch : undefined
}

/**
 * Recetas por defecto que replican el comportamiento de H3 exactamente:
 *  - `pr.opened`  → `updateStatus(to: 'in_review')`
 *  - `pr.merged`  → `updateStatus(to: 'done')`
 *  - `task.created` → no-op en v1 (gancho para `notify` opcional; ver comentario)
 * pluginId/providerId se resuelven vía `lookup(branch)`. Si el branch no está
 * trackeado, la receta no produce comando (igual que H3, que hace `if(!t) return`).
 */
export function defaultRecipes(lookup: TrackedLookup): Recipe[] {
  const statusRecipe = (
    id: string,
    when: DomainEvent['type'],
    to: 'in_review' | 'done',
  ): Recipe => ({
    id,
    when,
    then: (ev) => {
      const branch = branchOf(ev)
      if (!branch) return []
      const t = lookup(branch)
      if (!t) return []
      return [{ cmd: 'updateStatus', pluginId: t.pluginId, providerId: t.providerId, to }]
    },
  })

  return [
    statusRecipe('h3:pr.opened→in_review', 'pr.opened', 'in_review'),
    statusRecipe('h3:pr.merged→done', 'pr.merged', 'done'),
    {
      // v1 no-op a propósito: la transición a in_progress la hace startWork
      // directo (sincrónica, esperada por los tests). Enrutarla acá causaría
      // doble transición. Gancho futuro: `then: () => [{ cmd: 'notify', ... }]`.
      id: 'h3:task.created→noop',
      when: 'task.created',
      then: () => [],
    },
  ]
}

/**
 * Forma serializable de una receta (para recipes.json). Las DEFAULT_RECIPES
 * tienen `then` dinámico (resuelven branch→ticket) y NO se persisten; lo que
 * round-trippea son recetas declarativas: emiten una lista fija de comandos.
 * La UI de recetas editables (bus v2) construirá estas.
 */
export interface StoredRecipe {
  id: string
  when: DomainEvent['type']
  emit: Command[]
}

const EVENT_TYPES: readonly DomainEvent['type'][] = [
  'task.created', 'session.opened', 'session.closed', 'pr.opened', 'pr.merged',
  'ci.failed', 'error.detected', 'block.started', 'meeting.transcribed',
]

/** Convierte una receta almacenada (venida de disco, `unknown`) en runtime, o null si es inválida. */
function toRecipe(x: unknown): Recipe | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  if (typeof r.when !== 'string' || !EVENT_TYPES.includes(r.when as DomainEvent['type'])) return null
  if (!Array.isArray(r.emit) || !r.emit.every(isCommand)) return null
  const emit = r.emit as Command[]
  return { id: r.id, when: r.when as DomainEvent['type'], then: () => emit.map((c) => ({ ...c })) }
}

/**
 * Carga las recetas desde disco. Archivo inexistente → DEFAULT_RECIPES (replican
 * H3). JSON ilegible → warn + DEFAULT_RECIPES (nunca crashea). Recetas con forma
 * o comandos inválidos se descartan (con warn). El `lookup` sólo se usa para las
 * defaults; las recetas almacenadas emiten comandos fijos.
 */
export function loadRecipes(filePath: string, lookup: TrackedLookup): Recipe[] {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return defaultRecipes(lookup) // primer arranque: sin archivo → defaults
  }
  try {
    const data = JSON.parse(raw) as { recipes?: unknown }
    const stored = Array.isArray(data.recipes) ? data.recipes : []
    const out: Recipe[] = []
    let dropped = 0
    for (const s of stored) {
      const rec = toRecipe(s)
      if (rec) out.push(rec)
      else dropped++
    }
    if (dropped > 0) console.warn('[recipes] descartadas', dropped, 'recetas inválidas de', filePath)
    return out
  } catch (err) {
    console.warn('[recipes] recipes.json ilegible, usando defaults', err)
    return defaultRecipes(lookup)
  }
}

/**
 * Persiste recetas declarativas a disco. Escritura atómica (tmp + rename), mismo
 * patrón que plugin-credentials.ts: un crash a mitad de escritura no corrompe el
 * archivo. Best-effort: un fallo de disco no debe romper al llamador.
 */
export function saveRecipes(filePath: string, recipes: StoredRecipe[]): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, recipes }, null, 2))
    renameSync(tmp, filePath)
  } catch (err) {
    console.warn('[recipes] recipes.json write failed', err)
  }
}
