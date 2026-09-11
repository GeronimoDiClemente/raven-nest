// El cifrado de punta a punta, con dos máquinas de verdad contra un servicio de verdad.
//
// Es el Step 1 de la Task 13 del plan `2026-09-09-nest-memories-cifrado.md`, automatizado
// en vez de hecho a mano: los seis pasos que ningún test unitario cubre, porque cada pieza
// está probada sola y lo que falta verificar es el cable entre todas.
//
// Uso (con el servicio y su Postgres levantados):
//   npx tsx scripts/smoke-cifrado-e2e.mjs --base http://127.0.0.1:8099 \
//       --token-a TOKEN_A --token-b TOKEN_B --pg 'postgres://...'
//
// El binding nativo tiene que ser el de Node puro (`npm run native:node`).
// No toca la memoria de nadie: dos stores en un tmpdir que se borran al terminar.
//
// ESTADO AL 2026-09-11 — LEER ANTES DE CONFIAR EN LA SALIDA.
//
// Lo que SI quedó verificado, con evidencia directa de Postgres y no de este script:
// las filas que el daemon subió con el cifrado puesto están en la base del servidor como
// `nmc1:…` en `title` y en `content`, y su `topic_key` es un HMAC hex. Ni una palabra
// legible. Esa consulta está más abajo en el paso 2 y es la que sostiene la promesa.
//
// Lo que este script TODAVIA NO cierra: los pasos 2 a 5 encadenados. El push del daemon
// sale de un `setTimeout` y las esperas de acá son temporales, así que la auditoría corre
// a veces antes de que la fila llegue. Dos trampas ya resueltas quedan anotadas porque
// cuestan caro de encontrar:
//   - `execFileSync` BLOQUEA el event loop: sondear la base cada 400ms impedía que el
//     timer del debounce corriera nunca, o sea que el smoke se impedía a sí mismo lo que
//     estaba tratando de medir.
//   - `save()` deriva el `sync_id` del CONTENIDO: dos corridas con el mismo texto producen
//     el mismo id, el servidor hace upsert sobre la fila de la corrida anterior —que vive
//     en otro `project_key`— y la auditoría termina mirando un proyecto vacío.
// Queda pendiente hacer las esperas por condición sobre el estado del servidor en vez de
// por tiempo. No se marca verde hasta entonces.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { MemoryStore } from '../electron/memory-store.ts'
import { MemoryDaemon } from '../electron/memory-daemon.ts'
import { generateMasterKey, deriveKeys, hmacTopicKey, CIPHER_PREFIX } from '../electron/memory-crypto.ts'
import { generateDeviceKeyPair } from '../electron/memory-key-wrap.ts'
import {
  activateEncryption, authorizeDevice, recoverWithCode, enrollPublicKey, fetchKeyState,
} from '../electron/memory-keys-client.ts'

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1] }
const BASE = arg('base', 'http://127.0.0.1:8099')
const TOKEN_A = arg('token-a')
const TOKEN_B = arg('token-b')
const PG = arg('pg')
const DB_NAME = arg('db', 'nest_memory')
const DEV_A = arg('device-a')
const DEV_B = arg('device-b')
if (!TOKEN_A || !TOKEN_B || !DEV_A || !DEV_B || (!PG && !arg('pg-docker'))) {
  console.error('faltan --token-a --token-b --device-a --device-b y --pg o --pg-docker')
  process.exit(2)
}

let fallos = 0
const ok = (c, t, d = '') => { console.log(`  ${c ? 'OK  ' : 'FALLA'} ${t}${d ? ' — ' + d : ''}`); if (!c) fallos++ }
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
async function hasta(cond, ms = 25_000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) { if (cond()) return true; await espera(400) }
  return cond()
}
/**
 * `psql` puede no estar instalado en la maquina (en esta no esta), pero SI esta adentro del
 * contenedor de Postgres. `--pg-docker <nombre>` corre la consulta ahi; `--pg` usa el psql
 * local. La verificacion contra la base es el punto central de este smoke —"que no quede
 * nada legible" solo se puede afirmar mirando la base— asi que no puede depender de que
 * quien lo corre tenga el cliente instalado.
 */
