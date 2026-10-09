// La «otra máquina» de una prueba manual del paquete portátil: lo que haría un Nest abierto en
// otra PC de la misma cuenta, con la MISMA librería de cliente que usa la app. Sirve para
// probar el paquete en una plataforma real (Linux en WSL, una Mac) sin tener dos Nest.
//
//   npx tsx scripts/otra-maquina-de-prueba.mjs <base> <token-file> <device-id> activar <estado.json>
//   npx tsx scripts/otra-maquina-de-prueba.mjs <base> <token-file> <device-id> autorizar <estado.json> <device-a-autorizar>
//   npx tsx scripts/otra-maquina-de-prueba.mjs <base> <token-file> <device-id> leer <estado.json> <texto-a-buscar>
//
// `estado.json` guarda la maestra en claro: es material de PRUEBA, en un tmpdir, contra un
// servicio local. Nunca contra una cuenta real. Binding de Node (`npm run native:node`).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../electron/memory-store.ts'
import { MemoryDaemon } from '../electron/memory-daemon.ts'
import { usarAbridorPorDefecto } from '../electron/sqlite-motor.ts'
import { abrirConBetterSqlite3 } from '../electron/sqlite-better.ts'
import { deriveKeys, hmacTopicKey } from '../electron/memory-crypto.ts'
import { generateDeviceKeyPair, huellaDeClave } from '../electron/memory-key-wrap.ts'
import { activateEncryption, authorizeDevice, fetchKeyState } from '../electron/memory-keys-client.ts'

const [base, tokenFile, deviceId, accion, estadoPath, arg] = process.argv.slice(2)
const deps = { baseUrl: base, token: readFileSync(tokenFile, 'utf8').trim(), deviceId, fetchImpl: fetch }

if (accion === 'activar') {
  const r = await activateEncryption(deps, generateDeviceKeyPair())
  writeFileSync(estadoPath, JSON.stringify({ master: r.master, keyEpoch: r.keyEpoch }))
  console.log(`cifrado activado: época ${r.keyEpoch}`)
} else if (accion === 'autorizar') {
  const { master } = JSON.parse(readFileSync(estadoPath, 'utf8'))
  const estado = await fetchKeyState(deps)
  const d = estado.devices.find((x) => x.deviceId === arg)
  if (!d?.publicKey) { console.log(`la máquina ${arg} no publicó su clave todavía`); process.exit(1) }
  console.log(`huella de la máquina a autorizar: ${huellaDeClave(d.publicKey)}`)
  await authorizeDevice(deps, master, estado.keyEpoch, { deviceId: arg, publicKey: d.publicKey })
  console.log('autorizada')
} else if (accion === 'leer') {
  usarAbridorPorDefecto(abrirConBetterSqlite3)
  const { master, keyEpoch } = JSON.parse(readFileSync(estadoPath, 'utf8'))
  const claves = deriveKeys(Buffer.from(master, 'base64'))
  const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'otra-maquina-')), 'memory.db'))
  store.setTopicHasher((p, s, t) => hmacTopicKey(claves, p, s, t))
  const daemon = new MemoryDaemon({
    store, fetchImpl: fetch, getSyncBaseUrl: () => base, getToken: () => deps.token, getDeviceId: () => deviceId,
    isOnline: () => true, getEnvelopeContext: () => ({ keys: claves, keyEpoch }),
  })
  await daemon.status()
  await daemon.pull()
  await new Promise((r) => setTimeout(r, 1500))
  const hits = store.listProjects().flatMap((p) => store.search(p.projectKey, arg, 10))
  console.log(`la otra máquina baja y encuentra «${arg}»: ${hits.length}`)
  for (const h of hits) console.log(`  · ${h.title}`)
  console.log(`ilegibles: ${store.undecryptableCount()}`)
  daemon.stop()
} else {
  console.log('acción: activar | autorizar | leer'); process.exit(2)
}
