import { describe, it, expect } from 'vitest'
import { planTeamThread, branchNoteId, DEFAULT_THREAD_TYPES, type TeamThreadConfig } from '../integrations/team-thread-plan'
import { emptyManifest } from '../integrations/vault-plan'
import type { MemoryRecord } from '../integrations/memory-port'

function record(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    syncId: 'obs-aaaaaaaaaaaaaaaa',
    projectKey: 'proj1111aaaaaaaa',
    scope: 'team',
    topicKey: null,
    type: 'handoff',
    title: 'Un handoff',
    content: 'Cuerpo del handoff.',
    tags: [],
    source: 'hook',
    originAi: 'claude',
    originAccount: 'Gero Personal',
    gitBranch: 'feat/sidebar-tabs',
    authorDisplay: 'Gero',
    sourceRef: null,
    contentHash: 'hash-v1',
    revisionCount: 0,
    duplicateCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
    deleted: false,
    supersededBy: null,
    ...over,
  }
}

const CONFIG: TeamThreadConfig = {
  projectKey: 'proj1111aaaaaaaa',
  displayName: 'raven-nest',
  includedTypes: DEFAULT_THREAD_TYPES,
  branchStates: { 'feat/sidebar-tabs': 'activa' },
  ultimaSync: 5000,
}

