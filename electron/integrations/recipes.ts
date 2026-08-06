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
import { dirname, join } from 'path'
import { ravenHome } from '../raven-home'
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
    // H5 Motor 4 — notify DIRIGIDO (eventos del ciclo propio → Slack). El
    // channel va vacío: lo resuelve handleNotify desde getConfig('slack').channel.
    {
      id: 'h5:pr.merged→notify',
      when: 'pr.merged',
      then: (ev) => {
        const e = ev as { repoFullName: string; branch: string }
        return [{ cmd: 'notify', channel: '', message: `✅ PR mergeado en ${e.repoFullName} (${e.branch})` }]
      },
    },
    {
      id: 'h5:ci.failed→notify',
      when: 'ci.failed',
      then: (ev) => {
        const e = ev as { branch: string; runUrl?: string }
        return [{ cmd: 'notify', channel: '', message: `🔴 CI rojo en ${e.branch}${e.runUrl ? ` — ${e.runUrl}` : ''}` }]
      },
    },
    {
      id: 'h5:changes.requested→notify',
      when: 'changes.requested',
      then: (ev) => {
        const e = ev as { repoFullName: string; prNumber: number }
        return [{ cmd: 'notify', channel: '', message: `✏️ Te pidieron cambios en PR #${e.prNumber} (${e.repoFullName})` }]
      },
    },
    {
      id: 'h5:review.requested→notify',
      when: 'review.requested',
      then: (ev) => {
        const e = ev as { repoFullName: string; prNumber: number; prTitle: string }
        return [{ cmd: 'notify', channel: '', message: `👀 Te pidieron revisar PR #${e.prNumber}: ${e.prTitle}` }]
      },
    },
    // Auto-status del terminal: al abrir una sesión, refleja el foco en Slack.
    // El clear en session.closed queda como follow-up (nadie emite ese evento hoy).
    {
      id: 'h5:session.opened→presence',
      when: 'session.opened',
      then: (ev) => [{ cmd: 'setPresence', text: `focus: ${(ev as { branch: string }).branch}` }],
    },
    // H6 Motor 4 (salida) — registra el outcome del merge en el calendario. `ref`
    // es el branch como fallback (el matcheo por taskId mejora cuando el evento lo
    // traiga). El handler resuelve append-vs-create y degrada a no-op sin gcal.
    {
      id: 'h6:pr.merged→logOutcome',
      when: 'pr.merged',
      then: (ev) => {
        const e = ev as { branch: string; repoFullName: string }
        return [{ cmd: 'logOutcome', ref: e.branch, summary: `🪺 Nest: merge en ${e.repoFullName} (${e.branch})` }]
      },
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
  'changes.requested', 'review.requested',
]

/** Valida una receta almacenada (venida de disco, `unknown`), o null si es inválida. */
function toStoredRecipe(x: unknown): StoredRecipe | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  if (typeof r.when !== 'string' || !EVENT_TYPES.includes(r.when as DomainEvent['type'])) return null
  if (!Array.isArray(r.emit) || !r.emit.every(isCommand)) return null
  return { id: r.id, when: r.when as DomainEvent['type'], emit: r.emit as Command[] }
}

/** Convierte una receta almacenada (venida de disco, `unknown`) en runtime, o null si es inválida. */
function toRecipe(x: unknown): Recipe | null {
  const stored = toStoredRecipe(x)
  if (!stored) return null
  const emit = stored.emit
  return { id: stored.id, when: stored.when, then: () => emit.map((c) => ({ ...c })) }
}

/**
 * Lee las recetas almacenadas SIN convertirlas a `Recipe` runtime (no hace
 * falta `lookup`: las usa `recipeDescriptors`, sólo display). Archivo
 * inexistente, JSON ilegible o sin recetas válidas → `[]` (nunca tira; el
 * warn de recetas inválidas ya lo hace `loadRecipes` cuando el bus las carga
 * de verdad, así no se duplica el log en cada `recipes:list`).
 */
export function loadStoredRecipes(filePath: string): StoredRecipe[] {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return []
  }
  try {
    const data = JSON.parse(raw) as { recipes?: unknown }
    const stored = Array.isArray(data.recipes) ? data.recipes : []
    const out: StoredRecipe[] = []
    for (const s of stored) {
      const rec = toStoredRecipe(s)
      if (rec) out.push(rec)
    }
    return out
  } catch {
    return []
  }
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

