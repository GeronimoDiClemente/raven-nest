// El daemon REAL de Nest contra un servicio de sync REAL, por HTTP.
//
// Por qué existe: `memory-daemon.test.ts` mockea `fetch`, y el contract check
// (`memory-sync-contract-check.mjs`) habla el protocolo a mano sin usar una línea del
// cliente. O sea que las dos mitades estaban probadas y **el cable entre ellas no**: que
// el daemon de la app efectivamente empuje lo que tiene pendiente y baje lo del otro lado
// no lo verificaba nadie.
//
// Uso (con tsx, porque importa los fuentes .ts de `electron/` directamente):
//   npx tsx scripts/smoke-sync-daemon.mjs --base http://127.0.0.1:8099 --token EL_TOKEN
//
// El binding nativo de better-sqlite3 tiene que ser el de Node puro: `npm run native:node`
// antes, y `npm run native:electron` después para que la app vuelva a arrancar.
//
// No toca la memoria de nadie: crea su propio store en un tmpdir y lo borra al terminar.
//
// ESTADO AL 2026-09-11: los pasos 1 y 2 pasan (una máquina sube, otra baja, con título y
// contenido intactos). El paso 3 —la vuelta— FALLA, y el fallo es real, no del script:
// después de que B sube su memoria y el servidor contesta `applied`, la cola de B sigue
// con una mutación pendiente que el push nunca incluye, y el push siguiente de A reenvía
// `sync_id` que A no escribió sino que bajó de B. O sea que aplicar una fila que vino del
// servidor encola trabajo local que rebota. Convergir converge (el push es idempotente por
// (device_id, seq) y el merge es LWW), pero la cola no se drena nunca mientras haya dos
// máquinas activas. La causa exacta en el código está sin identificar.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../electron/memory-store.ts'
import { MemoryDaemon } from '../electron/memory-daemon.ts'

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`)
  return i === -1 ? porDefecto : process.argv[i + 1]
}

const BASE = arg('base', 'http://127.0.0.1:8099')
const TOKEN = arg('token')
if (!TOKEN) {
  console.error('falta --token')
  process.exit(2)
}

let fallos = 0
function ok(cond, texto, detalle = '') {
  console.log(`  ${cond ? 'OK  ' : 'FALLA'} ${texto}${detalle ? ` — ${detalle}` : ''}`)
  if (!cond) fallos++
}

const home = mkdtempSync(join(tmpdir(), 'nest-sync-smoke-'))
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

function hacerDaemon(store, deviceId, nombre) {
  // Envuelve `fetch` para poder mirar lo que el servicio contesta: un push cuyo batch
  // vuelve con `outcome: rejected` termina en `idle` sin error visible, así que desde
  // afuera un rechazo y un éxito se ven igual.
  const espiar = async (url, init) => {
    const res = await fetch(url, init)
    if (process.env.SMOKE_VERBOSE && String(url).includes('/push')) {
      const copia = res.clone()
      const cuerpo = await copia.text().catch(() => '')
      console.log(`    [${nombre}] push -> ${res.status} ${cuerpo.slice(0, 300)}`)
    }
    return res
  }
  return new MemoryDaemon({
    store,
    fetchImpl: espiar,
    getSyncBaseUrl: () => BASE,
    getToken: () => TOKEN,
    getDeviceId: () => deviceId,
    isOnline: () => true,
    onStatusChange: (estado, detalle) => {
      if (process.env.SMOKE_VERBOSE) console.log(`    [${nombre}] ${estado}${detalle ? ' · ' + detalle : ''}`)
    },
  })
}

/** Espera hasta que `cond()` se cumpla o se acabe el tiempo. Devuelve si se cumplió. */
async function hasta(cond, ms = 20_000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    if (cond()) return true
    await espera(400)
  }
  return cond()
}

try {
  console.log(`\nel daemon de Nest contra ${BASE}\n`)

  // ── Máquina A: guarda memorias y las empuja ────────────────────────────────
  const marca = `smoke-${Date.now()}`
  const storeA = new MemoryStore(join(home, 'a.db'))
  storeA.ensureProject({ projectKey: marca, displayName: 'smoke', rootPath: `/tmp/${marca}`, remoteUrl: null })
  storeA.save({
    projectKey: marca, type: 'decision', source: 'mcp',
    title: `A decidio algo (${marca})`, content: 'El contenido que tiene que llegar a la otra maquina.',
    topicKey: `${marca}-uno`, tags: ['smoke'],
  })
  storeA.save({
    projectKey: marca, type: 'bugfix', source: 'mcp',
    title: `A arreglo algo (${marca})`, content: 'Segunda memoria.',
    topicKey: `${marca}-dos`, tags: ['smoke'],
  })

  console.log('1. la maquina A empuja lo que tiene pendiente')
  const pendientesAntes = storeA.pendingMutationCount()
  ok(pendientesAntes >= 2, 'arranca con mutaciones pendientes', `${pendientesAntes}`)

  const daemonA = hacerDaemon(storeA, '22222222-2222-2222-2222-222222222222', 'A')
  daemonA.onNetworkRegain()
  await hasta(() => daemonA.isOnline() && daemonA.getPlan() !== undefined)
  ok(daemonA.isOnline(), 'el daemon se reporta online contra el servicio')
  ok(daemonA.getPlan() !== undefined, 'el servicio le dijo que plan tiene', String(daemonA.getPlan()))

  daemonA.scheduleMutationPush()
  const vacio = await hasta(() => storeA.pendingMutationCount() === 0, 25_000)
  ok(vacio, 'la cola de pendientes queda en cero', `${storeA.pendingMutationCount()} sin subir`)

  const cuota = daemonA.getQuota()
  ok(cuota != null && cuota.used_bytes > 0, 'el servicio contabiliza los bytes subidos',
    cuota ? `${cuota.used_bytes} de ${cuota.max_bytes}` : 'sin cuota')

  // ── Máquina B: base vacía, se las baja ─────────────────────────────────────
  console.log('\n2. la maquina B, que arranca vacia, se las baja')
  const storeB = new MemoryStore(join(home, 'b.db'))
  ok(storeB.count() === 0, 'B arranca sin ninguna memoria', `${storeB.count()}`)

  const daemonB = hacerDaemon(storeB, '33333333-3333-3333-3333-333333333333', 'B')
  daemonB.onNetworkRegain()
  const bajaron = await hasta(() => storeB.count() >= 2, 25_000)
  ok(bajaron, 'las memorias de A aparecen en B', `${storeB.count()} bajadas`)

  const titulos = storeB.context(marca, 10).map((m) => m.title).sort()
  ok(titulos.some((t) => t.includes('A decidio algo')), 'con el titulo intacto')
  const cuerpo = storeB.context(marca, 10).find((m) => m.title.includes('A decidio algo'))
  ok(cuerpo?.content === 'El contenido que tiene que llegar a la otra maquina.',
    'y con el contenido intacto', cuerpo?.content?.slice(0, 40) ?? 'sin contenido')

  // ── Ida y vuelta: B escribe, A lo recibe ───────────────────────────────────
  console.log('\n3. la vuelta: B escribe y A lo recibe')
  storeB.save({
    projectKey: marca, type: 'pattern', source: 'mcp',
    title: `B respondio (${marca})`, content: 'Escrita en la segunda maquina.',
    topicKey: `${marca}-tres`, tags: ['smoke'],
  })
  const pendB = storeB.pendingMutationCount()
  ok(pendB >= 1, 'B encola la mutacion', `${pendB}`)
  daemonB.scheduleMutationPush()
  const subioB = await hasta(() => storeB.pendingMutationCount() === 0, 25_000)
  ok(subioB, 'B sube lo que escribio',
    `quedan ${storeB.pendingMutationCount()} · estado=${daemonB.getStatus()}`)
  if (!subioB && process.env.SMOKE_VERBOSE) {
    for (const m of storeB.pendingMutations(5)) {
      let sid = '(sin sync_id)'
      try { sid = JSON.parse(m.payload).sync_id } catch { /* payload raro */ }
      console.log(`    [B] pendiente seq=${m.seq} op=${m.op} sync_id=${sid}`)
    }
  }

  daemonA.onNetworkRegain()
  const volvio = await hasta(
    () => storeA.context(marca, 20).some((m) => m.title.includes('B respondio')), 25_000)
  ok(volvio, 'lo que escribio B llega a A')

  daemonA.stop()
  daemonB.stop()
  storeA.close()
  storeB.close()

  console.log(fallos === 0 ? '\nTODO OK\n' : `\n${fallos} FALLARON\n`)
  process.exitCode = fallos === 0 ? 0 : 1
} catch (err) {
  console.error('\nel smoke reviento:', err)
  process.exitCode = 1
} finally {
  try { rmSync(home, { recursive: true, force: true }) } catch { /* ya no esta */ }
}
