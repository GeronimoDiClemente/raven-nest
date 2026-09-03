import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import {
  backupKey, countRows, runBackup, hadRecentSuccess, backupDepsFromEnv, type BackupDeps,
} from '../src/backup'

const pool = getPool()

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })

// Cada test arranca de cero para poder afirmar sobre "el último backup" — pero SOLO sobre las
// filas de este archivo. vitest corre los archivos de test en paralelo, y `backups-schema`
// escribe su propia fila en esta misma tabla: un `delete from backups` pelado, o un "la última
// fila" sin filtrar, hacen que un archivo vea las filas del otro y el test se vuelva escamoso.
const MIAS = `object_key like 'nest-memory/%'`
async function limpiarBackups() { await pool.query(`delete from backups where ${MIAS}`) }
const ultimaMia = () => pool.query(`select * from backups where ${MIAS} order by id desc limit 1`)

const deps = (over: Partial<BackupDeps> = {}): BackupDeps => ({
  dump: async () => new Uint8Array([1, 2, 3, 4]),
  upload: async () => {},
  now: () => new Date('2026-09-03T04:05:06.007Z'),
  ...over,
})

describe('backupKey', () => {
  // Los dos puntos del ISO son legales en S3 pero un dolor de cabeza en cualquier shell y en
  // cualquier nombre de archivo de Windows al bajarlo. El prefijo y el orden lexicográfico
  // son lo que hace que "la última clave" sea "la más nueva".
  it('nombra con el timestamp adelante y sin dos puntos', () => {
    expect(backupKey(new Date('2026-09-03T04:05:06.007Z')))
      .toBe('nest-memory/2026-09-03T04-05-06-007Z.dump')
  })

  it('ordena cronologicamente al ordenar como texto', () => {
    const viejo = backupKey(new Date('2026-09-01T23:00:00.000Z'))
    const nuevo = backupKey(new Date('2026-09-03T04:05:06.007Z'))
    expect([nuevo, viejo].sort()).toEqual([viejo, nuevo])
  })
})

describe('countRows', () => {
  it('cuenta las tablas de datos del servicio', async () => {
    const counts = await countRows(pool)
    for (const t of ['users', 'devices', 'projects', 'observations', 'push_receipts', 'allowlist']) {
      expect(typeof counts[t], `falta ${t}`).toBe('number')
    }
    // `backups` no se cuenta: la escribe el propio backup y el número cambiaría entre que se
    // mide y que se dumpea, haciendo fallar toda restauración verificada para siempre.
    expect(counts.backups).toBeUndefined()
  })
})

describe('runBackup', () => {
  it('deja una fila ok con los bytes, el sha256 y los conteos', async () => {
    await limpiarBackups()
    const res = await runBackup(pool, deps())

    expect(res.key).toBe('nest-memory/2026-09-03T04-05-06-007Z.dump')
    expect(res.bytes).toBe(4)
    expect(res.sha256).toBe(createHash('sha256').update(Buffer.from([1, 2, 3, 4])).digest('hex'))

    const { rows } = await pool.query('select * from backups where id = $1', [res.id])
    expect(rows[0].ok).toBe(true)
    expect(rows[0].finished_at).toBeInstanceOf(Date)
    expect(Number(rows[0].bytes)).toBe(4)
    expect(rows[0].sha256).toBe(res.sha256)
    expect(rows[0].error).toBeNull()
    expect(typeof rows[0].row_counts.observations).toBe('number')
  })

  it('sube exactamente los bytes del dump, con la clave de la fila', async () => {
    await limpiarBackups()
    const subido: Array<{ key: string; body: Uint8Array }> = []
    const res = await runBackup(pool, deps({
      upload: async (key, body) => { subido.push({ key, body }) },
    }))
    expect(subido).toHaveLength(1)
    expect(subido[0].key).toBe(res.key)
    expect(Array.from(subido[0].body)).toEqual([1, 2, 3, 4])
  })

  // Lo central de la tabla: el intento fallido tiene que quedar VISIBLE. Que además re-tire es
  // lo que le permite a index.ts loguearlo y a un operador correrlo a mano y enterarse.
  it('cuando la subida falla deja la fila en ok=false con el error, y re-tira', async () => {
    await limpiarBackups()
    await expect(runBackup(pool, deps({
      upload: async () => { throw new Error('AccessDenied del bucket') },
    }))).rejects.toThrow(/AccessDenied/)

    const { rows } = await ultimaMia()
    expect(rows[0].ok).toBe(false)
    expect(rows[0].error).toMatch(/AccessDenied/)
    expect(rows[0].finished_at).toBeInstanceOf(Date)
  })

  it('cuando el dump falla tambien deja rastro', async () => {
    await limpiarBackups()
    await expect(runBackup(pool, deps({
      dump: async () => { throw new Error('pg_dump salió con código 1') },
    }))).rejects.toThrow(/pg_dump/)

    const { rows } = await ultimaMia()
    expect(rows[0].ok).toBe(false)
    expect(rows[0].error).toMatch(/pg_dump/)
    expect(rows[0].bytes).toBeNull()
  })

  // Un dump vacío que se sube sin quejarse es el peor backup posible: parece que está.
  it('rechaza un dump vacio antes de subirlo', async () => {
    await limpiarBackups()
    let subio = false
    await expect(runBackup(pool, deps({
      dump: async () => new Uint8Array(0),
      upload: async () => { subio = true },
    }))).rejects.toThrow(/vacío/i)
    expect(subio).toBe(false)
  })
})

describe('hadRecentSuccess', () => {
  it('es false sin backups', async () => {
    await limpiarBackups()
    expect(await hadRecentSuccess(pool, 20)).toBe(false)
  })

  it('es true despues de uno bueno', async () => {
    await limpiarBackups()
    await runBackup(pool, deps())
    expect(await hadRecentSuccess(pool, 20)).toBe(true)
  })

  // Un redeploy no debería saltear el backup del día por un intento que FALLÓ.
  it('un intento fallido no cuenta', async () => {
    await limpiarBackups()
    await expect(runBackup(pool, deps({ upload: async () => { throw new Error('x') } }))).rejects.toThrow()
    expect(await hadRecentSuccess(pool, 20)).toBe(false)
  })

  it('uno viejo no cuenta', async () => {
    await limpiarBackups()
    const res = await runBackup(pool, deps())
    await pool.query(`update backups set finished_at = now() - interval '30 hours' where id = $1`, [res.id])
    expect(await hadRecentSuccess(pool, 20)).toBe(false)
  })
})

describe('backupDepsFromEnv', () => {
  it('devuelve null sin configuracion de R2, en vez de romper', () => {
    expect(backupDepsFromEnv({ DATABASE_URL: 'postgres://u:p@h:5432/d' } as NodeJS.ProcessEnv)).toBeNull()
  })

  it('arma las deps cuando estan las cuatro variables', () => {
    expect(backupDepsFromEnv({
      DATABASE_URL: 'postgres://u:p@h:5432/d',
      R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd',
    } as NodeJS.ProcessEnv)).not.toBeNull()
  })
})
