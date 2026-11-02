// Spec 2026-11-02 §4: cuánto sigue en claro en la nube, para que el cliente sepa si la
// migración terminó. Una fila re-subida sellada con el mismo sync_id deja de contar.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'
import { handleStatus } from '../src/status'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
let auth: { deviceId: string; userId: string; plan: string }
const proj = `spp-${RUN}`

const SELLADA = {
  title: 'nmc1:AAAA', content: 'nmc1:BBBB', tags: ['nmc1:CCCC'],
  project_display_name: 'nmc1:DDDD', content_hash: 'nmc1:EEEE', origin_account: 'nmc1:FFFF', git_branch: 'nmc1:GGGG',
}
function mutation(seq: number, syncId: string, scope: string, extra: Record<string, unknown> = {}, op: 'upsert' | 'delete' = 'upsert') {
  return {
    seq, sync_id: syncId, op,
    payload: {
      sync_id: syncId, project_key: proj, project_display_name: proj, scope,
      type: 'decision', topic_key: null, title: 'plain title', content: 'plain body',
      tags: [], lamport: seq, updated_at: Date.now(), created_at: Date.now(), ...extra,
    },
  }
}

async function nuevaCuenta() {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'cloud')`, [userId])
  await pool.query(`insert into devices (id, user_id, name, token_hash) values ($1, $2, 'd', $3)`, [deviceId, userId, `hash-${deviceId}`])
  return { deviceId, userId, plan: 'cloud' }
}

beforeAll(async () => {
  await migrate(pool)
  auth = await nuevaCuenta()
})
afterAll(async () => { await pool.end() })

describe('status — plaintext_pending', () => {
  it('cuenta las filas personales en claro y deja de contarlas al re-subirlas selladas', async () => {
    expect((await handleStatus(pool, auth)).plaintext_pending).toBe(0)
    await handlePush(pool, auth, { mutations: [mutation(1, `${RUN}-a`, 'personal'), mutation(2, `${RUN}-b`, 'personal')] })
    expect((await handleStatus(pool, auth)).plaintext_pending).toBe(2)

    await handlePush(pool, auth, { mutations: [mutation(3, `${RUN}-a`, 'personal', SELLADA)] })
    expect((await handleStatus(pool, auth)).plaintext_pending).toBe(1)
  })

  it('no cuenta filas de equipo: scope <> team', async () => {
    const a = await nuevaCuenta()
    await handlePush(pool, a, { mutations: [mutation(1, `${RUN}-eq`, 'personal')] })
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(1)
    await pool.query(`update observations set scope = 'team' where sync_id = $1`, [`${RUN}-eq`])
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(0)
  })

  it('no cuenta filas borradas aunque conserven el texto en claro: not deleted', async () => {
    const a = await nuevaCuenta()
    await handlePush(pool, a, { mutations: [mutation(1, `${RUN}-del`, 'personal')] })
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(1)
    // Por SQL y no por un `delete` de push: éste vacía título y contenido y no probaría nada.
    await pool.query(`update observations set deleted = true where sync_id = $1`, [`${RUN}-del`])
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(0)
  })

  it('un tombstone real subido por push tampoco cuenta', async () => {
    const a = await nuevaCuenta()
    await handlePush(pool, a, { mutations: [mutation(1, `${RUN}-tomb`, 'personal')] })
    await handlePush(pool, a, { mutations: [mutation(2, `${RUN}-tomb`, 'personal', { title: '', content: null }, 'delete')] })
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(0)
  })

  it('no cuenta filas de otra cuenta: p.user_id', async () => {
    const a = await nuevaCuenta()
    const b = await nuevaCuenta()
    await handlePush(pool, b, { mutations: [mutation(1, `${RUN}-ajena`, 'personal')] })
    expect((await handleStatus(pool, b)).plaintext_pending).toBe(1)
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(0)
  })

  // Una fila con UN solo campo en claro y todo lo demás sellado cuenta 1: cada rama del OR
  // tiene que poder disparar sola.
  const CASOS: Array<[string, Record<string, unknown>]> = [
    ['title', { title: 'plain' }],
    ['content', { content: 'plain' }],
    ['content_hash', { content_hash: 'plainhash' }],
    ['origin_account', { origin_account: 'plain@x.com' }],
    ['git_branch', { git_branch: 'main' }],
    // Los tags viajan en UN solo sobre: un array de 2 no es el formato sellado, aunque cada elemento lleve el prefijo (push.ts `viajaSellado`).
    ['tags en 2 sobres (no es el formato de un único sobre)', { tags: ['nmc1:CCCC', 'nmc1:HHHH'] }],
    ['tags con un sobre y un elemento en claro', { tags: ['nmc1:CCCC', 'plain'] }],
    ['tags con 1 elemento en claro', { tags: ['plain'] }],
  ]
  it.each(CASOS)('un solo campo en claro cuenta 1: %s', async (nombre, campo) => {
    const a = await nuevaCuenta()
    const id = `${RUN}-c-${nombre.replace(/\W/g, '')}`
    await handlePush(pool, a, { mutations: [mutation(1, id, 'personal', { ...SELLADA, ...campo })] })
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(1)
  })

  it('una fila toda sellada no cuenta', async () => {
    const a = await nuevaCuenta()
    await handlePush(pool, a, { mutations: [mutation(1, `${RUN}-ok`, 'personal', SELLADA)] })
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(0)
  })

  // F1 (review final): el `on conflict` no actualizaba origin_account ni git_branch, así que
  // re-subir sellado dejaba el mail y la rama en claro para siempre y el contador nunca bajaba.
  it('re-subir sellado pisa origin_account y git_branch en claro (y actualiza origin_ai y author_display)', async () => {
    const a = await nuevaCuenta()
    const id = `${RUN}-f1`
    await handlePush(pool, a, { mutations: [mutation(1, id, 'personal', {
      origin_account: 'someone@example.com', git_branch: 'feature/secret-plan', origin_ai: 'claude', author_display: 'Old Name',
    })] })
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(1)

    await handlePush(pool, a, { mutations: [mutation(2, id, 'personal', { ...SELLADA, origin_ai: 'codex', author_display: 'New Name' })] })
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(0)
    const { rows } = await pool.query(
      'select origin_account, git_branch, origin_ai, author_display from observations where sync_id = $1', [id]
    )
    expect(rows[0].origin_account).toBe('nmc1:FFFF')
    expect(rows[0].git_branch).toBe('nmc1:GGGG')
    expect(rows[0].origin_ai).toBe('codex')
    expect(rows[0].author_display).toBe('New Name')
  })

  // F2 (review final): el contador cuenta las filas superseded, así que el re-upload también las
  // re-sube. El servidor tiene que aceptarlas SIN deshacer el supersede: el orden del re-upload
  // (por updated_at) sube a la perdedora antes que a la ganadora, cuando la ganadora todavía
  // tiene el tema en claro y la colisión por HMAC no la encuentra.
  describe('re-subir una fila superseded', () => {
    const HMAC = 'a'.repeat(32)
    function conTema(seq: number, syncId: string, extra: Record<string, unknown> = {}) {
      return mutation(seq, syncId, 'personal', { topic_key: 'auth-flow', ...extra })
    }
    async function supersededBy(syncId: string): Promise<string | null> {
      const { rows } = await pool.query('select superseded_by from observations where sync_id = $1', [syncId])
      return rows[0].superseded_by
    }

    it('la perdedora re-subida sellada sigue superseded por la ganadora y el contador llega a 0', async () => {
      const a = await nuevaCuenta()
      const perdedora = `${RUN}-f2-x`
      const ganadora = `${RUN}-f2-y`
      await handlePush(pool, a, { mutations: [conTema(1, perdedora, { lamport: 1, updated_at: 1000 })] })
      await handlePush(pool, a, { mutations: [conTema(2, ganadora, { lamport: 2, updated_at: 2000 })] })
      expect(await supersededBy(perdedora)).toBe(ganadora)
      expect((await handleStatus(pool, a)).plaintext_pending).toBe(2)

      // Lo que manda el cliente: la fila local tal cual (con su superseded_by) y sellada.
      const r1 = await handlePush(pool, a, { mutations: [conTema(3, perdedora, {
        ...SELLADA, topic_key: HMAC, lamport: 1, updated_at: 1000, superseded_by: ganadora,
      })] })
      expect(r1.results[0].outcome).toBe('superseded')
      expect(await supersededBy(perdedora)).toBe(ganadora)
      expect((await handleStatus(pool, a)).plaintext_pending).toBe(1)

      const r2 = await handlePush(pool, a, { mutations: [conTema(4, ganadora, {
        ...SELLADA, topic_key: HMAC, lamport: 2, updated_at: 2000,
      })] })
      expect(r2.results[0].outcome).toBe('applied')
      expect(await supersededBy(ganadora)).toBeNull()
      expect(await supersededBy(perdedora)).toBe(ganadora)
      expect((await handleStatus(pool, a)).plaintext_pending).toBe(0)
    })

    it('con la ganadora borrada, la perdedora re-subida no resucita', async () => {
      const a = await nuevaCuenta()
      const perdedora = `${RUN}-f2-dx`
      const ganadora = `${RUN}-f2-dy`
      await handlePush(pool, a, { mutations: [conTema(1, perdedora, { lamport: 1, updated_at: 1000 })] })
      await handlePush(pool, a, { mutations: [conTema(2, ganadora, { lamport: 2, updated_at: 2000 })] })
      await handlePush(pool, a, { mutations: [{ ...conTema(3, ganadora, { ...SELLADA, lamport: 3, updated_at: 3000, content: null }), op: 'delete' as const }] })

      await handlePush(pool, a, { mutations: [conTema(4, perdedora, {
        ...SELLADA, topic_key: HMAC, lamport: 1, updated_at: 1000, superseded_by: ganadora,
      })] })
      expect(await supersededBy(perdedora)).toBe(ganadora)
      expect((await handleStatus(pool, a)).plaintext_pending).toBe(0)
    })

    it('un payload con superseded_by sobre una fila VIVA en el servidor no la marca: decide la colisión', async () => {
      const a = await nuevaCuenta()
      const id = `${RUN}-f2-viva`
      await handlePush(pool, a, { mutations: [conTema(1, id)] })
      await handlePush(pool, a, { mutations: [conTema(2, id, { ...SELLADA, topic_key: HMAC, superseded_by: `${RUN}-nadie` })] })
      expect(await supersededBy(id)).toBeNull()
    })
  })

  it('tags vacíos con todo lo demás sellado no cuenta', async () => {
    const a = await nuevaCuenta()
    await handlePush(pool, a, { mutations: [mutation(1, `${RUN}-vacio`, 'personal', { ...SELLADA, tags: [] })] })
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(0)
  })
})
