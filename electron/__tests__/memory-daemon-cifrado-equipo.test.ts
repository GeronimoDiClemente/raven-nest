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

  it('una fila de equipo ilegible NO arma el gate PERSONAL, y sí recuerda que ese equipo cifra', () => {
    daemon(servidor({}).fetchImpl, () => null).applyPulledRow(mapRawPulledRow(filaDeEquipoCifrada(TEAM)))
    expect(store.undecryptableCount()).toBe(1)
    expect(store.knownKeyEpoch(), 'un miembro sin cifrado personal no puede quedar en needs_key').toBe(0)
    expect(store.isTeamEncrypted(TEAM)).toBe(true)
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
    expect(store.blockedMutations().map((m) => m.blocked_reason)).toEqual(['team_encryption_required'])
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
