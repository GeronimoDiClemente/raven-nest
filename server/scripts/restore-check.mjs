#!/usr/bin/env node
// La restauración probada de §11.3. Baja (o lee) un dump, lo restaura en una base LIMPIA y
// verifica que lo que quedó adentro es lo que había cuando se tomó.
//
// SE CORRE CON `npx tsx`, no con `node` pelado: importa módulos TypeScript de `src/`, y Node
// 22 no despoja tipos por su cuenta. `tsx` ya es dependencia del paquete y es con lo que
// arranca el propio servicio.
//
//   npx tsx scripts/restore-check.mjs --file tmp/x.dump   # un dump local, sin R2
//   npx tsx scripts/restore-check.mjs --from-r2           # el último dump real
//   npx tsx scripts/restore-check.mjs --from-r2 --keep    # deja la base restaurada
//
// Es re-corrible: la base de verificación se crea con un nombre único y se borra al final.
// NUNCA toca la base de origen — sólo la lee para buscar los conteos del dump.
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import pg from 'pg'
import { r2ConfigFromEnv, listKeys, getObject } from '../src/r2.ts'
import { pgRestore } from '../src/pg-dump.ts'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }

// DOS URLs, no una. `DATABASE_URL` es la que usa el driver `pg`, que corre acá. La otra es la
// que ve `pg_restore`, que puede estar corriendo en OTRO lado: envuelto en `docker exec`, la
// base no es `127.0.0.1:55432` sino `127.0.0.1:5432`. En producción las dos son la misma.
const DATABASE_URL = process.env.DATABASE_URL
  ?? 'postgres://postgres:nestmem@127.0.0.1:55432/nest_memory'
const PG_BIN_DATABASE_URL = process.env.PG_BIN_DATABASE_URL ?? DATABASE_URL
const DATA_TABLES = ['users', 'devices', 'projects', 'observations', 'push_receipts', 'allowlist']

function fatal(msg) { console.error(`x ${msg}`); process.exit(1) }

/** El dump y, si se sabe, de qué clave salió. */
async function conseguirDump() {
  const file = value('--file')
  if (file) return { bytes: new Uint8Array(await readFile(file)), key: null, origen: file }

  if (!flag('--from-r2')) fatal('usá --file <path> o --from-r2')
  const cfg = r2ConfigFromEnv()
  if (!cfg) fatal('faltan las variables R2_* y pediste --from-r2')

  const keys = await listKeys(cfg, 'nest-memory/')
  if (keys.length === 0) fatal('el bucket no tiene ningún backup')
  const key = keys[keys.length - 1] // ordenadas: la última es la más nueva
  console.log(`· bajando ${key}`)
  return { bytes: await getObject(cfg, key), key, origen: `r2://${cfg.bucket}/${key}` }
}

/** La fila de `backups` de ESE dump, que trae los conteos del momento en que se tomó. */
async function filaDelBackup(key, sha256) {
  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    const { rows } = key
      ? await client.query('select * from backups where object_key = $1', [key])
      : await client.query('select * from backups where sha256 = $1 order by id desc limit 1', [sha256])
    return rows[0] ?? null
  } finally { await client.end() }
}

async function main() {
  const { bytes, key, origen } = await conseguirDump()
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  console.log(`· dump: ${origen} — ${bytes.length} bytes, sha256 ${sha256.slice(0, 12)}`)

  if (bytes.length === 0) fatal('el dump está vacío')
  if (Buffer.from(bytes.slice(0, 5)).toString() !== 'PGDMP') {
    fatal('el archivo no arranca con PGDMP: no es un dump en formato custom')
  }

  const fila = await filaDelBackup(key, sha256)
  if (fila?.sha256 && fila.sha256 !== sha256) {
    fatal(`el sha256 no coincide con el registrado: se corrompió en el camino\n  esperado ${fila.sha256}\n  bajado   ${sha256}`)
  }

  // Una base nueva por corrida, en el mismo servidor. Nunca se restaura sobre una existente.
  const nombre = `nest_memory_restorecheck_${Date.now()}`
  const admin = new pg.Client({ connectionString: DATABASE_URL, database: 'postgres' })
  await admin.connect()
  await admin.query(`create database ${nombre}`)
  console.log(`· base limpia: ${nombre}`)

  // La misma base nueva, vista desde los dos lados: el driver la abre por su URL, y
  // `pg_restore` por la suya. Con `docker exec` de por medio no son la misma cadena.
  const destinoDriver = new URL(DATABASE_URL)
  destinoDriver.pathname = `/${nombre}`
  const destinoBinario = new URL(PG_BIN_DATABASE_URL)
  destinoBinario.pathname = `/${nombre}`

  let fallo = null
  try {
    await pgRestore(destinoBinario.toString(), bytes)
    console.log('· restaurado')

    const verificador = new pg.Client({ connectionString: destinoDriver.toString() })
    await verificador.connect()
    try {
      const restaurados = {}
      for (const t of DATA_TABLES) {
        const { rows } = await verificador.query(`select count(*)::bigint as n from ${t}`)
        restaurados[t] = Number(rows[0].n)
      }

      const esperados = fila?.row_counts ?? null
      if (!esperados) {
        console.log('! sin conteos registrados para este dump: sólo se verifica que restaure y tenga las tablas')
        console.table(restaurados)
      } else {
        console.table(DATA_TABLES.map((t) => ({ tabla: t, esperado: esperados[t], restaurado: restaurados[t] })))
        const diffs = DATA_TABLES
          .filter((t) => restaurados[t] !== esperados[t])
          .map((t) => `  ${t}: esperado ${esperados[t]}, restaurado ${restaurados[t]}`)
        if (diffs.length > 0) throw new Error(`conteos que no coinciden:\n${diffs.join('\n')}`)
      }

      // El conteo dice cuántas filas hay; el checksum dice que son LAS MISMAS. Sin esto, un
      // dump que restaura la cantidad correcta de memorias vacías pasaría como bueno.
      const { rows: sum } = await verificador.query(
        `select coalesce(md5(string_agg(sync_id || ':' || coalesce(content, '') || ':' || lamport, '|'
           order by sync_id)), 'vacio') as h from observations`
      )
      console.log(`· checksum del contenido de observations: ${sum[0].h}`)
    } finally { await verificador.end() }
  } catch (err) {
    fallo = err
  } finally {
    if (flag('--keep')) console.log(`· base ${nombre} conservada (--keep)`)
    else { await admin.query(`drop database ${nombre}`); console.log(`· base ${nombre} borrada`) }
    await admin.end()
  }

  if (fallo) fatal(fallo.message)
  console.log('OK restauración verificada')
}

await main()
