// Task 14 — los dos problemas abiertos del cifrado de equipo, en el daemon:
//  1. La clave de una fila de equipo BAJADA la elige el `team_id` que manda el servidor.
//  2. El push de equipo falla cerrado (spec §9.4): una fila de un equipo que cifra no sale en
//     claro si este device no tiene la clave; se retiene y sale cifrada cuando la consigue.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { MemoryDaemon, mapRawPulledRow, REVERSIBLE_REJECTIONS, type MemoryDaemonDeps } from '../memory-daemon'
import { deriveKeys, generateMasterKey, isCiphertext, type MemoryKeys } from '../memory-crypto'
import { sealMutationPayload, type EnvelopeContext } from '../memory-envelope'

const TEAM = '11111111-1111-4111-8111-111111111111'
const TEAM2 = '22222222-2222-4222-8222-222222222222'
const keysPersonal = deriveKeys(generateMasterKey())
const keysEquipo = deriveKeys(generateMasterKey())

let dir: string
let store: MemoryStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nest-cifrado-equipo-'))
  store = new MemoryStore(join(dir, 'memory.db'))
  store.ensureProject({ projectKey: 'proj1', displayName: 'raven-nest' })
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

/** Como lo arma main.ts: push por `projects.team_id` local, pull por el `team_id` del servidor. */
function ctxCon(equipos: Map<string, MemoryKeys>): EnvelopeContext {
  return {
    keys: keysPersonal, keyEpoch: 1,
    teamKeys: (pk) => { const t = store.teamIdForProjectKey(pk); return t ? equipos.get(t) ?? null : null },
    teamKeysById: (t) => equipos.get(t) ?? null,
  }
}

/** Una fila de equipo sellada por OTRO miembro, tal como la devuelve el pull. */
function filaDeEquipoCifrada(teamId?: string) {
  const s = sealMutationPayload({ keys: deriveKeys(generateMasterKey()), keyEpoch: 1, teamKeys: () => keysEquipo }, {
    sync_id: 'obs-equipo', project_key: 'proj1', scope: 'team', type: 'decision',
    title: 'decision de equipo', content: 'cuerpo de equipo', tags: ['x'], content_hash: 'h',
  })
  return {
    sync_id: 'obs-equipo', project_key: 'proj1', scope: 'team', type: 'decision', topic_key: null,
    title: s.title, content: s.content, tags: s.tags, content_hash: s.content_hash,
    lamport: 3, client_updated_at: new Date(1_700_000_000_000).toISOString(),
    deleted: false, superseded_by: null, project_seq: 7,
    ...(teamId ? { team_id: teamId } : {}),
  }
}

interface OpcionesServidor {
  keyEpoch?: number
  encryptedTeams?: Array<{ team_id: string; has_wrap: boolean }>
  projects?: Array<{ project_key: string; display_name: string; team_id?: string | null }>
  filas?: unknown[]
  statusCaido?: boolean
  rechazoDeEquipo?: string
}

function servidor(op: OpcionesServidor) {
  const subidas: Array<Record<string, unknown>> = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const ok = (j: unknown) => ({ ok: true, status: 200, json: async () => j } as unknown as Response)
    if (String(url).includes('/status')) {
      if (op.statusCaido) return { ok: false, status: 502, json: async () => ({}) } as unknown as Response
      return ok({
        device_id: 'dev', user_id: 'u', plan: 'team', next_poll_ms: 300_000,
        quota: { used_bytes: 0, max_bytes: 1_000_000 }, projects: op.projects ?? [],
        key_epoch: op.keyEpoch ?? 1,
        ...(op.encryptedTeams ? { encrypted_teams: op.encryptedTeams } : {}),
      })
    }
    if (String(url).includes('/pull')) return ok({ rows: op.filas ?? [], cursors: {} })
    const body = JSON.parse(String(init?.body ?? '{}')) as { mutations?: Array<{ sync_id: string; payload: Record<string, unknown> }> }
    for (const m of body.mutations ?? []) subidas.push(m.payload)
    return ok({
      results: (body.mutations ?? []).map((m) => op.rechazoDeEquipo && m.payload.scope === 'team'
        ? { sync_id: m.sync_id, outcome: 'rejected', project_seq: 0, error: op.rechazoDeEquipo }
        : { sync_id: m.sync_id, outcome: 'applied', project_seq: 1 }),
    })
  }) as unknown as typeof fetch
  return { fetchImpl, subidas }
}

