import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import { pgDump } from './pg-dump'
import { putObject, r2ConfigFromEnv } from './r2'

/** §11.3. El prefijo agrupa; el timestamp adelante hace que ordenar como texto sea ordenar por fecha. */
const KEY_PREFIX = 'nest-memory/'

/**
 * Las tablas cuyo conteo se guarda con el dump para poder verificar la restauración.
 *
 * `schema_migrations` y `backups` quedan afuera a propósito. `backups` la escribe el propio
 * backup, así que su conteo cambia entre que se mide y que `pg_dump` toma su snapshot:
 * incluirla haría fallar TODA restauración verificada, para siempre, por un desajuste que no
 * es un error.
 */
const DATA_TABLES = ['users', 'devices', 'projects', 'observations', 'push_receipts', 'allowlist'] as const

export type BackupDeps = {
  dump: () => Promise<Uint8Array>
  upload: (key: string, body: Uint8Array) => Promise<void>
  now: () => Date
}

export type BackupResult = { id: number; key: string; bytes: number; sha256: string }

/** `2026-09-03T04-05-06-007Z` — el ISO con los dos puntos y el punto cambiados por guiones. */
export function backupKey(at: Date): string {
  return `${KEY_PREFIX}${at.toISOString().replace(/[:.]/g, '-')}.dump`
}

/** Cuántas filas tiene cada tabla de datos ahora mismo. */
export async function countRows(pool: Pool): Promise<Record<string, number>> {
  const sql = DATA_TABLES
    .map((t) => `select '${t}' as tabla, count(*)::bigint as n from ${t}`)
    .join(' union all ')
  const { rows } = await pool.query(sql)
  return Object.fromEntries(rows.map((r) => [r.tabla, Number(r.n)]))
}

/**
 * Un backup completo: contar, dumpear, subir, dejar rastro.
 *
 * La fila se inserta ANTES de empezar: un proceso que muere a la mitad deja un `ok=false` con
 * `finished_at` nulo, visible, en vez de no haber existido nunca.
 *
 * Re-tira siempre después de registrar el fallo. Quien llama decide qué hacer: `index.ts` lo
 * loguea y sigue —un backup fallido no tumba un servicio que está sirviendo tráfico— y un
 * operador que lo corre a mano se entera.
 */
export async function runBackup(pool: Pool, deps: BackupDeps): Promise<BackupResult> {
  const at = deps.now()
  const key = backupKey(at)
  const { rows } = await pool.query(
    'insert into backups (object_key) values ($1) returning id',
    [key]
  )
  const id: number = Number(rows[0].id)

  try {
    const counts = await countRows(pool)
    const body = await deps.dump()
    // Un dump de cero bytes subido sin chistar es el peor backup posible: ocupa el lugar del
    // bueno y parece que está. `pg_dump` de una base sana nunca devuelve vacío.
    if (body.length === 0) throw new Error('el dump vino vacío: no se sube')

    const sha256 = createHash('sha256').update(body).digest('hex')
    await deps.upload(key, body)

    await pool.query(
      `update backups set ok = true, finished_at = now(), bytes = $2, sha256 = $3, row_counts = $4
        where id = $1`,
      [id, body.length, sha256, JSON.stringify(counts)]
    )
    return { id, key, bytes: body.length, sha256 }
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err)
    // El registro del fallo no puede tapar el fallo original: si esto también rompe (la base
    // se cayó), se ignora y se re-tira el error de verdad.
    await pool
      .query('update backups set ok = false, finished_at = now(), error = $2 where id = $1', [id, mensaje])
      .catch(() => {})
    throw err
  }
}

/** Si ya hubo un backup bueno en las últimas `hours` horas. Evita dumpear en cada redeploy. */
export async function hadRecentSuccess(pool: Pool, hours: number): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1 from backups where ok = true and finished_at > now() - ($1 || ' hours')::interval limit 1`,
    [String(hours)]
  )
  return rows.length > 0
}

/**
 * Las dependencias reales, o `null` si R2 no está configurado.
 *
 * `null` y no una excepción: un deploy sin R2 —el de desarrollo, el de un cliente que todavía
 * no lo cargó— tiene que arrancar igual y decirlo en el log, no negarse a servir.
 */
export function backupDepsFromEnv(env: NodeJS.ProcessEnv = process.env): BackupDeps | null {
  const cfg = r2ConfigFromEnv(env)
  if (!cfg) return null
  // `PG_BIN_DATABASE_URL` es la URL que ven los BINARIOS de Postgres, que no siempre es la
  // misma que ve el driver `pg`. En producción son idénticas y esto no hace nada. En
  // desarrollo no: el driver corre en Windows y llega a la base por `127.0.0.1:55432`,
  // mientras que `pg_dump` corre adentro del contenedor por `docker exec` y desde ahí la
  // base es `127.0.0.1:5432`. Una sola variable no puede ser las dos cosas.
  const databaseUrl = env.PG_BIN_DATABASE_URL ?? env.DATABASE_URL
  if (!databaseUrl) return null
  return {
    dump: () => pgDump(databaseUrl, { env }),
    upload: (key, body) => putObject(cfg, key, body),
    now: () => new Date(),
  }
}