// ── Recipes tab (renderer, read-only — Plan 5 Task 1) ───────────────────────
// `recipeDescriptors()` backs the `recipes:list` IPC: a read-only "when event
// → commands" view for the Recipes tab. It never invokes a Recipe's dynamic
// `then(ev)` (that needs a real event + `lookup`, which display code doesn't
// have) — instead it's a static, hand-written mirror of what `defaultRecipes`
// above actually emits. Keep the two in sync when either changes.

/** Human-readable label for one command; shared by defaults and stored recipes. */
export function describeCommand(cmd: Command): string {
  switch (cmd.cmd) {
    case 'notify':
      return `notify ${cmd.channel || '#channel'}`
    case 'updateStatus':
      return `updateStatus: ${cmd.to}`
    case 'logOutcome':
      return 'logOutcome'
    case 'setPresence':
      return 'setPresence'
    case 'createTask':
      return 'createTask'
    case 'openSession':
      return 'openSession'
    case 'scheduleBlock':
      return 'scheduleBlock'
    default:
      return (cmd as Command).cmd
  }
}

export interface RecipeDescriptor {
  id: string
  when: string
  commands: string[]
}

// Mirrors defaultRecipes() one-to-one: same (when, command-shape) pairs, same
// order. Field values defaultRecipes() only knows at emit time (channel, ref,
// summary, ...) are placeholders here — describeCommand() never reads them.
// task.created→noop has no entry: it emits no commands, so it has nothing to
// describe (and the grouping below drops any `when` left with an empty list).
const DEFAULT_RECIPE_COMMANDS: ReadonlyArray<{ when: DomainEvent['type']; cmd: Command }> = [
  { when: 'pr.opened', cmd: { cmd: 'updateStatus', pluginId: '', providerId: '', to: 'in_review' } },
  { when: 'pr.merged', cmd: { cmd: 'updateStatus', pluginId: '', providerId: '', to: 'done' } },
  { when: 'pr.merged', cmd: { cmd: 'notify', channel: '', message: '' } },
  { when: 'ci.failed', cmd: { cmd: 'notify', channel: '', message: '' } },
  { when: 'changes.requested', cmd: { cmd: 'notify', channel: '', message: '' } },
  { when: 'review.requested', cmd: { cmd: 'notify', channel: '', message: '' } },
  { when: 'session.opened', cmd: { cmd: 'setPresence', text: '' } },
  { when: 'pr.merged', cmd: { cmd: 'logOutcome', ref: '', summary: '' } },
]

/** Groups DEFAULT_RECIPE_COMMANDS by `when` (first-seen order) into one descriptor per event. */
function defaultDescriptors(): RecipeDescriptor[] {
  const order: DomainEvent['type'][] = []
  const commandsByWhen = new Map<DomainEvent['type'], string[]>()
  for (const { when, cmd } of DEFAULT_RECIPE_COMMANDS) {
    if (!commandsByWhen.has(when)) {
      commandsByWhen.set(when, [])
      order.push(when)
    }
    commandsByWhen.get(when)!.push(describeCommand(cmd))
  }
  return order.map((when) => ({ id: `default:${when}`, when, commands: commandsByWhen.get(when)! }))
}

function defaultRecipesFilePath(): string {
  return join(ravenHome(), '.raven-nest', 'recipes.json')
}

/**
 * Display descriptors for the ACTIVE bus recipes (backs `recipes:list`).
 * Mirrors `loadRecipes`'s own activation rule so this stays honest about
 * what's really running: no valid stored recipes (file missing, unreadable,
 * or empty) → the built-in defaults; stored recipes present → only those
 * (same swap-not-merge semantics `loadRecipes` uses for the live bus).
 * `filePath` defaults to the real recipes.json; tests inject a temp path.
 */
export function recipeDescriptors(filePath: string = defaultRecipesFilePath()): RecipeDescriptor[] {
  const stored = loadStoredRecipes(filePath)
  if (stored.length === 0) return defaultDescriptors()
  return stored.map((r) => ({ id: r.id, when: r.when, commands: r.emit.map(describeCommand) }))
}
