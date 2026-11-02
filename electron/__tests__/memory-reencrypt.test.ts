import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { planReencrypt, runReencrypt } from '../memory-reencrypt'

let dir: string
let store: MemoryStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nest-reencrypt-'))
  store = new MemoryStore(join(dir, 'memory.db'))
  store.ensureProject({ projectKey: 'proj1', displayName: 'raven-nest' })
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

const guardar = (n: number) => {
  for (let i = 0; i < n; i++) {
    store.save({
      projectKey: 'proj1', scope: 'personal', type: 'decision', topicKey: null,
      title: `t${i}`, content: `c${i}`, source: 'mcp',
    })
  }
}

describe('re-encriptar lo ya subido', () => {
  it('encola una mutación por observación viva', () => {
    guardar(3)
    // Vaciar la cola: simula "ya estaba todo pusheado en claro".
    store.markPushed(store.pendingMutations(100).map((m) => m.seq))
    expect(store.pendingMutationCount()).toBe(0)

    expect(store.requeueAllForPush()).toBe(3)
    expect(store.pendingMutationCount()).toBe(3)
  })

  it('no re-encola tombstones', () => {
    const a = store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', topicKey: null, title: 'a', content: 'x', source: 'mcp' })
    guardar(1)
    store.deleteObservation(a.syncId)
    store.markPushed(store.pendingMutations(100).map((m) => m.seq))
    // Solo queda una viva.
    expect(store.requeueAllForPush()).toBe(1)
  })

  // F2 (review final): `plaintext_pending` cuenta las superseded del servidor, así que el
  // re-upload también las sube selladas. Sin esto el contador no llegaba nunca a 0, la tarjeta
  // quedaba en "Encrypting…" para siempre y el re-upload completo se repetía cada sesión.
  // El servidor conserva su marca (push.ts, `conservaSupersede`): re-cifrar no es editar.
  it('re-encola también las filas superseded propias, con su superseded_by', () => {
    store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', topicKey: 'deploy', title: 'local', content: 'x', source: 'mcp' })
    const local = store.context('proj1', 10)[0]
    store.applyIncomingObservation({
      syncId: 'obs_remota', projectKey: 'proj1', scope: 'personal', topicKey: 'deploy', type: 'decision',
      title: 'remote', content: 'y', updatedAt: Date.now() + 60_000, lamport: 99, deleted: false,
      supersedeLocal: local.syncId,
    })
    expect(store.get(local.syncId)?.superseded_by).toBe('obs_remota')
    store.markPushed(store.pendingMutations(100).map((m) => m.seq))

    expect(store.requeueAllForPush()).toBe(2)
    const payloads = store.pendingMutations(10).map((m) => JSON.parse(m.payload) as Record<string, unknown>)
    expect(payloads.find((p) => p.sync_id === local.syncId)?.superseded_by).toBe('obs_remota')
  })

  // F4 (review final): builds anteriores marcaban como terminal (pushed + last_error) lo que el
  // servidor rechazaba con `encryption_required`. Los upserts los cubre `requeueAllForPush` con
  // la fila ACTUAL; un borrado no, porque los tombstones no se re-encolan, y sin esto la fila
  // seguía viva y en claro en el servidor para siempre.
  describe('reencolarRechazadosPorCifrado', () => {
    it('devuelve a la cola los borrados rechazados por encryption_required, y nada más', () => {
      const a = store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', topicKey: null, title: 'a', content: 'x', source: 'mcp' })
      const b = store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', topicKey: null, title: 'b', content: 'y', source: 'mcp' })
      store.markPushed(store.pendingMutations(100).map((m) => m.seq))
      store.deleteObservation(a.syncId)
      store.deleteObservation(b.syncId)
      const [delA, delB] = store.pendingMutations(10)
      store.markPushed([{ seq: delA.seq, error: 'encryption_required' }, { seq: delB.seq, error: 'quota_exceeded' }])
      expect(store.pendingMutationCount()).toBe(0)

      expect(store.reencolarRechazadosPorCifrado()).toBe(1)
      const pendientes = store.pendingMutations(10)
      expect(pendientes.map((m) => m.seq)).toEqual([delA.seq])
      // Idempotente: ya no está marcado.
      expect(store.reencolarRechazadosPorCifrado()).toBe(0)
    })

    it('no revive el borrado de una fila que volvió a estar viva', () => {
      const a = store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', topicKey: null, title: 'a', content: 'x', source: 'mcp' })
      store.deleteObservation(a.syncId)
      const del = store.pendingMutations(10).find((m) => m.op === 'delete')!
      store.markPushed(store.pendingMutations(10).map((m) => m.seq === del.seq ? { seq: m.seq, error: 'encryption_required' } : m.seq))
      // La resucitó otra máquina (llega por el pull).
      const row = store.get(a.syncId)!
      store.applyIncomingObservation({
        syncId: a.syncId, projectKey: 'proj1', scope: 'personal', topicKey: null, type: 'decision',
        title: 'a', content: 'back', updatedAt: Date.now() + 60_000, lamport: row.lamport + 10, deleted: false,
      })
      expect(store.reencolarRechazadosPorCifrado()).toBe(0)
    })

    it('un upsert rechazado no vuelve: lo cubre requeueAllForPush con la fila actual', () => {
      store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', topicKey: null, title: 'a', content: 'x', source: 'mcp' })
      const [m] = store.pendingMutations(10)
      store.markPushed([{ seq: m.seq, error: 'encryption_required' }])
      expect(store.reencolarRechazadosPorCifrado()).toBe(0)
    })
  })

  // El payload es un snapshot de la fila. Si le subieramos el lamport, esta mutacion le
  // ganaria por LWW a una edicion mas nueva hecha en OTRA maquina: la migracion pisaria
  // datos buenos. Re-subir el mismo snapshot es un upsert idempotente por sync_id.
  it('el payload re-encolado conserva lamport y updated_at originales', () => {
    const { syncId } = store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', topicKey: null, title: 'a', content: 'x', source: 'mcp' })
    const original = store.get(syncId)!
    store.markPushed(store.pendingMutations(100).map((m) => m.seq))

    store.requeueAllForPush()
    const payload = JSON.parse(store.pendingMutations(10)[0].payload)
    expect(payload.lamport).toBe(original.lamport)
    expect(payload.updated_at).toBe(original.updated_at)
    expect(payload.sync_id).toBe(syncId)
  })

  it('planReencrypt informa cuánto hay antes de tocar nada', () => {
    guardar(5)
    store.markPushed(store.pendingMutations(100).map((m) => m.seq))
    expect(planReencrypt(store)).toEqual({ total: 5, queued: 0 })
  })

  it('runReencrypt encola y empuja hasta vaciar la cola', async () => {
    guardar(5)
    store.markPushed(store.pendingMutations(100).map((m) => m.seq))

    // Un push que "acepta" 2 por vuelta, para ejercitar el bucle de verdad.
    const push = vi.fn(async () => {
      store.markPushed(store.pendingMutations(2).map((m) => m.seq))
    })
    const res = await runReencrypt(store, { push })
    expect(res).toEqual({ total: 5, queued: 0 })
    expect(store.pendingMutationCount()).toBe(0)
    expect(push.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('runReencrypt reporta progreso', async () => {
    guardar(4)
    store.markPushed(store.pendingMutations(100).map((m) => m.seq))
    const vistos: number[] = []
    await runReencrypt(store, {
      push: async () => { store.markPushed(store.pendingMutations(2).map((m) => m.seq)) },
    }, (p) => vistos.push(p.queued))
    expect(vistos[0]).toBeGreaterThan(0)
    expect(vistos[vistos.length - 1]).toBe(0)
  })

  // Si el push no avanza (sin red, cuota llena, todo bloqueado), la funcion tiene que
  // CORTAR y devolver lo que queda, no girar para siempre.
  it('corta si el push deja de avanzar, y devuelve lo pendiente', async () => {
    guardar(3)
    store.markPushed(store.pendingMutations(100).map((m) => m.seq))
    const res = await runReencrypt(store, { push: async () => { /* no avanza */ } })
    expect(res.queued).toBe(3)
  })
})
