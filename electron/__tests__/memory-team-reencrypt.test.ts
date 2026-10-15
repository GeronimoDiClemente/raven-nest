// electron/__tests__/memory-team-reencrypt.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'crypto'
import { generateMasterKey, deriveKeys, decryptField, fieldAad, teamKeyProof, teamKeyVerifier } from '../memory-crypto'
import { migrateTeam, type LocalTeamRow } from '../memory-team-reencrypt'

const TEAM = '11111111-1111-4111-8111-111111111111'

interface FilaServidor { lamport: number; title: string; content: string | null }

/**
 * Imita a server/src/team-keys-recrypt.ts + la ruta `recrypt-pending`: la lista de lo
 * pendiente sale de ACÁ (no de lo que el cliente tenga local — C1), y el recrypt aplica las
 * mismas reglas que el servidor real: prueba de posesión, `already_sealed`, `stale`.
 */
function servidorFalso(master: Buffer, filas: Record<string, FilaServidor>, opts: {
  respuestas?: Array<(body: unknown) => Response | null>
  porPagina?: number
} = {}) {
  const verifier = teamKeyVerifier(teamKeyProof(master, TEAM))
  const lotes: Array<{ proof: string; items: Array<Record<string, unknown>> }> = []
  const tamanos: number[] = []
  const respuestas = [...(opts.respuestas ?? [])]
  const fetchImpl = (vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url)
    if (u.pathname === '/v1/teams/key/recrypt-pending') {
      const after = u.searchParams.get('after')
      const enClaro = Object.entries(filas)
        .filter(([, f]) => !f.title.startsWith('nmc1:'))
        .map(([sync_id, f]) => ({ sync_id, lamport: f.lamport }))
        .sort((a, b) => (a.sync_id < b.sync_id ? -1 : 1))
      const pagina = enClaro.filter((x) => !after || x.sync_id > after).slice(0, opts.porPagina ?? 500)
      return new Response(JSON.stringify({ total: enClaro.length, items: pagina }), { status: 200 })
    }
    if (u.pathname === '/v1/teams/key/recrypt') {
      const raw = String(init.body)
      const body = JSON.parse(raw) as { team_id: string; proof: string; items: Array<Record<string, unknown>> }
      const forzada = respuestas.shift()?.(body)
      if (forzada) return forzada
      tamanos.push(Buffer.byteLength(raw, 'utf8'))
      lotes.push({ proof: body.proof, items: body.items })
      if (createHash('sha256').update(body.proof, 'utf8').digest('hex') !== verifier) {
        return new Response(JSON.stringify({ error: 'must_hold_team_key' }), { status: 403 })
      }
      const applied: string[] = []
      const rejected: Array<{ sync_id: string; error: string }> = []
      for (const it of body.items) {
        const f = filas[String(it.sync_id)]
        if (!f) rejected.push({ sync_id: String(it.sync_id), error: 'not_found_in_team' })
        else if (f.title.startsWith('nmc1:')) rejected.push({ sync_id: String(it.sync_id), error: 'already_sealed' })
        else if (f.lamport !== it.lamport) rejected.push({ sync_id: String(it.sync_id), error: 'stale' })
        else { f.title = String(it.title); f.content = it.content as string | null; applied.push(String(it.sync_id)) }
      }
      return new Response(JSON.stringify({ ok: true, applied, rejected }), { status: 200 })
    }
    throw new Error(`ruta no mockeada: ${u.pathname}`)
  })) as unknown as typeof fetch
  return { fetchImpl, lotes, tamanos }
}

const fila = (syncId: string, extra: Partial<LocalTeamRow> = {}): LocalTeamRow => ({
  syncId, title: `T ${syncId}`, content: `C ${syncId}`, tags: [], contentHash: null, originAccount: null, lamport: 1, ...extra,
})

function localDe(filas: LocalTeamRow[], alPull?: () => void) {
  const porId = new Map(filas.map((f) => [f.syncId, f]))
  const pedidas: string[][] = []
  const local = {
    rowsBySyncIds: (ids: string[]) => { pedidas.push(ids); return ids.flatMap((id) => (porId.has(id) ? [porId.get(id)!] : [])) },
    pullNow: vi.fn(async () => { alPull?.() }),
    agregar: (f: LocalTeamRow) => porId.set(f.syncId, f),
  }
  return { local, pedidas }
}

const deps = (fetchImpl: typeof fetch) => ({ baseUrl: 'http://x', token: 't', deviceId: 'd', fetchImpl })
const sinEspera = { sleep: async () => {} }

