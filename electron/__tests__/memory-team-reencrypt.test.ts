// electron/__tests__/memory-team-reencrypt.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'crypto'
import { generateMasterKey, deriveKeys, decryptField, fieldAad, teamKeyProof, teamKeyVerifier, hmacTopicKey } from '../memory-crypto'
import { sealMutationPayload, looksLikeTopicHmac } from '../memory-envelope'
import { migrateTeam, pendientesSiEsLeader } from '../memory-team-reencrypt'

const TEAM = '11111111-1111-4111-8111-111111111111'

interface FilaServidor {
  lamport: number; title: string; content: string | null
  tags?: string[]; content_hash?: string | null; origin_account?: string | null
  project_key?: string; topic_key?: string | null
}

/**
 * Imita a server/src/team-keys-recrypt.ts + la ruta `recrypt-pending`: lo pendiente (CON su
 * contenido) sale de ACÁ, no de la base local — C1: el pull no le trae al leader filas de un
 * repo que no clonó. El recrypt aplica las reglas del servidor real: prueba de posesión,
 * `already_sealed`, `stale`.
 */
function servidorFalso(master: Buffer, filas: Record<string, FilaServidor>, opts: {
  respuestas?: Array<(body: unknown) => Response | null>
  porPagina?: number
  /** Corre después de servir lo pendiente: simula una edición entre la lectura y el envío. */
  alLeerPendiente?: () => void
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
        .map(([sync_id, f]) => ({
          sync_id, lamport: f.lamport, title: f.title, content: f.content, tags: f.tags ?? [],
          content_hash: f.content_hash ?? null, origin_account: f.origin_account ?? null,
          project_key: f.project_key ?? 'repo-x', topic_key: f.topic_key ?? null,
        }))
        .sort((a, b) => (a.sync_id < b.sync_id ? -1 : 1))
      const pagina = enClaro.filter((x) => !after || x.sync_id > after).slice(0, opts.porPagina ?? 200)
      const res = new Response(JSON.stringify({ total: enClaro.length, items: pagina }), { status: 200 })
      opts.alLeerPendiente?.()
      return res
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

const deps = (fetchImpl: typeof fetch) => ({ baseUrl: 'http://x', token: 't', deviceId: 'd', fetchImpl })
const sinEspera = { sleep: async () => {} }

describe('migrateTeam', () => {
  it('C1: sella lo que el SERVIDOR dice que está en claro, en esa versión, con lamport y prueba', async () => {
    const master = generateMasterKey()
    const srv = servidorFalso(master, {
      // Una fila de un repo que este device ni siquiera tiene: el pull nunca se la traería.
      'de-otro-repo': { lamport: 3, title: 'Uno', content: 'contenido uno', tags: ['x'], content_hash: 'hash-uno', origin_account: 'b@example.com' },
      tombstone: { lamport: 1, title: 'Dos', content: null },
      sellada: { lamport: 1, title: 'nmc1:x', content: 'nmc1:y' },
    })
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, sinEspera)

    expect(res).toEqual({ total: 2, applied: 2, rejected: 0, remaining: 0 })
    const [lote] = srv.lotes
    expect(lote.proof).toBe(teamKeyProof(master, TEAM))
    const a = lote.items.find((i) => i.sync_id === 'de-otro-repo')!
    const b = lote.items.find((i) => i.sync_id === 'tombstone')!
    expect(a.lamport).toBe(3)
    expect(a.origin_account).toMatch(/^nmc1:/) // el email no queda en claro
    const k = deriveKeys(master)
    expect(decryptField(k, String(a.title), fieldAad('de-otro-repo', 'title'))).toBe('Uno')
    expect(decryptField(k, String(a.content_hash), fieldAad('de-otro-repo', 'content_hash'))).toBe('hash-uno')
    expect(JSON.parse(decryptField(k, String((a.tags as string[])[0]), fieldAad('de-otro-repo', 'tags')))).toEqual(['x'])
    expect(b.content).toBeNull() // I2: un tombstone viaja con content null
  })

  it('un campo que ya viene sellado no se vuelve a sellar', async () => {
    const master = generateMasterKey()
    const srv = servidorFalso(master, { a: { lamport: 1, title: 'en claro', content: 'nmc1:ya-sellado' } })
    await migrateTeam(deps(srv.fetchImpl), TEAM, master, sinEspera)
    expect(srv.lotes[0].items[0].content).toBe('nmc1:ya-sellado')
    expect(String(srv.lotes[0].items[0].title)).toMatch(/^nmc1:/)
  })

  it('I1: una fila editada entre la lectura y el envío vuelve stale y queda pendiente', async () => {
    const master = generateMasterKey()
    const filas: Record<string, FilaServidor> = { a: { lamport: 1, title: 'A', content: 'x' } }
    let leidas = 0
    const srv = servidorFalso(master, filas, { alLeerPendiente: () => { if (++leidas === 1) filas.a.lamport = 2 } })
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, sinEspera)
    expect(res).toEqual({ total: 1, applied: 0, rejected: 1, remaining: 1 })
  })

  it('I3: corta los lotes por bytes, no sólo por cantidad', async () => {
    const master = generateMasterKey()
    const grande = 'x'.repeat(300_000)
    const filas: Record<string, FilaServidor> = {}
    for (const id of ['a', 'b', 'c', 'd', 'e']) filas[id] = { lamport: 1, title: id, content: grande }
    const srv = servidorFalso(master, filas)
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, { ...sinEspera, maxBytesPerBatch: 1_000_000 })
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
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, { sleep })
    expect(sleep).toHaveBeenCalledWith(7_000)
    expect(res).toEqual({ total: 1, applied: 1, rejected: 0, remaining: 0 })
  })

  it('I3: si un lote falla a mitad, devuelve lo aplicado hasta ahí, el error y lo que falta', async () => {
    const master = generateMasterKey()
    const srv = servidorFalso(master, {
      a: { lamport: 1, title: 'A', content: 'x' }, b: { lamport: 1, title: 'B', content: 'y' },
    }, {
      respuestas: [() => null, () => new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 })],
    })
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, { ...sinEspera, maxItemsPerBatch: 1 })
    expect(res.applied).toBe(1)
    expect(res.remaining).toBe(1)
    expect(res.error).toMatch(/500/)
  })

  it('sin nada pendiente no manda ningún recrypt', async () => {
    const master = generateMasterKey()
    const srv = servidorFalso(master, { s: { lamport: 1, title: 'nmc1:a', content: 'nmc1:b' } })
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, sinEspera)
    expect(res).toEqual({ total: 0, applied: 0, rejected: 0, remaining: 0 })
    expect(srv.lotes).toHaveLength(0)
  })

  it('recorre todas las páginas de lo pendiente con `after`', async () => {
    const master = generateMasterKey()
    const filas: Record<string, FilaServidor> = {}
    for (let i = 0; i < 7; i++) filas[`id-${i}`] = { lamport: 1, title: `t${i}`, content: 'x' }
    const srv = servidorFalso(master, filas, { porPagina: 3 })
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, master, sinEspera)
    expect(res).toEqual({ total: 7, applied: 7, rejected: 0, remaining: 0 })
  })
})