describe('planTeamThread', () => {
  it('EL GUARDIA: una fila personal o project NUNCA entra al hilo del equipo', () => {
    const plan = planTeamThread({
      records: [
        record({ syncId: 'obs-personal', scope: 'personal' }),
        record({ syncId: 'obs-project', scope: 'project' }),
      ],
      manifest: emptyManifest(),
      config: CONFIG,
      onDiskHashes: {},
    })

    expect(plan.writes).toHaveLength(0)
  })

  it('EL GUARDIA: una fila team con deleted true NUNCA entra al hilo del equipo', () => {
    const plan = planTeamThread({
      records: [record({ syncId: 'obs-tombstone', deleted: true })],
      manifest: emptyManifest(),
      config: CONFIG,
      onDiskHashes: {},
    })

    expect(plan.writes).toHaveLength(0)
  })

  it('EL GUARDIA: una fila team con supersededBy no nulo NUNCA entra al hilo del equipo', () => {
    const plan = planTeamThread({
      records: [record({ syncId: 'obs-vieja', supersededBy: 'obs-nueva' })],
      manifest: emptyManifest(),
      config: CONFIG,
      onDiskHashes: {},
    })

    expect(plan.writes).toHaveLength(0)
  })

  it('agrupa por rama: una nota por rama, no una por fila', () => {
    const plan = planTeamThread({
      records: [
        record({ syncId: 'obs-1', gitBranch: 'feat/sidebar-tabs' }),
        record({ syncId: 'obs-2', gitBranch: 'feat/sidebar-tabs' }),
        record({ syncId: 'obs-3', gitBranch: 'main' }),
      ],
      manifest: emptyManifest(),
      config: { ...CONFIG, branchStates: { 'feat/sidebar-tabs': 'activa', main: 'activa' } },
      onDiskHashes: {},
    })

    expect(plan.writes).toHaveLength(2)
    expect(plan.writes.map((w) => w.filePath).sort()).toEqual(['ramas/feat-sidebar-tabs.md', 'ramas/main.md'])
    expect(plan.writes.find((w) => w.filePath === 'ramas/feat-sidebar-tabs.md')!.syncId).toBe(branchNoteId('feat-sidebar-tabs'))
  })

  it('CONCURRENCIA: dos autores en la misma rama el mismo dia conservan sus dos entradas', () => {
    const plan = planTeamThread({
      records: [
        record({ syncId: 'obs-gero', authorDisplay: 'Gero', content: 'Lo de Gero', createdAt: 1000 }),
        record({ syncId: 'obs-bauti', authorDisplay: 'Bauti', content: 'Lo de Bauti', createdAt: 2000 }),
      ],
      manifest: emptyManifest(),
      config: CONFIG,
      onDiskHashes: {},
    })

    const nota = plan.writes[0].content
    expect(nota).toContain('Lo de Gero')
    expect(nota).toContain('Lo de Bauti')
    expect(nota).toContain('Gero')
    expect(nota).toContain('Bauti')
  })

  it('las filas sin rama van a general.md', () => {
    const plan = planTeamThread({
      records: [record({ gitBranch: null })],
      manifest: emptyManifest(),
      config: CONFIG,
      onDiskHashes: {},
    })

    expect(plan.writes.map((w) => w.filePath)).toEqual(['general.md'])
  })

  it('solo entran los tipos incluidos', () => {
    const plan = planTeamThread({
      records: [
        record({ syncId: 'obs-h', type: 'handoff' }),
        record({ syncId: 'obs-b', type: 'bugfix' }),
      ],
      manifest: emptyManifest(),
      config: CONFIG,
      onDiskHashes: {},
    })

    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0].content).not.toContain('obs-b')
  })

  it('no reescribe si nada cambio (hash-compare)', () => {
    const primera = planTeamThread({
      records: [record()],
      manifest: emptyManifest(),
      config: CONFIG,
      onDiskHashes: {},
    })
    const w = primera.writes[0]
    const manifest = { entries: { [w.syncId]: { filePath: w.filePath, sourceHash: w.sourceHash, fileHash: w.fileHash } } }

    const segunda = planTeamThread({
      records: [record()],
      manifest,
      config: CONFIG,
      onDiskHashes: { [w.filePath]: w.fileHash },
    })

    expect(segunda.writes).toHaveLength(0)
  })

  it('preserva los bytes del usuario si edito el archivo a mano', () => {
    const primera = planTeamThread({ records: [record()], manifest: emptyManifest(), config: CONFIG, onDiskHashes: {} })
    const w = primera.writes[0]
    const manifest = { entries: { [w.syncId]: { filePath: w.filePath, sourceHash: w.sourceHash, fileHash: w.fileHash } } }

    const segunda = planTeamThread({
      records: [record({ contentHash: 'hash-v2', content: 'Cuerpo nuevo.' })],
      manifest,
      config: CONFIG,
      onDiskHashes: { [w.filePath]: 'hash-de-lo-que-escribio-el-usuario' },
    })

    expect(segunda.conflicts).toHaveLength(1)
    expect(segunda.conflicts[0].conflictPath).toBe('ramas/_conflicts/feat-sidebar-tabs.md')
  })

  it('borra la nota de una rama que se quedo sin filas', () => {
    const manifest = {
      entries: { [branchNoteId('rama-vieja')]: { filePath: 'ramas/rama-vieja.md', sourceHash: 'h', fileHash: 'f' } },
    }
    const plan = planTeamThread({ records: [record()], manifest, config: CONFIG, onDiskHashes: {} })

    expect(plan.deletes.map((d) => d.filePath)).toContain('ramas/rama-vieja.md')
  })

  it('una fila con pinta de secreto queda advertida', () => {
    const plan = planTeamThread({
      records: [record({ content: 'el token es ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })],
      manifest: emptyManifest(),
      config: CONFIG,
      onDiskHashes: {},
    })

    expect(plan.warnings.some((w) => w.kind === 'possible-secret')).toBe(true)
  })

  it('siempre emite el indice cuando algo cambio', () => {
    const plan = planTeamThread({ records: [record()], manifest: emptyManifest(), config: CONFIG, onDiskHashes: {} })
    expect(plan.indexWrites.map((i) => i.filePath)).toEqual(['_index.md'])
  })

  // I4: el puntero de AGENTS.md se escribe siempre; si el indice no se emite hasta que algo
  // cambie, el primer dia de todo usuario deja una linea commiteable apuntando a la nada.
  it('I4: sin indice en disco lo emite AUNQUE no haya cambiado nada — ni una sola fila team', () => {
    const plan = planTeamThread({
      records: [],
      manifest: emptyManifest(),
      config: CONFIG,
      onDiskHashes: {},
      indexOnDisk: false,
    })

    expect(plan.writes).toHaveLength(0)
    expect(plan.indexWrites.map((i) => i.filePath)).toEqual(['_index.md'])
  })

  it('I4: con el indice ya en disco y nada que cambiar, NO lo reescribe', () => {
    const primera = planTeamThread({ records: [record()], manifest: emptyManifest(), config: CONFIG, onDiskHashes: {} })
    const w = primera.writes[0]
    const manifest = { entries: { [w.syncId]: { filePath: w.filePath, sourceHash: w.sourceHash, fileHash: w.fileHash } } }

    const segunda = planTeamThread({
      records: [record()],
      manifest,
      config: CONFIG,
      onDiskHashes: { [w.filePath]: w.fileHash },
      indexOnDisk: true,
    })

    expect(segunda.writes).toHaveLength(0)
    expect(segunda.indexWrites).toHaveLength(0)
  })

  it('DETERMINISMO: dos ramas que colisionan de slug producen el mismo sourceHash sin importar el orden', () => {
    // 'feat/sidebar-tabs' y 'feat_sidebar-tabs' slugean igual (vaultSlug trata '/' y '_'
    // como el mismo separador) y caen en el mismo bucket. Tienen `estado` distinto en
    // branchStates: si el desempate dependiera del orden de `records`, el `sourceHash`
    // cambiaria segun como llegue el array.
    const config: TeamThreadConfig = {
      ...CONFIG,
      branchStates: { 'feat/sidebar-tabs': 'activa', 'feat_sidebar-tabs': 'cerrada' },
    }
    const filaSlash = record({ syncId: 'obs-slash', gitBranch: 'feat/sidebar-tabs' })
    const filaGuion = record({ syncId: 'obs-guion', gitBranch: 'feat_sidebar-tabs' })

    const planOrdenA = planTeamThread({
      records: [filaSlash, filaGuion],
      manifest: emptyManifest(),
      config,
      onDiskHashes: {},
    })
    const planOrdenB = planTeamThread({
      records: [filaGuion, filaSlash],
      manifest: emptyManifest(),
      config,
      onDiskHashes: {},
    })

    expect(planOrdenA.writes).toHaveLength(1)
    expect(planOrdenB.writes).toHaveLength(1)
    expect(planOrdenA.writes[0].sourceHash).toBe(planOrdenB.writes[0].sourceHash)
  })
})