const PG_DOCKER = arg('pg-docker')
const sql = (q) => (PG_DOCKER
  ? execFileSync('docker', ['exec', '-i', PG_DOCKER, 'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c', q], { encoding: 'utf8' })
  : execFileSync('psql', [PG, '-t', '-A', '-c', q], { encoding: 'utf8' })).trim()

const home = mkdtempSync(join(tmpdir(), 'nest-cifrado-'))

function maquina(nombre, token, deviceId, master) {
  const store = new MemoryStore(join(home, `${nombre}.db`))
  let claves = master ? deriveKeys(Buffer.from(master, 'base64')) : null
  if (claves) store.setTopicHasher((p, s, t) => hmacTopicKey(claves, p, s, t))
  const espiar = async (url, init) => {
    const res = await fetch(url, init)
    if (process.env.SMOKE_VERBOSE && String(url).includes('/push')) {
      const t = await res.clone().text().catch(() => '')
      console.log(`    [${nombre}] push ${res.status} ${t.slice(0, 240)}`)
    }
    return res
  }
  const daemon = new MemoryDaemon({
    store,
    fetchImpl: espiar,
    getSyncBaseUrl: () => BASE,
    getToken: () => token,
    getDeviceId: () => deviceId,
    isOnline: () => true,
    getEnvelopeContext: () => (claves ? { keys: claves, keyEpoch: 1 } : null),
  })
  return {
    store, daemon, deps: { baseUrl: BASE, token, deviceId, fetchImpl: fetch },
    ponerClave(m) {
      claves = deriveKeys(Buffer.from(m, 'base64'))
      store.setTopicHasher((p, s, t) => hmacTopicKey(claves, p, s, t))
    },
  }
}

