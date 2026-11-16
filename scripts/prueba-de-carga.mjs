// Prueba de carga y de concurrencia contra el servicio de sync.
//
// Es el punto 8 de la lista de §12 del diseño del backend, y sobre todo lo que su §13 marca
// como obligatorio y nunca se hizo:
//
//   "el benchmark de esta spec corrió en PGlite, que es de una sola conexión. La asignación
//    por rango hay que verificarla con conexiones peleando de verdad: N clientes pusheando
//    al mismo proyecto no pueden producir un hueco ni un duplicado en la secuencia."
//
// Eso no es una métrica de performance: es una propiedad de correctitud que sólo se rompe
// bajo concurrencia real. Un duplicado en `project_seq` deja a un device sin poder pullear.
//
// Uso:
//   npx tsx scripts/prueba-de-carga.mjs --base http://127.0.0.1:8099 \
//     --pg-docker nest-carga --devices 8 --por-device 50
import { execFileSync } from 'node:child_process'

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1] }
const BASE = arg('base', 'http://127.0.0.1:8099')
const CT = arg('pg-docker', 'nest-carga')
const DB = arg('db', 'nest_memory')
// OJO con subirlo: el tope de DEVICES lo pone el plan (`maxDevicesFor`, `server/src/limits.ts`
// — 10 en cloud/pro), y `authenticate` devuelve 403 `device_limit_reached` a partir del 11.
// Con 32 esta prueba reportaba 4400 rechazos que no eran una falla del servidor sino el
// limite haciendo exactamente su trabajo. Para medir MAS carga, subir `--por-device`.
const N_DEV = Number(arg('devices', 8))
const POR_DEV = Number(arg('por-device', 50))
const UID = '88888888-8888-8888-8888-888888888888'

let fallos = 0
const ok = (c, t, d = '') => { console.log(`  ${c ? 'OK  ' : 'FALLA'} ${t}${d ? ' — ' + d : ''}`); if (!c) fallos++ }
const psql = (q) =>
  execFileSync('docker', ['exec', '-i', CT, 'psql', '-U', 'postgres', '-d', DB, '-t', '-A', '-c', q], { encoding: 'utf8' }).trim()
const sha = (s) => execFileSync('node', ['-e', `console.log(require('crypto').createHash('sha256').update(${JSON.stringify(s)}).digest('hex'))`], { encoding: 'utf8' }).trim()
const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))]

const marca = `carga-${Date.now()}`

