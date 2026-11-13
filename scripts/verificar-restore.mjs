// Restaurar un backup de verdad. Es el punto 4 de la lista "qué tiene que ser verdad para
// abrir a usuarios" (`2026-08-31-memory-sync-backend-design.md` §12), y la propia spec lo
// dice sin vueltas: **un backup que nunca se restauró no es un backup**.
//
// Ahora hay una razón nueva para probarlo: desde el cifrado, el dump es texto cifrado. Un
// restore que devuelve filas cuya envoltura ya no abre es indistinguible, mirando la base,
// de uno que funcionó — así que la verificación tiene que incluir DESCIFRAR lo restaurado.
//
// Uso:
//   npx tsx scripts/verificar-restore.mjs --pg-docker nest-carga --db nest_memory
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateMasterKey, deriveKeys, encryptField, decryptField, fieldAad } from '../electron/memory-crypto.ts'

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1] }
const CT = arg('pg-docker', 'nest-carga')
const DB = arg('db', 'nest_memory')

let fallos = 0
const ok = (c, t, d = '') => { console.log(`  ${c ? 'OK  ' : 'FALLA'} ${t}${d ? ' — ' + d : ''}`); if (!c) fallos++ }
const psql = (q, db = DB) =>
  execFileSync('docker', ['exec', '-i', CT, 'psql', '-U', 'postgres', '-d', db, '-t', '-A', '-c', q], { encoding: 'utf8' }).trim()

const tmp = mkdtempSync(join(tmpdir(), 'nest-restore-'))
const TABLAS = ['users', 'devices', 'projects', 'observations', 'push_receipts', 'allowlist']

try {
  console.log('\nrestaurar un backup de verdad\n')

  // ── 1. Sembrar una fila CIFRADA, como la que hay en producción ────────────
  console.log('1. hay datos cifrados en la base')
  const master = generateMasterKey()
  const keys = deriveKeys(master)
  const syncId = `obs-restore-${Date.now()}`
  const secreto = 'el numero real de la ronda es 2.4M'
  const sobre = encryptField(keys, secreto, fieldAad(syncId, 'content'))

  const uid = '77777777-7777-7777-7777-777777777777'
  psql(`insert into users (id, plan) values ('${uid}','pro') on conflict do nothing;
        insert into projects (user_id, project_key, display_name)
             values ('${uid}','restore-test','restore') on conflict do nothing;`)
  const pid = psql(`select id from projects where user_id='${uid}' and project_key='restore-test'`)
  psql(`insert into observations
          (sync_id, project_id, project_seq, scope, type, title, content, tags, author_id,
           lamport, client_updated_at, client_created_at, server_created_at)
        values ('${syncId}', ${pid}, 9901, 'personal', 'decision', 'titulo', '${sobre}', '[]'::jsonb,
                '${uid}', 1, now(), now(), now())
        on conflict (sync_id) do update set content = excluded.content`)
  const antes = Object.fromEntries(TABLAS.map((t) => [t, Number(psql(`select count(*) from ${t}`))]))
  ok(antes.observations > 0, 'la base tiene observaciones', `${antes.observations}`)

  // ── 2. Dump ───────────────────────────────────────────────────────────────
  console.log('\n2. el dump sale y pesa algo')
  const dump = execFileSync('docker', ['exec', '-i', CT, 'pg_dump', '-U', 'postgres', '-d', DB, '-Fc'], {
    encoding: 'buffer', maxBuffer: 512 * 1024 * 1024,
  })
  const ruta = join(tmp, 'backup.dump')
  writeFileSync(ruta, dump)
  ok(dump.length > 1000, 'el dump tiene contenido', `${(dump.length / 1024).toFixed(0)} KB`)

  // ── 3. Restaurar en una base VACÍA, no encima de la original ──────────────
  console.log('\n3. se restaura en una base limpia')
  // Una base nueva: restaurar encima de la original no prueba nada — probaría que los datos
  // que ya estaban siguen estando.
  psql('drop database if exists restaurada', 'postgres')
  psql('create database restaurada', 'postgres')
  execFileSync('docker', ['exec', '-i', CT, 'pg_restore', '-U', 'postgres', '-d', 'restaurada', '--no-owner'], {
    input: dump, encoding: 'buffer', maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
  })
  const despues = Object.fromEntries(TABLAS.map((t) => [t, Number(psql(`select count(*) from ${t}`, 'restaurada'))]))
  for (const t of TABLAS) {
    ok(antes[t] === despues[t], `${t}: mismo conteo`, `${antes[t]} -> ${despues[t]}`)
  }

  // ── 4. Lo restaurado TODAVÍA SE PUEDE DESCIFRAR ───────────────────────────
  // La verificación que el cifrado agrega y que ninguna otra cubre: un restore que devuelve
  // ciphertext corrupto se ve igual que uno bueno si sólo se cuentan filas.
  console.log('\n4. lo restaurado se puede descifrar')
  const recuperado = psql(`select content from observations where sync_id='${syncId}'`, 'restaurada')
  ok(recuperado.startsWith('nmc1:'), 'la fila vuelve cifrada, no en claro')
  let abierto = null
  try { abierto = decryptField(keys, recuperado, fieldAad(syncId, 'content')) } catch { /* no abrio */ }
  ok(abierto === secreto, 'y la envoltura TODAVIA abre con la clave original', abierto ?? '(no abrio)')

  psql('drop database if exists restaurada', 'postgres')
  console.log(fallos === 0 ? '\nTODO OK — el backup es un backup\n' : `\n${fallos} FALLARON\n`)
  process.exitCode = fallos === 0 ? 0 : 1
} catch (err) {
  console.error('\nreviento:', err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ya no esta */ }
}