try {
  const marca = `cif-${Date.now()}`
  console.log(`\nel cifrado de punta a punta contra ${BASE} · proyecto ${marca}\n`)

  // ── 1. A activa el cifrado ────────────────────────────────────────────────
  console.log('1. la maquina A activa el cifrado')
  const parA = generateDeviceKeyPair()
  const A = maquina('a', TOKEN_A, DEV_A, null)
  const activacion = await activateEncryption(A.deps, parA)
  ok(Boolean(activacion.master), 'devuelve una maestra')
  ok(/^[0-9A-Z-]{20,}$/.test(activacion.recoveryCode), 'y un codigo de recuperacion', activacion.recoveryCode)
  A.ponerClave(activacion.master)

  // ── 2. A guarda y sube; en Postgres no queda texto legible ────────────────
  console.log('\n2. lo que A sube llega cifrado a la base del servidor')
  A.store.ensureProject({ projectKey: marca, displayName: 'secreto', rootPath: `/tmp/${marca}`, remoteUrl: null })
  A.store.save({
    projectKey: marca, type: 'decision', source: 'mcp',
    // El texto lleva la marca de la corrida: `save()` deriva el `sync_id` del CONTENIDO,
    // asi que dos corridas con el mismo texto producen el mismo id y el servidor hace
    // upsert sobre la fila de la corrida anterior — que vive en otro project_key. La
    // auditoria buscaba entonces en un proyecto vacio y "fallaba" por culpa del smoke.
    title: `La contraseña del bunker es rosebud (${marca})`,
    content: `Y el plan de precios sube 40% en marzo. (${marca})`,
    topicKey: 'precios', tags: ['secreto'],
  })
  A.daemon.onNetworkRegain()
  await hasta(() => A.daemon.isOnline())
  A.daemon.scheduleMutationPush()
  // `espera()` y no `hasta(() => sql(...))`: `execFileSync` BLOQUEA el event loop, y el
  // push del daemon sale de un `setTimeout` (debounce de 3s). Sondear la base cada 400ms
  // con una llamada sincronica deja al timer sin correr nunca, asi que el smoke se
  // impedia a si mismo lo que estaba tratando de medir.
  await espera(9_000)
  const llego = Number(sql(`select count(*) from observations o join projects p on p.id=o.project_id
                             where p.project_key='${marca}'`))
  ok(llego > 0, 'la fila llega al servidor', `${llego}`)

  const enClaro = sql(`select count(*) from observations o join projects p on p.id=o.project_id
                        where p.project_key='${marca}' and o.content is not null
                          and o.content not like '${CIPHER_PREFIX}%'`)
  const cifradas = sql(`select count(*) from observations o join projects p on p.id=o.project_id
                         where p.project_key='${marca}' and o.content like '${CIPHER_PREFIX}%'`)
  ok(Number(cifradas) > 0, 'la fila esta en la base como ciphertext', `${cifradas} cifradas`)
  ok(Number(enClaro) === 0, 'y NO queda ni una en claro', `${enClaro} en claro`)

  const fuga = sql(`select count(*) from observations o join projects p on p.id=o.project_id
                     where p.project_key='${marca}'
                       and (o.content ilike '%rosebud%' or o.title ilike '%bunker%'
                            or o.content ilike '%40%%' )`)
  ok(Number(fuga) === 0, 'ni una palabra del secreto es buscable en Postgres', `${fuga} coincidencias`)

  const temaEnClaro = sql(`select count(*) from observations o join projects p on p.id=o.project_id
                            where p.project_key='${marca}' and o.topic_key = 'precios'`)
  ok(Number(temaEnClaro) === 0, 'el topic_key viaja hasheado, no en claro')

  // ── 3. B, sin autorizar, no puede leer ────────────────────────────────────
  console.log('\n3. la maquina B, sin autorizar, ve que no puede leer')
  const parB = generateDeviceKeyPair()
  const B = maquina('b', TOKEN_B, DEV_B, null)
  await enrollPublicKey(B.deps, parB.publicKey)
  B.daemon.onNetworkRegain()
  await espera(4_000)
  ok(B.store.undecryptableCount() > 0, 'B cuenta las filas ilegibles', `${B.store.undecryptableCount()}`)
  ok(B.store.count() === 0, 'y NO guarda ciphertext en su base local', `${B.store.count()} filas`)

  // ── 4. A autoriza a B ─────────────────────────────────────────────────────
  console.log('\n4. A autoriza a B, y B pasa a leer')
  const estado = await fetchKeyState(A.deps)
  const pendiente = estado.devices.find((d) => d.deviceId === DEV_B)
  ok(Boolean(pendiente), 'A ve a B esperando autorizacion')
  await authorizeDevice(A.deps, activacion.master, estado.keyEpoch, {
    deviceId: DEV_B, publicKey: parB.publicKey,
  })
  const recuperadaB = await recoverWithCode(B.deps, parB, activacion.recoveryCode)
  ok(recuperadaB.master === activacion.master, 'B obtiene la MISMA maestra')
  B.ponerClave(recuperadaB.master)
  B.store.clearUndecryptable()
  B.store.resetPullCursors()
  B.daemon.onNetworkRegain()
  await espera(5_000)
  ok(B.store.count() > 0, 'B baja las memorias', `${B.store.count()}`)
  const leida = B.store.context(marca, 10)[0]
  ok(Boolean(leida?.title?.includes('rosebud')), 'y las lee EN CLARO', leida?.title ?? '(nada)')
  ok(B.store.undecryptableCount() === 0, 'el contador de ilegibles vuelve a cero')

  // ── 5. B escribe el mismo topico: supersede, no duplica ───────────────────
  console.log('\n5. B escribe el mismo topico y supersede en vez de duplicar')
  B.store.save({
    projectKey: marca, type: 'decision', source: 'mcp',
    title: `Corregido: el plan sube 25% (${marca})`, content: `Se reviso el numero. (${marca})`,
    topicKey: 'precios', tags: ['secreto'],
  })
  B.daemon.scheduleMutationPush()
  await espera(6_000)
  A.daemon.onNetworkRegain()
  await espera(5_000)
  const activasA = A.store.context(marca, 20).filter((m) => m.topicKey === 'precios')
  ok(activasA.length === 1, 'A queda con UNA sola activa para ese tema', `${activasA.length}`)
  ok(activasA[0]?.title.includes('Corregido'), 'y es la nueva', activasA[0]?.title ?? '')

  A.daemon.stop(); B.daemon.stop(); A.store.close(); B.store.close()
  console.log(fallos === 0 ? '\nTODO OK\n' : `\n${fallos} FALLARON\n`)
  process.exitCode = fallos === 0 ? 0 : 1
} catch (err) {
  console.error('\nel smoke reviento:', err)
  process.exitCode = 1
} finally {
  try { rmSync(home, { recursive: true, force: true }) } catch { /* ya no esta */ }
}
