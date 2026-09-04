// Rendering/parsing of one vault note (frontmatter + body) — pure, no fs. See
// docs/superpowers/specs/2026-08-26-memory-vault-design.md §5, §8.1, §5.1 note on
// nest_content_hash.
import { createHash } from 'crypto'
import type { MemoryRecord } from './memory-port'

export const VAULT_VERSION = 1

// Every scalar is emitted as a JSON-double-quoted string. YAML's double-quoted scalar
// syntax uses the same C-style escapes as JSON (\", \\, \n, \t, \uXXXX...), so
// JSON.stringify() output is valid YAML verbatim — a real YAML string emitter without
// pulling in a YAML library, and one whose escaping is trivially exact to invert in
// parseNote below (JSON.parse of the same substring).
function emitString(value: string): string {
  return JSON.stringify(value)
}

function emitStringArray(values: string[]): string {
  return `[${values.map(emitString).join(', ')}]`
}

function emitScalar(value: string | number | boolean | null): string {
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return emitString(value)
}

export interface NoteContext {
  /** Readable project name for the frontmatter `project:` field (folder-name resolution, vault-naming.ts). */
  projectDisplayName: string
  /** Full sync_id of the row this one lost to, or null if it's active. */
  supersededByAlias: string | null
  /** Full sync_ids of rows this one beat (derived by inverting superseded_by across the project, §5.3). */
  supersedesAliases: string[]
}

/**
 * `sha256(title.trim().toLowerCase() + '\n' + content.trim().toLowerCase())` —
 * REIMPLEMENTED, not imported, from `memory-store.ts`'s `contentHash()` (the vault must
 * stand on its own; see vault spec §12 module table). `vaultContentHash.test.ts`'s fixed
 * vector is the tripwire: if the two formulas ever drift, that test fails loudly instead
 * of every existing note silently landing in `_conflicts/` (V-R5).
 */
export function vaultContentHash(title: string, content: string | null): string {
  const normalized = `${title.trim().toLowerCase()}\n${(content ?? '').trim().toLowerCase()}`
  return createHash('sha256').update(normalized).digest('hex')
}

/**
 * Strips absolute-path segments out of `source_ref` (§8.1) — the markdown importer writes
 * `{label}:{absolute file path}#{topicKey}`, which can contain a client/company name in the
 * path. A `graph:`-style ref with no path segment (no `/` or `\`) is left byte-identical —
 * `scrubSourceRef('graph:run-8812:rev-security:0')` must round-trip exactly (§13).
 */
export function scrubSourceRef(sourceRef: string): string {
  const labelSep = sourceRef.indexOf(':')
  if (labelSep === -1) return sourceRef
  const label = sourceRef.slice(0, labelSep)
  const rest = sourceRef.slice(labelSep + 1)

  // Only the exact `{label}:{path}#{topicKey}` shape the markdown importer writes
  // (markdown.ts:51) is scrubbed. Without a `#`, this isn't that shape — a bridge ref like
  // `ci:{repoFullName}:{branch}:{runUrl}` can contain `/` (an org/repo, a URL) without
  // being a path, and must round-trip byte-identical (§13).
  const hashSep = rest.lastIndexOf('#')
  if (hashSep === -1) return sourceRef

  const pathPart = rest.slice(0, hashSep)
  const suffix = rest.slice(hashSep) // includes the leading '#'
  if (!pathPart.includes('/') && !pathPart.includes('\\')) return sourceRef

  const segments = pathPart.split(/[\\/]/).filter(Boolean)
  const basename = segments[segments.length - 1] ?? pathPart
  return `${label}:${basename}${suffix}`
}

/**
 * `record.content` verbatim in the body — never re-redacted, never reformatted (§5.2,
 * §8.3: rewriting it would make the file stop being the proof the store's data matches).
 * `source_ref` must already be scrubbed by the caller (vault-plan.ts) before it reaches
 * here — this function does not know which fields are safe to emit raw.
 */
export function renderNote(record: MemoryRecord, ctx: NoteContext): string {
  const lines: string[] = ['---']
  const field = (key: string, value: string): void => { lines.push(`${key}: ${value}`) }

  field('nest_sync_id', emitString(record.syncId))
  field('aliases', emitStringArray([record.syncId]))
  field('title', emitString(record.title))
  field('type', emitString(record.type))
  field('scope', emitString(record.scope))
  field('project', emitString(ctx.projectDisplayName))
  field('project_key', emitString(record.projectKey))
  field('topic_key', emitScalar(record.topicKey))
  field('tags', emitStringArray(record.tags))
  field('source', emitString(record.source))
  field('source_ref', emitScalar(record.sourceRef))
  field('origin_ai', emitScalar(record.originAi))
  field('origin_account', emitScalar(record.originAccount))
  field('git_branch', emitScalar(record.gitBranch))
  field('author', emitScalar(record.authorDisplay))
  field('created', emitString(new Date(record.createdAt).toISOString()))
  field('updated', emitString(new Date(record.updatedAt).toISOString()))
  field('revision_count', emitScalar(record.revisionCount))
  field('duplicate_count', emitScalar(record.duplicateCount))
  field('superseded_by', ctx.supersededByAlias ? emitString(`[[${ctx.supersededByAlias}]]`) : 'null')
  field('supersedes', emitStringArray(ctx.supersedesAliases.map((a) => `[[${a}]]`)))
  field('nest_content_hash', emitString(record.contentHash))
  field('nest_vault_version', emitScalar(VAULT_VERSION))
  field('nest_generated', 'true')

  lines.push('---', '')
  lines.push(`# ${record.title}`, '')
  // `content: null` with `deleted: 0` shouldn't happen (the type allows it defensively —
  // deleteObservation() is the only writer of null content, and it also sets deleted=1),
  // but this must never throw — treat it as an empty body; vault-plan.ts is responsible
  // for emitting the warning (§13's "no rompe: se trata como cuerpo vacío y se emite warning").
  lines.push(record.content ?? '')

  // `\n` always, even on Windows (§11) — the vault is portable data, not a source file
  // whose line endings should follow the host OS; CRLF-on-Windows-only would make the
  // same logical vault hash differently depending on which machine generated it.
  return lines.join('\n')
}

export interface ParsedNote {
  frontmatter: Record<string, unknown>
  body: string
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === 'null') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed.startsWith('"')) {
    try { return JSON.parse(trimmed) } catch { return trimmed }
  }
  if (trimmed.startsWith('[')) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner) return []
    // Every element is a JSON-quoted string (emitStringArray's contract) — match each
    // quoted segment rather than a naive split(','), since an element's own content can
    // contain a comma.
    const matches = inner.match(/"(?:[^"\\]|\\.)*"/g) ?? []
    return matches.map((m) => { try { return JSON.parse(m) } catch { return m } })
  }
  const num = Number(trimmed)
  if (trimmed !== '' && !Number.isNaN(num)) return num
  return trimmed
}

/**
 * Inverts `renderNote`. Returns null if `text` has no `---`-delimited frontmatter block
 * at all (not a vault note, or corrupted beyond recognition) — callers treat that as "not
 * ours", never as a crash.
 */
export function parseNote(text: string): ParsedNote | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!match) return null

  const frontmatter: Record<string, unknown> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(': ')
    if (sep === -1) continue
    const key = line.slice(0, sep).trim()
    const value = line.slice(sep + 2)
    frontmatter[key] = parseScalar(value)
  }

  return { frontmatter, body: match[2] }
}