describe('Task 15b — I2: la migración sella el tema igual que una fila nueva', () => {
  it('el topic_key que manda es EXACTAMENTE el que sealMutationPayload pone en una fila nueva del mismo tema', async () => {
    const master = generateMasterKey()
    const srv = servidorFalso(master, {
      vieja: { lamport: 1, title: 'Deploy', content: 'a prod', project_key: 'github.com/acme/api', topic_key: 'deploy-target' },
    })
    await migrateTeam(deps(srv.fetchImpl), TEAM, master, sinEspera)
    const enviado = srv.lotes[0].items[0].topic_key

    // Una fila NUEVA del mismo tema, guardada después de activar, por cualquier miembro: la
    // personal es otra (cada uno tiene la suya), la de equipo es la misma maestra.
    const nueva = sealMutationPayload(
      { keys: deriveKeys(generateMasterKey()), keyEpoch: 1, teamKeys: () => deriveKeys(master) },
      { sync_id: 'nueva', scope: 'team', project_key: 'github.com/acme/api', topic_key: 'deploy-target', title: 'Deploy v2' }
    )
    expect(enviado).toBe(nueva.topic_key)
    expect(enviado).toBe(hmacTopicKey(deriveKeys(master), 'github.com/acme/api', 'team', 'deploy-target'))
    expect(looksLikeTopicHmac(String(enviado))).toBe(true)
  })

  it('una fila sin tema manda topic_key null', async () => {
    const master = generateMasterKey()
    const srv = servidorFalso(master, { a: { lamport: 1, title: 'A', content: 'x' } })
    await migrateTeam(deps(srv.fetchImpl), TEAM, master, sinEspera)
    expect(srv.lotes[0].items[0].topic_key).toBeNull()
  })
})

describe('Task 15b — Minor 4: migrateTeam nunca rechaza', () => {
  it('con una maestra inválida resuelve con `error` en vez de rechazar (era un unhandled rejection en main)', async () => {
    const srv = servidorFalso(generateMasterKey(), { a: { lamport: 1, title: 'A', content: 'x' } })
    const res = await migrateTeam(deps(srv.fetchImpl), TEAM, undefined as unknown as Buffer, sinEspera)
    expect(res.error).toBeTruthy()
    expect(res.applied).toBe(0)
    expect(srv.lotes).toHaveLength(0)
  })
})

describe('Task 15b — Minor 3: lo pendiente sólo se pregunta si soy leader', () => {
  it('un member no llama a recrypt-pending (ni gasta el limiter ni se come un 403)', async () => {
    const srv = servidorFalso(generateMasterKey(), { a: { lamport: 1, title: 'A', content: 'x' } })
    const n = await pendientesSiEsLeader(deps(srv.fetchImpl), TEAM, { activated: true, isLeader: false }, true)
    expect(n).toBeNull()
    expect(srv.fetchImpl).not.toHaveBeenCalled()
  })

  it('sin la clave o sin activar tampoco', async () => {
    const srv = servidorFalso(generateMasterKey(), { a: { lamport: 1, title: 'A', content: 'x' } })
    expect(await pendientesSiEsLeader(deps(srv.fetchImpl), TEAM, { activated: true, isLeader: true }, false)).toBeNull()
    expect(await pendientesSiEsLeader(deps(srv.fetchImpl), TEAM, { activated: false, isLeader: true }, true)).toBeNull()
    expect(srv.fetchImpl).not.toHaveBeenCalled()
  })

  it('el leader con la clave ve cuánto falta; un error de red da null, no lanza', async () => {
    const srv = servidorFalso(generateMasterKey(), { a: { lamport: 1, title: 'A', content: 'x' }, b: { lamport: 1, title: 'B', content: 'y' } })
    expect(await pendientesSiEsLeader(deps(srv.fetchImpl), TEAM, { activated: true, isLeader: true }, true)).toBe(2)
    const caido = (async () => { throw new Error('sin red') }) as unknown as typeof fetch
    expect(await pendientesSiEsLeader(deps(caido), TEAM, { activated: true, isLeader: true }, true)).toBeNull()
  })
})
