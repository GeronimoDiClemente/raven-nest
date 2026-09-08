// El corazon de Layer 2: filas de scope `team` -> VaultPlan. Puro, sin fs, para que aca
// viva el grueso de los tests. Ver spec §5 y §6.
//
// Por que un modulo nuevo y no un flag en vault-plan.ts: ese modulo EXCLUYE el scope team
// por decision de producto (privacidad de companeros, Task 5 del vault). Un bug de config
// ahi filtraria notas de companeros al vault personal. Aca la separacion la garantiza la
// estructura, no un booleano.
import type { ObservationType } from '../memory-protocol'
import { redact } from '../memory-redaction'
import type { MemoryRecord } from './memory-port'
import {
  groupThreadBranches,
  renderBranchNote,
  renderThreadIndex,
  threadIndexRowFor,
  type EstadoRama,
  type ThreadIndexBranch,
} from './team-thread-note'
import { conflictPathFor, sha256 } from './vault-hash'
import type {
  VaultConflict,
  VaultDelete,
  VaultIndexWrite,
  VaultManifest,
  VaultPlan,
  VaultWarning,
  VaultWrite,
} from './vault-plan'

/** Spec §6.1: por default solo el hilo, no toda la memoria del equipo. */
export const DEFAULT_THREAD_TYPES: ObservationType[] = ['handoff', 'decision']

export interface TeamThreadConfig {
  projectKey: string
  displayName: string
  includedTypes: ObservationType[]
  /** Estado de cada rama, consultado a git por el caller: este modulo no toca git. */
  branchStates: Record<string, EstadoRama>
  /** ms epoch del ultimo push exitoso. Solo va al indice (spec §4.2). */
  ultimaSync: number
}

export interface PlanTeamThreadInput {
  records: MemoryRecord[]
  manifest: VaultManifest
  config: TeamThreadConfig
  onDiskHashes: Record<string, string>
}

/** El id sintetico estable que ocupa el lugar del `syncId` del vault. Spec §4.1. */
export function branchNoteId(slug: string): string {
  return `rama:${slug}`
}

function filePathFor(slug: string): string {
  return slug === 'general' ? 'general.md' : `ramas/${slug}.md`
}

export function planTeamThread(input: PlanTeamThreadInput): VaultPlan {
  const { records, manifest, config, onDiskHashes } = input

  const writes: VaultWrite[] = []
  const deletes: VaultDelete[] = []
  const conflicts: VaultConflict[] = []
  const warnings: VaultWarning[] = []
  const indexWrites: VaultIndexWrite[] = []

  // EL GUARDIA (spec §9, test 1) + agrupamiento por rama: compartido con el camino de
  // lectura del panel (team-thread-index-query.ts, Task 10) via team-thread-note.ts, para
  // que una exclusion nueva de EL GUARDIA no pueda quedar aplicada de un solo lado.
  const groups = groupThreadBranches(records, config)

  const slugs = groups.map((g) => g.slug).sort()
  const ramasDelIndice: ThreadIndexBranch[] = []
  let algoCambio = false

  for (const { slug, branch, estado, entries } of groups) {
    for (const e of entries) {
      const { redacted } = redact(`${e.title}\n${e.content ?? ''}`)
      if (redacted) {
        warnings.push({
          syncId: e.syncId,
          kind: 'possible-secret',
          message: `"${e.title}" matchea un patron de secreto conocido — no se comparte hasta que la confirmes.`,
        })
      }
    }

    const content = renderBranchNote({ branch, estado, entries, neighbours: slugs })
    const fileHash = sha256(content)
    // El sourceHash del grupo: si ninguna fila cambio y el estado tampoco, la nota no se
    // toca. Incluye el estado a proposito, porque cambia sin que cambie ninguna fila.
    const sourceHash = sha256(
      [...entries].sort((a, b) => a.syncId.localeCompare(b.syncId)).map((e) => e.contentHash).join('|') + `|${estado}`,
    )

    const id = branchNoteId(slug)
    const filePath = filePathFor(slug)
    const previous = manifest.entries[id]

    ramasDelIndice.push(threadIndexRowFor({ slug, branch, estado, entries }))

    if (previous) {
      const onDisk = onDiskHashes[previous.filePath]
      if (onDisk !== undefined && onDisk !== previous.fileHash) {
        conflicts.push({
          syncId: id,
          filePath: previous.filePath,
          conflictPath: conflictPathFor(previous.filePath),
          freshContent: content,
          freshFileHash: fileHash,
          freshSourceHash: sourceHash,
          freshPath: filePath,
        })
        algoCambio = true
        continue
      }
      if (previous.sourceHash === sourceHash && previous.filePath === filePath) continue
    }

    writes.push({ syncId: id, filePath, content, fileHash, sourceHash })
    algoCambio = true
  }

  // Una rama que se quedo sin filas (o que dejo de ser elegible) pierde su nota.
  const vivos = new Set(groups.map((g) => branchNoteId(g.slug)))
  for (const [id, entry] of Object.entries(manifest.entries)) {
    if (!id.startsWith('rama:')) continue
    if (vivos.has(id)) continue
    deletes.push({ syncId: id, filePath: entry.filePath, reason: 'excluded' })
    algoCambio = true
  }

  if (algoCambio) {
    indexWrites.push({
      filePath: '_index.md',
      content: renderThreadIndex({
        displayName: config.displayName,
        ultimaSync: config.ultimaSync,
        branches: ramasDelIndice,
      }),
    })
  }

  return { writes, moves: [], deletes, conflicts, warnings, indexWrites, readme: README_HILO }
}

const README_HILO = `# Hilo del equipo — Nest

**Esta carpeta es un espejo. Nest la regenera. Lo que edites aca no vuelve a Nest: se
preserva en \`_conflicts/\`, no se aplica.**

- \`_index.md\` — una linea por rama, la mas reciente primero.
- \`ramas/\` — una nota por rama, con las entradas de mas nueva a mas vieja.
- \`general.md\` — lo que no esta atado a una rama.
- No entra a git: cada maquina la regenera de su propia memoria sincronizada.
`