describe('migrateTeam', () => {
  it('C1: la lista sale del SERVIDOR y se busca local por sync_id; manda lamport y la prueba', async () => {
    const master = generateMasterKey()
    const srv = servidorFalso(master, {
      a: { lamport: 3, title: 'Uno', content: 'contenido uno' },
      b: { lamport: 1, title: 'Dos', content: null },
      sellada: { lamport: 1, title: 'nmc1:x', content: 'nmc1:y' },
    })
    const { local, pedidas } = localDe([
      fila('a', { title: 'Uno', content: 'contenido uno', tags: ['x'], contentHash: 'hash-uno', originAccount: 'gero@example.com', lamport: 3 }),
      fila('b', { title: 'Dos', content: null }),
      fila('local-que-no-esta-pendiente'),
    ])
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, local, sinEspera)

    expect(res).toEqual({ total: 2, applied: 2, rejected: 0, remaining: 0, missingLocally: 0 })
    expect(pedidas[0].sort()).toEqual(['a', 'b'])
    expect(local.pullNow).not.toHaveBeenCalled()
    const [lote] = srv.lotes
    expect(lote.proof).toBe(teamKeyProof(master, TEAM))
    const a = lote.items.find((i) => i.sync_id === 'a')!
    const b = lote.items.find((i) => i.sync_id === 'b')!
    expect(a.lamport).toBe(3)
    expect(a.origin_account).toMatch(/^nmc1:/) // el email no viaja en claro
    expect(decryptField(deriveKeys(master), String(a.title), fieldAad('a', 'title'))).toBe('Uno')
    expect(decryptField(deriveKeys(master), String(a.content_hash), fieldAad('a', 'content_hash'))).toBe('hash-uno')
    expect(b.content).toBeNull() // I2: un tombstone viaja con content null
  })

  it('una fila que no está local pide UN pull y vuelve a mirar', async () => {
    const master = generateMasterKey()
    const srv = servidorFalso(master, { a: { lamport: 1, title: 'A', content: 'x' }, b: { lamport: 1, title: 'B', content: 'y' } })
    const ctx = localDe([fila('a')], () => ctx.local.agregar(fila('b')))
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, ctx.local, sinEspera)
    expect(ctx.local.pullNow).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ total: 2, applied: 2, rejected: 0, remaining: 0, missingLocally: 0 })
  })

  it('lo que sigue faltando después del pull se reporta y queda pendiente (no se dice que terminó)', async () => {
    const master = generateMasterKey()
    const srv = servidorFalso(master, { a: { lamport: 1, title: 'A', content: 'x' }, b: { lamport: 1, title: 'B', content: 'y' } })
    const { local } = localDe([fila('a')])
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, local, sinEspera)
    expect(local.pullNow).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ total: 2, applied: 1, rejected: 0, remaining: 1, missingLocally: 1 })
  })

  it('I1: una copia local con otro lamport que el servidor no se manda (sería pisar una edición nueva)', async () => {
    const master = generateMasterKey()
    const srv = servidorFalso(master, { a: { lamport: 9, title: 'editada en otro lado', content: 'x' } })
    const { local } = localDe([fila('a', { lamport: 2 })])
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, local, sinEspera)
    expect(local.pullNow).toHaveBeenCalledTimes(1)
    expect(srv.lotes).toHaveLength(0)
    expect(res).toEqual({ total: 1, applied: 0, rejected: 0, remaining: 1, missingLocally: 1 })
  })

  it('I3: corta los lotes por bytes, no sólo por cantidad', async () => {
    const master = generateMasterKey()
    const grande = 'x'.repeat(300_000)
    const filasSrv: Record<string, FilaServidor> = {}
    const locales: LocalTeamRow[] = []
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      filasSrv[id] = { lamport: 1, title: id, content: grande }
      locales.push(fila(id, { title: id, content: grande }))
    }
    const srv = servidorFalso(master, filasSrv)
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, localDe(locales).local, { ...sinEspera, maxBytesPerBatch: 1_000_000 })
    expect(res.applied).toBe(5)
    expect(srv.lotes.length).toBeGreaterThan(1)
    for (const t of srv.tamanos) expect(t).toBeLessThanOrEqual(1_000_000)
  })

  it('I3: ante un 429 espera lo que dice Retry-After y reintenta', async () => {
    const master = generateMasterKey()
    const srv = servidorFalso(master, { a: { lamport: 1, title: 'A', content: 'x' } }, {
      respuestas: [() => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'Retry-After': '7' } })],
    })
    const sleep = vi.fn(async () => {})
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, localDe([fila('a')]).local, { sleep })
    expect(sleep).toHaveBeenCalledWith(7_000)
    expect(res).toEqual({ total: 1, applied: 1, rejected: 0, remaining: 0, missingLocally: 0 })
  })

  it('I3: si un lote falla a mitad, devuelve lo aplicado hasta ahí, el error y lo que falta', async () => {
    const master = generateMasterKey()
    const srv = servidorFalso(master, {
      a: { lamport: 1, title: 'A', content: 'x' }, b: { lamport: 1, title: 'B', content: 'y' },
    }, {
      respuestas: [() => null, () => new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 })],
    })
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, localDe([fila('a'), fila('b')]).local, { ...sinEspera, maxItemsPerBatch: 1 })
    expect(res.applied).toBe(1)
    expect(res.remaining).toBe(1)
    expect(res.error).toMatch(/500/)
  })

  it('sin nada pendiente no manda ningún recrypt', async () => {
    const master = generateMasterKey()
    const srv = servidorFalso(master, { s: { lamport: 1, title: 'nmc1:a', content: 'nmc1:b' } })
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, localDe([]).local, sinEspera)
    expect(res).toEqual({ total: 0, applied: 0, rejected: 0, remaining: 0, missingLocally: 0 })
    expect(srv.lotes).toHaveLength(0)
  })

  it('pagina lo pendiente del servidor con `after`', async () => {
    const master = generateMasterKey()
    const filasSrv: Record<string, FilaServidor> = {}
    const locales: LocalTeamRow[] = []
    for (let i = 0; i < 7; i++) {
      const id = `id-${i}`
      filasSrv[id] = { lamport: 1, title: id, content: 'x' }
      locales.push(fila(id))
    }
    const srv = servidorFalso(master, filasSrv, { porPagina: 3 })
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, localDe(locales).local, sinEspera)
    expect(res).toEqual({ total: 7, applied: 7, rejected: 0, remaining: 0, missingLocally: 0 })
  })
})
