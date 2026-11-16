#!/usr/bin/env node
// Prueba de carga a ~100x (spec §12.8, el único punto del checklist de apertura a usuarios
// que seguía sin código al 2026-09-07). Corre SIEMPRE contra el Postgres LOCAL de desarrollo
// (nunca contra Railway real) — decisión explícita de Gero, para no arriesgar el servicio en
// producción con una corrida sintética.
//
// SE CORRE CON `npx tsx`, no con `node` pelado: importa TypeScript de `src/` directo, mismo
// patrón que `restore-check.mjs`.
//
//   npx tsx scripts/load-test.mjs                    # 100 devices x 5 rondas (default)
//   npx tsx scripts/load-test.mjs --devices 300 --rounds 3
//   npx tsx scripts/load-test.mjs --keep              # no borra los datos de prueba al final
//
// El riesgo real que esto verifica NO es "aguanta muchos requests por segundo" — es el que
// la propia spec marca en §13/§15 como obligatorio, no opcional: "la asignación por rango
// hay que verificarla con conexiones peleando de verdad: N clientes pusheando al MISMO
// proyecto no pueden producir un hueco ni un duplicado en la secuencia". Los tests de
// concurrencia existentes (push-concurrency.test.ts) ya prueban esto con 2-4 clientes —
// esto lo prueba con ~100, contra el mismo pool de conexiones limitado (PG_POOL_MAX=10 por
// default) que usaría producción, así que también mide qué tan bien se degrada la latencia
// cuando hay más devices que conexiones disponibles.
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db.ts'
import { handlePush } from '../src/push.ts'
import { handlePull } from '../src/pull.ts'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const value = (n, def) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : def }

const N_DEVICES = value('--devices', 100)
const N_ROUNDS = value('--rounds', 5)
const KEEP = flag('--keep')

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const PROJECT_KEY = `load-${RUN}`

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

// Nota: p50/p95/p99 son de LATENCIA POR OPERACIÓN individual (cuánto tardó cada push/pull),
// no de throughput — con operaciones concurrentes, sumar latencias no da un ops/seg válido
// (eso ya se reporta aparte, con el wall-clock real de la corrida completa).
function report(name, msLatencies, errors) {
  const sorted = [...msLatencies].sort((a, b) => a - b)
  console.table({
    [name]: {
      ops: sorted.length,
      errores: errors,
      'p50 ms': percentile(sorted, 50).toFixed(1),
      'p95 ms': percentile(sorted, 95).toFixed(1),
      'p99 ms': percentile(sorted, 99).toFixed(1),
      'max ms': sorted.length ? sorted[sorted.length - 1].toFixed(1) : '0',
    },
  })
}

async function timed(fn) {
  const start = performance.now()
  try {
    await fn()
    return { ms: performance.now() - start, ok: true }
  } catch (err) {
    return { ms: performance.now() - start, ok: false, err }
  }
}