async function main() {
  console.log(`\nprueba de carga: ${N_DEV} devices x ${POR_DEV} observaciones al MISMO proyecto\n`)

  // Devices reales, cada uno con su token: la idempotencia del servidor es por
  // `(device_id, seq)` y el device sale del TOKEN, no del body.
  const devices = []
  // Los devices de corridas anteriores se borran: el tope lo pone el plan (10), y una
  // cuenta que acumula 40 devices de pruebas viejas hace que TODA corrida nueva reciba
  // 403 `device_limit_reached` — la prueba medía su propia basura, no el servicio.
  let seed = `insert into users (id, plan) values ('${UID}','pro') on conflict (id) do update set plan='pro';
               insert into allowlist (user_id) values ('${UID}') on conflict do nothing;
               delete from devices where user_id = '${UID}';`
  for (let i = 0; i < N_DEV; i++) {
    const token = `carga-${marca}-${i}`
    // Device ids UNICOS por corrida. Con ids fijos, el rate limiter —que es en memoria y
    // por device, con ventana de un minuto— llegaba a la corrida siguiente con la cuota ya
    // gastada por la anterior: una prueba de 4x100 daba 400 de 400 limitadas y 0 aplicadas,
    // y la medicion media la contaminacion en vez del servicio.
    const id = `cccccccc-0000-0000-${String(i).padStart(4, '0')}-${String(Date.now() % 1e12).padStart(12, '0')}`
    devices.push({ id, token })
    seed += `insert into devices (id, user_id, name, token_hash) values ('${id}','${UID}','dev${i}','${sha(token)}')
             on conflict (id) do update set token_hash = excluded.token_hash;`
  }
  psql(seed)

  // ── Todos empujando al MISMO proyecto, a la vez ───────────────────────────
  const latencias = []
  const arranque = Date.now()
  const resultados = await Promise.all(devices.map(async (d, di) => {
    let aplicadas = 0, rechazadas = 0, limitadas = 0
    for (let lote = 0; lote < POR_DEV / 10; lote++) {
      const mutations = Array.from({ length: 10 }, (_, k) => {
        const n = lote * 10 + k
        return {
          seq: n + 1,
          sync_id: `obs-${marca}-${di}-${n}`,
          op: 'upsert',
          payload: {
            sync_id: `obs-${marca}-${di}-${n}`,
            project_key: marca,
            project_display_name: marca,
            scope: 'personal', type: 'decision',
            title: `t${di}-${n}`, content: 'x'.repeat(400),
            tags: [], lamport: n + 1,
            updated_at: Date.now(), created_at: Date.now(),
          },
        }
      })
      const t0 = Date.now()
      const res = await fetch(`${BASE}/v1/sync/push`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: d.id, mutations }),
      })
      latencias.push(Date.now() - t0)
      // 429 y 403 `device_limit_reached` NO son fallas: son los limites del plan haciendo
      // su trabajo. Contarlos como error hacia que la prueba "fallara" justo cuando el
      // servicio se estaba comportando bien, que es la peor clase de falso rojo.
      if (res.status === 429) { limitadas += mutations.length; continue }
      if (!res.ok) { rechazadas += mutations.length; continue }
      const body = await res.json()
      for (const r of body.results ?? []) {
        if (r.outcome === 'rejected') rechazadas++
        else aplicadas++
      }
    }
    return { aplicadas, rechazadas, limitadas }
  }))
  const segundos = (Date.now() - arranque) / 1000
  const totalAplicadas = resultados.reduce((s, r) => s + r.aplicadas, 0)
  const totalRechazadas = resultados.reduce((s, r) => s + r.rechazadas, 0)
  const totalLimitadas = resultados.reduce((s, r) => s + r.limitadas, 0)

  console.log('1. throughput')
  ok(totalRechazadas === 0, 'ningun rechazo que no sea un limite', `${totalRechazadas}`)
  ok(totalAplicadas + totalLimitadas === N_DEV * POR_DEV,
    'todo lo enviado se aplico o se limito — nada se perdio en el medio',
    `${totalAplicadas} aplicadas + ${totalLimitadas} limitadas de ${N_DEV * POR_DEV}`)
  if (totalLimitadas > 0) {
    console.log(`       (${totalLimitadas} frenadas por el rate limit de 60 push/min por device: el limite funciona)`)
  }
  latencias.sort((a, b) => a - b)
  console.log(`       ${(totalAplicadas / segundos).toFixed(0)} obs/s · ${segundos.toFixed(1)}s · ` +
    `latencia por lote de 10: p50 ${pct(latencias, 0.5)}ms · p95 ${pct(latencias, 0.95)}ms · max ${latencias[latencias.length - 1]}ms`)

  // ── La propiedad que la spec marca como obligatoria ───────────────────────
  console.log('\n2. project_seq bajo conexiones peleando de verdad')
  const pid = psql(`select id from projects where project_key='${marca}' and user_id='${UID}'`)
  if (!pid) { ok(false, 'el proyecto existe en la base', 'no se creo ninguno'); return }
  const filas = Number(psql(`select count(*) from observations where project_id=${pid}`))
  const distintos = Number(psql(`select count(distinct project_seq) from observations where project_id=${pid}`))
  const maxSeq = Number(psql(`select coalesce(max(project_seq),0) from observations where project_id=${pid}`))
  const minSeq = Number(psql(`select coalesce(min(project_seq),0) from observations where project_id=${pid}`))
  ok(filas === totalAplicadas, 'la base tiene exactamente lo que el servidor dijo aplicar', `${filas} vs ${totalAplicadas}`)
  ok(filas === distintos, 'NINGUN project_seq duplicado', `${filas} filas, ${distintos} seq distintos`)
  // Sin huecos: con N filas y seq consecutivos, max - min + 1 tiene que ser N.
  ok(maxSeq - minSeq + 1 === filas, 'NINGUN hueco en la secuencia', `min ${minSeq}, max ${maxSeq}, filas ${filas}`)

  // ── Idempotencia bajo reintento concurrente ──────────────────────────────
  console.log('\n3. reintentar el mismo lote en paralelo no duplica')
  const d0 = devices[0]
  const lote = {
    device_id: d0.id,
    mutations: [{
      seq: 1, sync_id: `obs-${marca}-0-0`, op: 'upsert',
      payload: {
        sync_id: `obs-${marca}-0-0`, project_key: marca, project_display_name: marca,
        scope: 'personal', type: 'decision', title: 't0-0', content: 'x'.repeat(400),
        tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
      },
    }],
  }
  const reintentos = await Promise.all(Array.from({ length: 6 }, () =>
    fetch(`${BASE}/v1/sync/push`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${d0.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(lote),
    }).then((r) => r.json())
  ))
  const seqs = new Set(reintentos.map((r) => r.results?.[0]?.project_seq))
  ok(seqs.size === 1, 'los 6 reintentos devuelven el MISMO project_seq', [...seqs].join(','))
  const despues = Number(psql(`select count(*) from observations where project_id=${pid}`))
  ok(despues === filas, 'y no se agrego ninguna fila', `${filas} -> ${despues}`)

  // ── Cuánto ocupa: el dato que falta para calcular costo ──────────────────
  console.log('\n4. cuanto ocupa, para poder hablar de costo')
  const bytes = Number(psql(`select coalesce(sum(octet_length(content)),0) from observations where project_id=${pid}`))
  const total = Number(psql(`select pg_total_relation_size('observations')`))
  console.log(`       contenido: ${(bytes / filas).toFixed(0)} B por observacion`)
  console.log(`       tabla observations completa (indices incluidos): ${(total / 1024 / 1024).toFixed(1)} MB para ${psql('select count(*) from observations')} filas`)

  console.log(fallos === 0 ? '\nTODO OK\n' : `\n${fallos} FALLARON\n`)
  process.exitCode = fallos === 0 ? 0 : 1
}

main().catch((e) => { console.error('reviento:', e); process.exitCode = 1 })