function daemon(fetchImpl: typeof fetch, getCtx: () => EnvelopeContext | null, extra: Partial<MemoryDaemonDeps> = {}) {
  return new MemoryDaemon({
    store, getSyncBaseUrl: () => 'http://sync.test', getToken: () => 'tok', getDeviceId: () => 'dev',
    isOnline: () => true, fetchImpl, getEnvelopeContext: getCtx,
    isEncryptionExpected: () => store.knownKeyEpoch() > 0, // el cableado de main.ts
    ...extra,
  })
}

const guardar = (scope: 'team' | 'personal', title: string) =>
  store.save({ projectKey: 'proj1', scope, type: 'decision', title, content: `cuerpo de ${title}`, source: 'mcp' })

describe('Problema 1 — la clave de una fila bajada la elige el team_id del servidor', () => {
  it('mapRawPulledRow lee team_id', () => {
    expect(mapRawPulledRow(filaDeEquipoCifrada(TEAM)).teamId).toBe(TEAM)
    expect(mapRawPulledRow(filaDeEquipoCifrada()).teamId).toBeUndefined()
  })

  it('un compañero que NUNCA compartió su copia (team_id local null) la descifra', () => {
    expect(store.teamIdForProjectKey('proj1')).toBeNull()
    daemon(servidor({}).fetchImpl, () => ctxCon(new Map([[TEAM, keysEquipo]])))
      .applyPulledRow(mapRawPulledRow(filaDeEquipoCifrada(TEAM)))
    expect(store.get('obs-equipo')?.title).toBe('decision de equipo')
    expect(store.undecryptableCount()).toBe(0)
  })

  it('una fila de equipo ilegible NO arma el gate PERSONAL, ni marca el equipo: con team_id del servidor, manda el status', () => {
    daemon(servidor({}).fetchImpl, () => null).applyPulledRow(mapRawPulledRow(filaDeEquipoCifrada(TEAM)))
    expect(store.undecryptableCount()).toBe(1)
    expect(store.knownKeyEpoch(), 'un miembro sin cifrado personal no puede quedar en needs_key').toBe(0)
    // I1 (review Tasks 13-14): el servicio que manda `team_id` en la fila también manda
    // `encrypted_teams` en el status, y ésa es la fuente de verdad. Aprenderlo de la fila marcaba
    // para siempre a un equipo que NO cifra (re-share de T1 a T2: la fila vieja viaja como T2).
    expect(store.isTeamEncrypted(TEAM)).toBe(false)
  })

  it('contra un servicio viejo (sin team_id en la fila), la ilegible arma el gate por el team_id local', () => {
    store.setLocalTeamId('proj1', TEAM)
    daemon(servidor({}).fetchImpl, () => null).applyPulledRow(mapRawPulledRow(filaDeEquipoCifrada()))
    expect(store.knownKeyEpoch()).toBe(0)
    expect(store.isTeamEncrypted(TEAM)).toBe(true)
  })
})

