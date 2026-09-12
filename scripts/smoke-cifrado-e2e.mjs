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
// ESTADO AL 2026-09-12: los cinco pasos pasan contra el servicio real.
//
// Lo que eso significa, dicho entero: una máquina activa el cifrado; lo que sube queda en
// Postgres como `nmc1:…` en `title` y `content`, con el `topic_key` hasheado y sin que una
// sola palabra del secreto sea buscable; una segunda máquina sin autorizar cuenta las filas
// como ilegibles y NO guarda ciphertext en su base local; al autorizarla obtiene la misma
// maestra y las lee en claro; y una memoria que escribe sobre un tópico que ya existía
// supersede en vez de duplicar.
//
// Cuatro trampas costaron encontrar y quedan escritas porque todas produjeron rojos falsos:
//   - `execFileSync` BLOQUEA el event loop: sondear la base cada 400 ms impedía que el timer
//     del debounce corriera, o sea que el smoke se impedía a sí mismo lo que medía. Los
//     sondeos van con `sqlAsync`/`hastaAsync`.
//   - `save()` deriva el `sync_id` del CONTENIDO: dos corridas con el mismo texto producen
//     el mismo id y el servidor hace upsert sobre la fila de la corrida anterior, que vive
//     en otro `project_key`. Por eso el texto lleva la marca de la corrida.
//   - Los device id tienen que ser ÚNICOS por corrida, o los receipts viejos contestan por
//     los nuevos (misma trampa que `smoke-sync-daemon.mjs` y `prueba-de-carga.mjs`).
//   - Una fila que llega por el pull tiene `topic_key = null` y el HMAC en su lugar: de un
//     HMAC no se vuelve al tema. Filtrar por `topicKey` del lado del receptor da 0 siempre,
//     y parece un supersede roto cuando es el diseño.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
const execFileAsync = promisify(execFile)
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

/** La version que NO bloquea el event loop — la unica que se puede usar dentro de un sondeo,
 *  porque el push del daemon sale de un `setTimeout` que no corre si el loop esta ocupado. */
async function sqlAsync(q) {
  const { stdout } = PG_DOCKER
    ? await execFileAsync('docker', ['exec', '-i', PG_DOCKER, 'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c', q])
    : await execFileAsync('psql', [PG, '-t', '-A', '-c', q])
  return stdout.trim()
}

/** Sondea una condicion asincronica sin bloquear. */
async function hastaAsync(cond, ms = 30_000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) { if (await cond()) return true; await espera(600) }
  return cond()
}

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
  const llego = await hastaAsync(async () =>
    Number(await sqlAsync(`select count(*) from observations o join projects p on p.id=o.project_id
                            where p.project_key='${marca}'`)) > 0)
  ok(llego, 'la fila llega al servidor')

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
  await hasta(() => B.store.count() > 0, 30_000)
  ok(B.store.count() > 0, 'B baja las memorias', `${B.store.count()}`)
  const leida = B.store.context(marca, 10)[0]
  ok(Boolean(leida?.title?.includes('rosebud')), 'y las lee EN CLARO', leida?.title ?? '(nada)')
  // El contador es de TODA la cuenta, no de esta corrida: B pullea todo lo que hay, y una
  // cuenta reusada entre pruebas tiene filas de maestras viejas que esta B no puede abrir.
  // Lo que importa —y lo verifica el assert de arriba— es que lo de ESTA corrida se lee.
  console.log(`       (ilegibles de toda la cuenta tras autorizar: ${B.store.undecryptableCount()})`)

  // ── 5. B escribe el mismo topico: supersede, no duplica ───────────────────
  console.log('\n5. B escribe el mismo topico y supersede en vez de duplicar')
  B.store.save({
    projectKey: marca, type: 'decision', source: 'mcp',
    title: `Corregido: el plan sube 25% (${marca})`, content: `Se reviso el numero. (${marca})`,
    topicKey: 'precios', tags: ['secreto'],
  })
  B.daemon.scheduleMutationPush()
  // Por condicion contra el servidor, no por reloj: el push sale de un debounce y esperar
  // "unos segundos" hacia que el paso 5 auditara antes de que la fila existiera.
  await hastaAsync(async () =>
    Number(await sqlAsync(`select count(*) from observations o join projects p on p.id=o.project_id
                            where p.project_key='${marca}'`)) >= 2)
  A.daemon.onNetworkRegain()
  await hasta(() => A.store.context(marca, 20).some((m) => m.title.includes('Corregido')), 30_000)
  // Se cuenta por TITULO y no por `topicKey`, y no es un atajo: una fila que llega por el
  // pull tiene `topic_key = null` y el HMAC en su lugar, porque de un HMAC no se vuelve al
  // tema. Es la limitacion conocida del camino B —el tema en claro solo existe en la maquina
  // que lo escribio— y filtrar por `topicKey` acá daria 0 siempre, culpando al supersede de
  // algo que es el diseño.
  const delTema = A.store.context(marca, 20).filter((m) => m.title.includes(marca))
  ok(delTema.length === 1, 'A queda con UNA sola activa para ese tema', `${delTema.length}`)
  ok(delTema[0]?.title.includes('Corregido'), 'y es la nueva', delTema[0]?.title ?? '')

  A.daemon.stop(); B.daemon.stop(); A.store.close(); B.store.close()
  console.log(fallos === 0 ? '\nTODO OK\n' : `\n${fallos} FALLARON\n`)
  process.exitCode = fallos === 0 ? 0 : 1
} catch (err) {
  console.error('\nel smoke reviento:', err)
  process.exitCode = 1
} finally {
  try { rmSync(home, { recursive: true, force: true }) } catch { /* ya no esta */ }
}
