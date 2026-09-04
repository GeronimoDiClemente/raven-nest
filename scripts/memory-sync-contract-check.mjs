#!/usr/bin/env node
// Contract check for a Nest Memory sync service. Drives it as two devices and asserts the
// properties the design says must hold — the ones the OLD Supabase backend got wrong and
// that silently lost data.
//
// Point it at the stub, or at the real service once it exists. It speaks nothing but the
// §5 wire contract of docs/superpowers/specs/2026-08-31-memory-sync-backend-design.md, so
// it does not care which is on the other end. That is the point: it is the executable
// form of "did we actually fix the things we said we fixed".
//
// Usage:
//   node scripts/memory-sync-stub.mjs --port 8787 --token nmk_test_token &
//   node scripts/memory-sync-contract-check.mjs --base http://127.0.0.1:8787 --token nmk_test_token
//
// Exit code 0 = every property holds. Non-zero = the service under test would lose data.

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const BASE = arg('base', 'http://127.0.0.1:8787')
const TOKEN = arg('token', 'nmk_test_token')

let failures = 0
function check(label, condition, detail = '') {
  console.log(`${condition ? '  OK  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures++
}

async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json()
}

// Every identifier this checker writes must be unique per run — sync_id, project_key,
// device_id, and seq alike. The service under test is stateful and dedupes by
// (device_id, seq), so anything reused from a prior run risks hitting that run's stored
// receipts and then asserting against rows this run never actually wrote. Found the hard
// way, in stages: first sync_id and project_key, then the device ids, then — after those
// two fixes still weren't enough against a server that resolves device identity from the
// auth token rather than the body — seq itself. Treat this as the rule, not three
// one-off patches: anything new this checker sends needs to fold RUN in too.
const RUN = Date.now().toString(36)
const PROJECT = `contract-check-${RUN}`
const NOW = Date.now()

const id = (name) => `obs_${RUN}_${name}`

// These device ids are varied per run for readability and to match what the stub keys
// receipts on (body.device_id). Against a CORRECT server they buy no isolation at all:
// device identity is resolved from the bearer token, not from this field, so every call
// in every run authenticates as the one real device behind --token regardless of what
// string is sent here. That is why seq (below) still has to be unique on its own — the
// device id cannot do that job against the real service, only against a stub that trusts it.
const DEVICE_A = `device-a-${RUN}`
const DEVICE_B = `device-b-${RUN}`
const DEVICE_C = `device-c-${RUN}`

// Every identifier this checker writes must be unique per run — including the seq. The
// receipt key is (device_id, seq), and a correct server resolves device_id from the TOKEN
// rather than from the request body, so two runs sharing a token share a device. Making
// only sync_id and project_key unique is not enough: run 2 replays run 1's seqs, the
// server correctly returns the stored receipts, and nothing is written for run 2's rows.
// That is not a server bug — it is this checker lying about what it wrote.
const SEQ_BASE = Date.now() * 100
let seqCounter = 0
const nextSeq = () => SEQ_BASE + ++seqCounter

function mutation(name, overrides = {}) {
  const syncId = id(name)
  return {
    seq: overrides.seq ?? nextSeq(),
    sync_id: syncId,
    op: overrides.op ?? 'upsert',
    payload: {
      sync_id: syncId,
      project_key: PROJECT,
      project_display_name: 'contract-check',
      scope: 'personal',
      type: 'decision',
      topic_key: null,
      title: 'untitled',
      content: 'body',
      tags: [],
      lamport: 1,
      updated_at: NOW,
      ...overrides.payload,
    },
  }
}

const pullAll = () => call('/v1/sync/pull', { cursors: { [PROJECT]: 0 }, limit: 500 })

console.log(`\ncontract check against ${BASE}\nproject: ${PROJECT}\n`)

// ── 1. Topic collision: the loser is superseded, never rejected ─────────────
// Spec §8.1, and the whole reason the old backend is being replaced. The old server did a
// plain INSERT against a unique index; the second memory came back `rejected`, the client
// marked it pushed, and never retried it. The two machines then showed different memories
// for the same topic, forever, with nothing anywhere reporting an error.
console.log('1. colision de topic — el perdedor se supersede, no se rechaza')
{
  const early = await call('/v1/sync/push', {
    device_id: DEVICE_A,
    mutations: [
      mutation('a', { payload: { topic_key: 'deploy-target', title: 'A dice railway', lamport: 5, updated_at: NOW } }),
    ],
  })
  check('device A: la primera se aplica', early.results[0].outcome === 'applied', early.results[0].outcome)

  // Device B was offline and wrote the same topic with a LATER timestamp, so B wins.
  const late = await call('/v1/sync/push', {
    device_id: DEVICE_B,
    mutations: [
      mutation('b', {
        payload: { topic_key: 'deploy-target', title: 'B dice hetzner', lamport: 6, updated_at: NOW + 60_000 },
      }),
    ],
  })
  check('device B: la segunda NO se rechaza', late.results[0].outcome !== 'rejected', late.results[0].outcome)

  const { rows } = await pullAll()
  const a = rows.find((r) => r.sync_id === id('a'))
  const b = rows.find((r) => r.sync_id === id('b'))

  check('las DOS filas siguen existiendo — nada se descarta', Boolean(a && b))
  check('la perdedora quedo supersedida por la ganadora', a?.superseded_by === id('b'), `superseded_by=${a?.superseded_by}`)
  check('la ganadora quedo activa', b?.superseded_by === null, `superseded_by=${b?.superseded_by}`)

  const active = rows.filter((r) => r.topic_key === 'deploy-target' && !r.deleted && r.superseded_by === null)
  check('hay exactamente UNA activa para el topic', active.length === 1, `activas=${active.length}`)
}

// ── 2. Tombstones cross ─────────────────────────────────────────────────────
// Spec §8.2. The old server never read `op` at all and its content column was NOT NULL, so
// a delete on one machine simply never reached the other.
console.log('\n2. tombstones — el borrado cruza de una maquina a la otra')
{
  await call('/v1/sync/push', {
    device_id: DEVICE_A,
    mutations: [mutation('borrable', { payload: { title: 'nace para morir' } })],
  })
  const del = await call('/v1/sync/push', {
    device_id: DEVICE_A,
    mutations: [mutation('borrable', { op: 'delete', payload: { content: null } })],
  })
  check('el delete se acepta', del.results[0].outcome !== 'rejected', del.results[0].outcome)

  const { rows } = await pullAll()
  const row = rows.find((r) => r.sync_id === id('borrable'))
  check('el tombstone viaja en el pull', Boolean(row))
  check('viene marcado deleted', row?.deleted === true, `deleted=${row?.deleted}`)
  check('acepta content nulo', row?.content === null, `content=${JSON.stringify(row?.content)}`)
}

// ── 3. Idempotency by (device_id, seq) ──────────────────────────────────────
// Spec §5.1. The client retries anything missing from `results`, and a response lost on
// the wire is indistinguishable from a mutation that was never processed — so a replay has
// to return the stored outcome instead of applying anything a second time.
console.log('\n3. idempotencia — reintentar el mismo (device_id, seq) no duplica')
{
  const idemSeq = nextSeq()
  const body = {
    device_id: DEVICE_C,
    mutations: [mutation('idem', { seq: idemSeq, payload: { title: 'una sola vez' } })],
  }
  const first = await call('/v1/sync/push', body)
  const replay = await call('/v1/sync/push', body)
  check(
    'el replay devuelve el mismo outcome',
    replay.results[0].outcome === first.results[0].outcome,
    `${first.results[0].outcome} -> ${replay.results[0].outcome}`
  )
  check(
    'el replay devuelve el MISMO project_seq, no uno nuevo',
    replay.results[0].project_seq === first.results[0].project_seq,
    `${first.results[0].project_seq} -> ${replay.results[0].project_seq}`
  )
}

// ── 4. tags survive as a real array ─────────────────────────────────────────
// Spec §5.2. The store keeps tags as a JSON string, the old server put that into a jsonb
// column and handed back a string, and the client discarded anything that was not an
// Array — so tags were lost on every round trip, in both directions, with no error.
console.log('\n4. tags — sobreviven el round trip como array de verdad')
{
  await call('/v1/sync/push', {
    device_id: DEVICE_A,
    mutations: [mutation('tags', { payload: { tags: ['alfa', 'beta'] } })],
  })
  const { rows } = await pullAll()
  const row = rows.find((r) => r.sync_id === id('tags'))
  check('tags vuelve como Array', Array.isArray(row?.tags), `typeof=${typeof row?.tags}`)
  check('con el contenido intacto', JSON.stringify(row?.tags) === '["alfa","beta"]', JSON.stringify(row?.tags))
}

// ── 5. client_updated_at is the CLIENT's clock ──────────────────────────────
// Spec §5.2. If the server substitutes its own clock, every LWW comparison on every device
// is computed against the wrong value and convergence quietly stops being deterministic.
console.log('\n5. client_updated_at — es el reloj del cliente, no el del servidor')
{
  const stamp = NOW - 86_400_000 // a day ago, on purpose
  await call('/v1/sync/push', {
    device_id: DEVICE_A,
    mutations: [mutation('stamp', { payload: { updated_at: stamp } })],
  })
  const { rows } = await pullAll()
  const row = rows.find((r) => r.sync_id === id('stamp'))
  const got = typeof row?.client_updated_at === 'number' ? row.client_updated_at : Date.parse(row?.client_updated_at)
  check('conserva el timestamp del cliente', got === stamp, `esperado ${stamp}, vino ${got}`)
}

// ── 6. project_seq monotonic and gapless within a project ───────────────────
// Spec §7. The pull cursor is `project_seq > n`, so a gap means a row is never pulled by
// anyone, ever — the exact silent loss a global bigserial would have introduced.
console.log('\n6. project_seq — monotonico y sin agujeros dentro del proyecto')
{
  const { rows } = await pullAll()
  const seqs = rows.map((r) => r.project_seq).sort((x, y) => x - y)
  check('sin duplicados', new Set(seqs).size === seqs.length, `${seqs.length} filas, ${new Set(seqs).size} unicos`)
  check('estrictamente creciente', seqs.every((s, i) => i === 0 || s > seqs[i - 1]))
}

// ── 7. The incremental pull returns nothing ─────────────────────────────────
// The 99% case in production, and the one that has to be cheap.
console.log('\n7. cursor — el segundo pull no devuelve nada')
{
  const first = await pullAll()
  const second = await call('/v1/sync/pull', { cursors: first.cursors, limit: 500 })
  check('el pull incremental vuelve vacio', second.rows.length === 0, `${second.rows.length} filas`)
  check('el servidor manda next_poll_ms', typeof second.next_poll_ms === 'number', `${second.next_poll_ms}`)
}

console.log(`\n${failures === 0 ? 'TODO OK' : `${failures} PROPIEDADES ROTAS`}\n`)

// Set the code and let Node drain on its own. Calling process.exit() here kills the loop
// mid-teardown and, on Windows, trips a libuv assertion — so the script would exit 127
// even when every check passed, which is worse than having no checker at all.
process.exitCode = failures === 0 ? 0 : 1