describe('Problema 2 (§9.4) — el push de equipo falla cerrado', () => {
  beforeEach(() => store.setLocalTeamId('proj1', TEAM)) // este device es quien compartió

  it('equipo cifrado (lo dice el status) y sin clave: la fila de equipo NO sale, la personal sí', async () => {
    guardar('personal', 'nota personal')
    guardar('team', 'nota de equipo')
    const srv = servidor({ encryptedTeams: [{ team_id: TEAM, has_wrap: false }] })
    await daemon(srv.fetchImpl, () => ctxCon(new Map())).push()
    expect(srv.subidas.map((p) => p.scope)).toEqual(['personal'])
    expect(store.blockedMutations().map((m) => m.blocked_reason)).toEqual(['team_key_missing'])
    expect(store.pendingMutationCount()).toBe(0) // retenida, no reintentada en cada ciclo
  })

  it('sin cifrado PERSONAL (ctx null) y equipo cifrado: tampoco sale en claro', async () => {
    guardar('team', 'nota de equipo')
    const srv = servidor({ keyEpoch: 0, encryptedTeams: [{ team_id: TEAM, has_wrap: false }] })
    await daemon(srv.fetchImpl, () => null).push()
    expect(srv.subidas).toEqual([])
    expect(store.blockedMutations()).toHaveLength(1)
  })

  it('el equipo se sabe cifrado por el store aunque el status de hoy no lo diga (servicio viejo)', async () => {
    store.rememberEncryptedTeams([TEAM])
    guardar('team', 'nota de equipo')
    const srv = servidor({}) // sin encrypted_teams
    await daemon(srv.fetchImpl, () => ctxCon(new Map())).push()
    expect(srv.subidas).toEqual([])
  })

  it('al conseguir la clave, onTeamKeysChanged la libera y sale CIFRADA', async () => {
    guardar('team', 'nota de equipo')
    const equipos = new Map<string, MemoryKeys>()
    const srv = servidor({ encryptedTeams: [{ team_id: TEAM, has_wrap: true }] })
    const d = daemon(srv.fetchImpl, () => ctxCon(equipos))
    await d.push()
    expect(srv.subidas).toEqual([])

    equipos.set(TEAM, keysEquipo)
    d.onTeamKeysChanged()
    await d.push() // se cuelga del push que disparó onTeamKeysChanged (M19)
    expect(srv.subidas).toHaveLength(1)
    expect(isCiphertext(String(srv.subidas[0].title))).toBe(true)
    expect(store.blockedMutations()).toEqual([])
  })

  it('un equipo que NO cifra sigue subiendo en claro, como hoy', async () => {
    guardar('team', 'nota de equipo')
    const srv = servidor({ encryptedTeams: [] })
    await daemon(srv.fetchImpl, () => ctxCon(new Map())).push()
    expect(srv.subidas[0].title).toBe('nota de equipo')
  })

  it('el rechazo team_encryption_required del servidor es reversible: se retiene, no se descarta', async () => {
    expect(REVERSIBLE_REJECTIONS.has('team_encryption_required')).toBe(true)
    guardar('team', 'nota de equipo')
    const srv = servidor({ encryptedTeams: [], rechazoDeEquipo: 'team_encryption_required' })
    await daemon(srv.fetchImpl, () => ctxCon(new Map())).push()
    // M1: con `team_id` local, el rechazo enseña que ESE equipo cifra y la fila queda retenida
    // por el gate (`team_key_missing`), no como un rechazo que se reenvía en claro al liberarse.
    expect(store.blockedMutations().map((m) => m.blocked_reason)).toEqual(['team_key_missing'])
  })

  it('con filas de equipo pendientes, el primer push espera al status aunque no haya gate personal cableado', async () => {
    guardar('team', 'nota de equipo')
    const op: OpcionesServidor = { statusCaido: true, encryptedTeams: [{ team_id: TEAM, has_wrap: false }] }
    const srv = servidor(op)
    const d = daemon(srv.fetchImpl, () => ctxCon(new Map()), { isEncryptionExpected: undefined })
    await d.push()
    expect(srv.subidas, 'sin saber si el equipo cifra, no sale nada').toEqual([])
    op.statusCaido = false
    await d.push()
    expect(srv.subidas).toEqual([])
    expect(store.isTeamEncrypted(TEAM)).toBe(true)
  })
})

