// Render de una nota del hilo de equipo. Puro, sin fs. Ver spec §4.2.
//
// A diferencia del vault personal (una nota por observacion), aca la unidad es la RAMA:
// una nota agrupa todas las entradas de esa rama, en orden cronologico inverso.
import type { MemoryRecord } from './memory-port'
import { vaultSlug } from './vault-naming'

export const TEAM_THREAD_VERSION = 1

/** Techo del indice: es lo que se inyecta en cada sesion, ver spec §4.3. */
export const INDEX_MAX_LINES = 200

export type EstadoRama = 'activa' | 'sin-worktree' | 'cerrada'

export interface BranchNoteInput {
  branch: string | null
  estado: EstadoRama
  /** Todas las filas de esa rama; se ordenan aca, el caller no necesita hacerlo. */
  entries: MemoryRecord[]
  /** Slugs de otras notas del hilo, para los wikilinks. */
  neighbours: string[]
}

export interface ThreadIndexBranch {
  slug: string
  branch: string
  estado: EstadoRama
  ultimoAutor: string
  ultimaEntrada: number
  entradas: number
}

export interface ThreadIndexInput {
  displayName: string
  /** ms epoch. Se redondea al minuto a proposito: ver spec §4.2. */
  ultimaSync: number
  branches: ThreadIndexBranch[]
}

function emitString(value: string): string {
  return JSON.stringify(value)
}

/** `feat/sidebar-tabs` -> `feat-sidebar-tabs`. Las filas sin rama van a `general`. */
export function branchSlug(branch: string | null): string {
  if (branch === null || branch.trim() === '') return 'general'
  return vaultSlug(branch)
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** Al minuto: una marca al segundo cambiaria en cada pasada y anularia el hash-compare. */
function isoAlMinuto(ms: number): string {
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString()
}

function fecha(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

export function renderBranchNote(input: BranchNoteInput): string {
  const { branch, estado, entries, neighbours } = input
  const slug = branchSlug(branch)
  const titulo = branch ?? 'general'

  // Mas nueva primero: lo que le interesa a alguien que se esta poniendo al dia.
  const ordenadas = [...entries].sort((a, b) => b.createdAt - a.createdAt)
  const ultimaEntrada = ordenadas.length > 0 ? ordenadas[0].createdAt : 0

  const enlaces = ['[[_index]]', ...neighbours.filter((n) => n !== slug).map((n) => `[[${n}]]`)]

  const lines: string[] = ['---']
  lines.push(`nest_scope: ${emitString('team')}`)
  lines.push(`nest_rama: ${emitString(titulo)}`)
  lines.push(`nest_estado: ${emitString(estado)}`)
  lines.push(`nest_ultima_entrada: ${emitString(iso(ultimaEntrada))}`)
  lines.push(`nest_version: ${TEAM_THREAD_VERSION}`)
  lines.push(`nest_generated: true`)
  lines.push('---', '')
  lines.push(`# ${titulo}`, '')
  lines.push(enlaces.join(' · '), '')

  for (const e of ordenadas) {
    lines.push(`## ${fecha(e.createdAt)} · ${e.authorDisplay ?? 'desconocido'}`)
    lines.push('')
    if (e.title) lines.push(`**${e.title}**`, '')
    if (e.content) lines.push(e.content.trim(), '')
  }

  return lines.join('\n')
}

export function renderThreadIndex(input: ThreadIndexInput): string {
  const { displayName, ultimaSync, branches } = input
  const ordenadas = [...branches].sort((a, b) => b.ultimaEntrada - a.ultimaEntrada)

  const head: string[] = ['---']
  head.push(`nest_scope: ${emitString('team')}`)
  head.push(`nest_proyecto: ${emitString(displayName)}`)
  head.push(`nest_ultima_sync: ${emitString(isoAlMinuto(ultimaSync))}`)
  head.push(`nest_version: ${TEAM_THREAD_VERSION}`)
  head.push('---', '')
  head.push(`# ${displayName} — hilo del equipo`, '')

  const cuerpo: string[] = []
  // Se reservan las 2 lineas del aviso de recorte MAS la que agrega el '\n' final, para
  // que `split('\n').length` respete el techo de verdad y no por uno.
  const techo = INDEX_MAX_LINES - head.length - 3
  const visibles = ordenadas.slice(0, Math.max(techo, 0))

  for (const b of visibles) {
    const marca = b.estado === 'activa' ? '' : ` _(${b.estado})_`
    cuerpo.push(`- [[${b.slug}]] — ${b.branch}${marca} · ${b.ultimoAutor} · ${b.entradas} entrada(s)`)
  }

  const pie: string[] = []
  if (visibles.length < ordenadas.length) {
    pie.push('', `_${ordenadas.length - visibles.length} rama(s) mas: recortado por recencia._`)
  }

  return [...head, ...cuerpo, ...pie].join('\n') + '\n'
}