async function main() {
  console.log(`· prueba de carga: ${N_DEVICES} devices x ${N_ROUNDS} rondas, todos al MISMO proyecto (${PROJECT_KEY})`)
  console.log(`· contra: ${process.env.DATABASE_URL ?? 'postgres://postgres:nestmem@127.0.0.1:55432/nest_memory (default local)'}`)
  console.log(`· PG_POOL_MAX: ${process.env.PG_POOL_MAX ?? '10 (default)'} — con más devices que conexiones, el resto hace cola de verdad, como en producción`)

  await migrate(pool)

  const userId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'team')`, [userId])

  const devices = []
  for (let i = 0; i < N_DEVICES; i++) {
    const deviceId = randomUUID()
    await pool.query(
      `insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)`,
      [deviceId, userId, `load-device-${i}`, `hash-${deviceId}`]
    )
    devices.push({ deviceId, userId, plan: 'team' })
  }
  console.log(`· ${N_DEVICES} devices sembrados bajo un solo usuario`)

  const pushLatencies = []
  const pullLatencies = []
  let pushErrors = 0
  let pullErrors = 0
  let seqCounter = 0

  const t0 = performance.now()
  for (let round = 0; round < N_ROUNDS; round++) {
    const pushResults = await Promise.all(
      devices.map((auth, i) => {
        const seq = round + 1 // seq del propio device, arranca en 1 por device
        const syncId = `${PROJECT_KEY}-r${round}-d${i}`
        return timed(async () => {
          const res = await handlePush(pool, auth, {
            mutations: [{
              seq,
              sync_id: syncId,
              op: 'upsert',
              payload: {
                sync_id: syncId,
                project_key: PROJECT_KEY,
                project_display_name: PROJECT_KEY,
                scope: 'personal',
                type: 'discovery',
                topic_key: null, // sin topic_key: cada push es su propia fila, cero colisiones esperadas
                title: `carga ronda ${round} device ${i}`,
                content: 'contenido de prueba de carga',
                tags: [],
                lamport: 1,
                updated_at: Date.now(),
                created_at: Date.now(),
              },
            }],
          })
          if (res.results[0]?.outcome !== 'applied') {
            throw new Error(`outcome inesperado: ${JSON.stringify(res.results[0])}`)
          }
        })
      })
    )
    for (const r of pushResults) {
      pushLatencies.push(r.ms)
      if (!r.ok) { pushErrors++; console.error('  ! push falló:', r.err?.message) }
    }

    const pullResults = await Promise.all(
      devices.map((auth) =>
        timed(() => handlePull(pool, auth, { cursors: { [PROJECT_KEY]: 0 }, limit: 500 }))
      )
    )
    for (const r of pullResults) {
      pullLatencies.push(r.ms)
      if (!r.ok) { pullErrors++; console.error('  ! pull falló:', r.err?.message) }
    }

    seqCounter += devices.length
    console.log(`· ronda ${round + 1}/${N_ROUNDS} — ${devices.length} push + ${devices.length} pull concurrentes hechos`)
  }
  const totalMs = performance.now() - t0

  console.log(`\n· terminado en ${(totalMs / 1000).toFixed(1)}s — ${(seqCounter * 2 / (totalMs / 1000)).toFixed(0)} ops/seg agregado (push+pull)\n`)
  report('push', pushLatencies, pushErrors)
  report('pull', pullLatencies, pullErrors)

  // La verificación real: ¿la asignación de project_seq bajo contención real produjo algún
  // hueco o duplicado? Con N_DEVICES*N_ROUNDS pushes exitosos esperados (sin topic_key, sin
  // colisiones, sin rechazos), la secuencia tiene que ser EXACTAMENTE 1..total, sin huecos
  // ni repetidos — esto es lo que §13/§15 de la spec pide verificar "con conexiones peleando
  // de verdad", no con los 2-4 clientes de los tests unitarios.
  const expectedTotal = N_DEVICES * N_ROUNDS
  const { rows: seqRows } = await pool.query(
    `select project_seq, count(*)::int as n from observations o
       join projects p on p.id = o.project_id
      where p.project_key = $1 and p.user_id = $2
      group by project_seq`,
    [PROJECT_KEY, userId]
  )
  const duplicates = seqRows.filter((r) => r.n > 1)
  const seqs = seqRows.map((r) => Number(r.project_seq)).sort((a, b) => a - b)
  const gaps = []
  for (let i = 1; i <= expectedTotal; i++) {
    if (!seqs.includes(i)) gaps.push(i)
  }

  console.log('=== Verificación de corrección de project_seq bajo carga ===')
  console.log(`· filas esperadas: ${expectedTotal}, filas reales: ${seqRows.length}`)
  console.log(`· duplicados: ${duplicates.length}${duplicates.length ? ' -> ' + JSON.stringify(duplicates) : ''}`)
  console.log(`· huecos: ${gaps.length}${gaps.length ? ' -> ' + JSON.stringify(gaps.slice(0, 20)) + (gaps.length > 20 ? '...' : '') : ''}`)

  // Bonus: confirma que push_count/pull_count (la observabilidad de hoy) también aguantan
  // bajo la misma carga concurrente — cada device hizo exactamente N_ROUNDS push y N_ROUNDS
  // pull, así que sus contadores tienen que valer exactamente eso, ni más ni menos.
  const { rows: counterRows } = await pool.query(
    `select
       count(*) filter (where push_count <> $2) as push_mal,
       count(*) filter (where pull_count <> $2) as pull_mal
     from devices where user_id = $1`,
    [userId, N_ROUNDS]
  )
  console.log(`· devices con push_count incorrecto: ${counterRows[0].push_mal}`)
  console.log(`· devices con pull_count incorrecto: ${counterRows[0].pull_mal}`)

  const fallo =
    duplicates.length > 0 ||
    gaps.length > 0 ||
    seqRows.length !== expectedTotal ||
    pushErrors > 0 ||
    pullErrors > 0 ||
    Number(counterRows[0].push_mal) > 0 ||
    Number(counterRows[0].pull_mal) > 0

  if (!KEEP) {
    // observations.author_id -> users NO tiene cascade (a diferencia de devices/projects),
    // así que hay que borrarlas explícitamente antes o el delete de users tira FK violation.
    await pool.query('delete from observations where author_id = $1', [userId])
    await pool.query('delete from users where id = $1', [userId]) // cascada: devices, projects, push_receipts
    console.log(`· datos de prueba borrados (usuario ${userId} y todo lo que cuelga de él)`)
  } else {
    console.log(`· datos de prueba conservados (--keep), usuario ${userId}`)
  }

  if (fallo) {
    console.error('\nx PRUEBA DE CARGA FALLÓ — ver detalle arriba')
    process.exit(1)
  }
  console.log('\nOK — carga soportada, cero huecos, cero duplicados, cero errores')
}

await main()
await pool.end()