describe('status — roster y readopción (Task 14)', () => {
  it('el roster sincroniza projects.team_id local (la OTRA máquina de quien compartió)', async () => {
    store.ensureProject({ projectKey: 'proj2', displayName: 'otro' })
    await daemon(servidor({ projects: [{ project_key: 'proj2', display_name: 'otro', team_id: TEAM }] }).fetchImpl, () => null).status()
    expect(store.teamIdForProjectKey('proj2')).toBe(TEAM)
  })

  it('aprender por el roster que el proyecto está compartido libera project_not_shared_with_team', async () => {
    store.ensureProject({ projectKey: 'proj2', displayName: 'otro' })
    store.save({ projectKey: 'proj2', scope: 'team', type: 'decision', title: 't', content: 'c', source: 'mcp' })
    store.blockMutations(store.pendingMutations().map((m) => ({ seq: m.seq, reason: 'project_not_shared_with_team' })))
    await daemon(servidor({ projects: [{ project_key: 'proj2', display_name: 'otro', team_id: TEAM }] }).fetchImpl, () => null).status()
    expect(store.blockedMutations()).toEqual([])
  })

  it('aprender el share por el roster también devuelve a la cola lo rechazado con team_encryption_required', async () => {
    store.ensureProject({ projectKey: 'proj2', displayName: 'otro' })
    store.save({ projectKey: 'proj2', scope: 'team', type: 'decision', title: 't', content: 'c', source: 'mcp' })
    store.blockMutations(store.pendingMutations().map((m) => ({ seq: m.seq, reason: 'team_encryption_required' })))
    await daemon(servidor({ projects: [{ project_key: 'proj2', display_name: 'otro', team_id: TEAM }] }).fetchImpl, () => null).status()
    expect(store.blockedMutations()).toEqual([])
  })

  it('el hook de readopción corre ANTES del pull del mismo drain: la fila ya abre', async () => {
    const equipos = new Map<string, MemoryKeys>()
    const vistos: unknown[] = []
    const srv = servidor({ encryptedTeams: [{ team_id: TEAM, has_wrap: true }], filas: [filaDeEquipoCifrada(TEAM)] })
    const d = daemon(srv.fetchImpl, () => ctxCon(equipos), {
      onEncryptedTeams: async (teams) => { vistos.push(teams); equipos.set(TEAM, keysEquipo) },
    })
    d.onNetworkRegain()
    await vi.waitFor(() => expect(store.get('obs-equipo')?.title).toBe('decision de equipo'))
    expect(vistos).toEqual([[{ teamId: TEAM, hasWrap: true }]])
    expect(store.undecryptableCount()).toBe(0)
  })

  it('el primer push de la sesión espera a la readopción: una fila de equipo ya encolada al arrancar sale cifrada, nunca en claro', async () => {
    // I2: lo que el e2e no puede forzar (allá la readopción, un round trip local, le gana igual
    // a status→pull→push). Acá el hook tarda lo que el test quiera.
    store.setLocalTeamId('proj1', TEAM)
    guardar('team', 'encolada antes de arrancar')
    const equipos = new Map<string, MemoryKeys>()
    let soltar!: () => void
    const readopcion = new Promise<void>((r) => { soltar = r })
    const srv = servidor({ encryptedTeams: [{ team_id: TEAM, has_wrap: true }] })
    const d = daemon(srv.fetchImpl, () => ctxCon(equipos), {
      onEncryptedTeams: async () => { await readopcion; equipos.set(TEAM, keysEquipo) },
    })
    const push = d.push()
    await new Promise((r) => setTimeout(r, 50))
    expect(srv.subidas, 'nada sale mientras la readopción está en vuelo').toEqual([])
    soltar()
    await push
    expect(srv.subidas).toHaveLength(1)
    expect(isCiphertext(String(srv.subidas[0].title))).toBe(true)
  })

  it('un hook que se cuelga no traba el status', async () => {
    vi.useFakeTimers()
    try {
      const d = daemon(servidor({ encryptedTeams: [{ team_id: TEAM, has_wrap: true }] }).fetchImpl, () => null, {
        onEncryptedTeams: () => new Promise<void>(() => {}),
      })
      const p = d.status()
      await vi.advanceTimersByTimeAsync(10_001)
      await expect(p).resolves.not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

/** Una fila sellada con `keys` por otro miembro, del proyecto `pk`, con el team_id que diga el servidor. */
function filaSellada(syncId: string, keys: MemoryKeys, teamId?: string, pk = 'proj1') {
  const s = sealMutationPayload({ keys: deriveKeys(generateMasterKey()), keyEpoch: 1, teamKeys: () => keys }, {
    sync_id: syncId, project_key: pk, scope: 'team', type: 'decision', title: 'vieja', content: 'vieja', tags: [],
  })
  return {
    sync_id: syncId, project_key: pk, scope: 'team', type: 'decision', topic_key: null,
    title: s.title, content: s.content, tags: [], lamport: 1,
    client_updated_at: new Date(1_700_000_000_000).toISOString(), deleted: false, superseded_by: null, project_seq: 1,
    ...(teamId ? { team_id: teamId } : {}),
  }
}

describe('I1 — el status manda sobre lo que se aprende del pull', () => {
  it('re-share de T1 (cifra) a T2 (no cifra): la fila vieja servida como T2 no deja a T2 retenido para siempre', async () => {
    const keysT1 = deriveKeys(generateMasterKey())
    const op: OpcionesServidor = {
      encryptedTeams: [{ team_id: TEAM, has_wrap: false }], // T1 cifra; T2 no
      projects: [{ project_key: 'proj1', display_name: 'raven-nest', team_id: TEAM2 }],
      filas: [filaSellada('obs-vieja-t1', keysT1, TEAM2)],
    }
    const srv = servidor(op)
    const d = daemon(srv.fetchImpl, () => ctxCon(new Map()))
    await d.status()
    await d.pull()
    expect(store.undecryptableCount(), 'la fila sellada con T1 es ilegible: eso no cambia').toBe(1)
    expect(store.isTeamEncrypted(TEAM2), 'T2 no cifra: una fila ilegible no lo puede decidir').toBe(false)

    guardar('team', 'nota para T2')
    await d.push()
    expect(srv.subidas.map((p) => p.title)).toEqual(['nota para T2']) // T2 no cifra: sale como hoy
    expect(store.blockedMutations()).toEqual([])
  })

  it('servicio viejo: lo aprendido del pull es PROVISORIO — el primer status con encrypted_teams lo descarta y devuelve lo retenido a la cola', async () => {
    store.setLocalTeamId('proj1', TEAM2)
    const op: OpcionesServidor = { filas: [filaSellada('obs-vieja', deriveKeys(generateMasterKey()))] } // sin team_id ni encrypted_teams
    const srv = servidor(op)
    const d = daemon(srv.fetchImpl, () => ctxCon(new Map()))
    await d.pull()
    expect(store.isTeamEncrypted(TEAM2), 'sin otra fuente, la fila ilegible arma el gate').toBe(true)

    guardar('team', 'nota retenida')
    await d.push() // el status de este servicio no trae encrypted_teams: "no sé" no descarta nada
    expect(srv.subidas).toEqual([])
    expect(store.blockedMutations().map((m) => m.blocked_reason)).toEqual(['team_key_missing'])

    op.encryptedTeams = [] // el servicio se actualizó: ahora dice que T2 NO cifra
    await d.status()
    expect(store.isTeamEncrypted(TEAM2)).toBe(false)
    expect(store.blockedMutations(), 'lo retenido por un provisorio vuelve a la cola').toEqual([])
    await d.push()
    expect(srv.subidas.map((p) => p.title)).toEqual(['nota retenida'])
  })

  it('lo que dijo el STATUS no se olvida aunque un status posterior no lo liste', async () => {
    const op: OpcionesServidor = { encryptedTeams: [{ team_id: TEAM, has_wrap: false }] }
    const d = daemon(servidor(op).fetchImpl, () => null)
    await d.status()
    op.encryptedTeams = []
    await d.status()
    expect(store.isTeamEncrypted(TEAM)).toBe(true)
  })

  it('un provisorio que el status SÍ lista pasa a confirmado', async () => {
    store.setLocalTeamId('proj1', TEAM)
    const op: OpcionesServidor = { filas: [filaSellada('obs-vieja', deriveKeys(generateMasterKey()))] }
    const d = daemon(servidor(op).fetchImpl, () => null)
    await d.pull()
    op.encryptedTeams = [{ team_id: TEAM, has_wrap: false }]
    await d.status()
    op.encryptedTeams = []
    await d.status()
    expect(store.isTeamEncrypted(TEAM)).toBe(true)
  })
})

describe('M1 — team_encryption_required enseña el equipo y retiene como team_key_missing', () => {
  it('confirmado (no lo borra un status posterior) y no se reenvía en claro en cada liberación', async () => {
    store.setLocalTeamId('proj1', TEAM)
    guardar('team', 'nota de equipo')
    const op: OpcionesServidor = { encryptedTeams: [], rechazoDeEquipo: 'team_encryption_required' }
    const srv = servidor(op)
    const d = daemon(srv.fetchImpl, () => ctxCon(new Map()))
    await d.push()
    expect(srv.subidas).toHaveLength(1) // la ventana documentada en §9.4: viajó, el servidor no la guardó
    expect(store.blockedMutations().map((m) => m.blocked_reason)).toEqual(['team_key_missing'])
    expect(store.isTeamEncrypted(TEAM)).toBe(true)

    await d.status() // sigue sin listarlo: el leader activó después de este status, por ejemplo
    expect(store.isTeamEncrypted(TEAM)).toBe(true)
    d.onTeamKeysChanged() // la clave de OTRO equipo entró: libera todo lo retenido…
    await d.push()
    expect(srv.subidas, '…pero el gate la vuelve a frenar: no sale de nuevo en claro').toHaveLength(1)
    expect(store.blockedMutations().map((m) => m.blocked_reason)).toEqual(['team_key_missing'])
  })

  it('sin team_id local, el rechazo queda como team_encryption_required (el roster lo resuelve)', async () => {
    guardar('team', 'nota de equipo')
    const srv = servidor({ encryptedTeams: [], rechazoDeEquipo: 'team_encryption_required' })
    await daemon(srv.fetchImpl, () => ctxCon(new Map())).push()
    expect(store.blockedMutations().map((m) => m.blocked_reason)).toEqual(['team_encryption_required'])
  })

  it('onTeamKeysChanged libera sólo lo del equipo cuya clave entró: el otro equipo cifrado sigue sin salir', async () => {
    store.ensureProject({ projectKey: 'proj2', displayName: 'otro' })
    store.setLocalTeamId('proj1', TEAM)
    store.setLocalTeamId('proj2', TEAM2)
    guardar('team', 'de T1')
    store.save({ projectKey: 'proj2', scope: 'team', type: 'decision', title: 'de T2', content: 'c', source: 'mcp' })
    const equipos = new Map<string, MemoryKeys>()
    const srv = servidor({ encryptedTeams: [{ team_id: TEAM, has_wrap: true }, { team_id: TEAM2, has_wrap: false }] })
    const d = daemon(srv.fetchImpl, () => ctxCon(equipos))
    await d.push()
    expect(srv.subidas).toEqual([])
    equipos.set(TEAM, keysEquipo)
    d.onTeamKeysChanged()
    await d.push()
    expect(srv.subidas).toHaveLength(1)
    expect(isCiphertext(String(srv.subidas[0].title))).toBe(true)
    expect(store.blockedMutations().map((m) => m.blocked_reason)).toEqual(['team_key_missing'])
  })

  it('aprender el share por el roster no manda en claro a un equipo cifrado sin clave', async () => {
    store.ensureProject({ projectKey: 'proj2', displayName: 'otro' })
    store.save({ projectKey: 'proj2', scope: 'team', type: 'decision', title: 'secreta', content: 'c', source: 'mcp' })
    store.blockMutations(store.pendingMutations().map((m) => ({ seq: m.seq, reason: 'team_encryption_required' })))
    const srv = servidor({
      projects: [{ project_key: 'proj2', display_name: 'otro', team_id: TEAM2 }],
      encryptedTeams: [{ team_id: TEAM2, has_wrap: false }],
    })
    const d = daemon(srv.fetchImpl, () => ctxCon(new Map()))
    await d.status()
    await d.push()
    expect(srv.subidas).toEqual([])
    expect(store.blockedMutations().map((m) => m.blocked_reason)).toEqual(['team_key_missing'])
  })
})

describe('M7 — onTeamKeysChanged durante un swap queda pendiente', () => {
  it('se aplica al terminar el swap si el store se conservó', async () => {
    store.setLocalTeamId('proj1', TEAM)
    guardar('team', 'nota de equipo')
    const equipos = new Map<string, MemoryKeys>()
    const srv = servidor({ encryptedTeams: [{ team_id: TEAM, has_wrap: true }] })
    const d = daemon(srv.fetchImpl, () => ctxCon(equipos))
    await d.push()
    expect(store.blockedMutations()).toHaveLength(1)

    await d.pause()
    equipos.set(TEAM, keysEquipo)
    d.onTeamKeysChanged()
    expect(store.blockedMutations(), 'durante el swap no se toca el store').toHaveLength(1)
    d.resume()
    try {
      await vi.waitFor(() => expect(srv.subidas).toHaveLength(1))
      expect(isCiphertext(String(srv.subidas[0].title))).toBe(true)
    } finally {
      d.stop()
    }
  })

  it('si el swap cambió el store, lo pendiente se descarta (era de la cuenta anterior)', async () => {
    store.setLocalTeamId('proj1', TEAM)
    guardar('team', 'nota de equipo')
    const srv = servidor({ encryptedTeams: [{ team_id: TEAM, has_wrap: false }] })
    const d = daemon(srv.fetchImpl, () => ctxCon(new Map()))
    await d.push()
    await d.pause()
    d.onTeamKeysChanged()
    const otroDir = mkdtempSync(join(tmpdir(), 'nest-cifrado-equipo-otro-'))
    const otro = new MemoryStore(join(otroDir, 'memory.db'))
    const unblock = vi.spyOn(otro, 'unblockMutations')
    try {
      d.setStore(otro)
      d.resume()
      d.stop()
      expect(unblock).not.toHaveBeenCalled()
    } finally {
      otro.close(); rmSync(otroDir, { recursive: true, force: true })
    }
  })
})

describe('M2 — la readopción re-baja sólo si hay ilegibles de los equipos adoptados', () => {
  it('ilegible de equipo con team_id: sólo ese equipo pide re-bajar', () => {
    daemon(servidor({}).fetchImpl, () => null).applyPulledRow(mapRawPulledRow(filaDeEquipoCifrada(TEAM)))
    expect(store.hayIlegiblesDeEquipos([TEAM])).toBe(true)
    expect(store.hayIlegiblesDeEquipos([TEAM2])).toBe(false)
    store.clearUndecryptable()
    expect(store.hayIlegiblesDeEquipos([TEAM])).toBe(false)
  })

  it('una ilegible PERSONAL no hace re-bajar al adoptar una clave de equipo', () => {
    const personal = sealMutationPayload({ keys: deriveKeys(generateMasterKey()), keyEpoch: 1 }, {
      sync_id: 'obs-personal', project_key: 'proj1', scope: 'personal', type: 'decision', title: 't', content: 'c', tags: [],
    })
    daemon(servidor({}).fetchImpl, () => ({ keys: keysPersonal, keyEpoch: 1 })).applyPulledRow(mapRawPulledRow({
      sync_id: 'obs-personal', project_key: 'proj1', scope: 'personal', type: 'decision', topic_key: null,
      title: personal.title, content: personal.content, tags: [], lamport: 1,
      client_updated_at: new Date().toISOString(), deleted: false, superseded_by: null, project_seq: 1,
    }))
    expect(store.undecryptableCount()).toBe(1)
    expect(store.hayIlegiblesDeEquipos([TEAM])).toBe(false)
  })

  it('servicio viejo sin team_id ni team_id local: no se sabe de qué equipo es, así que cualquiera re-baja', () => {
    daemon(servidor({}).fetchImpl, () => null).applyPulledRow(mapRawPulledRow(filaDeEquipoCifrada()))
    expect(store.hayIlegiblesDeEquipos([TEAM2])).toBe(true)
  })
})
