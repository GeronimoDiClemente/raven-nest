import { Pool } from 'pg'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

// One arbitrary but stable key. Two instances booting at once must not both run the
// migrations: without the lock they race on CREATE TABLE and one of them dies on a
// duplicate-object error at startup, which reads as a crash loop rather than a race.
const MIGRATION_LOCK_KEY = 8127346512

// Memoized: HTTP handlers call getPool() per request, and pg.Pool already pools
// connections internally, so handing out a fresh Pool per call would open a fresh set of
// connections per request instead of reusing one, exhausting Postgres under load.
let pool: Pool | undefined

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? 'postgres://postgres:nestmem@127.0.0.1:55432/nest_memory',
      max: Number(process.env.PG_POOL_MAX ?? 10),
    })
  }
  return pool
}

/** Applies every unapplied migration inside one advisory lock. Returns how many ran. */
export async function migrate(pool: Pool): Promise<number> {
  /**
   * Camino rápido SIN el lock, para el caso abrumadoramente común: no hay nada que aplicar.
   *
   * El lock existe para que dos instancias arrancando a la vez no corran las migraciones en
   * paralelo, y para eso hay que tomarlo sólo cuando de verdad se va a escribir. Tomarlo
   * siempre convierte a `migrate()` en un punto de serialización global: el suite de tests
   * son 40 archivos que lo llaman en su `beforeAll`, todos hacen cola en la misma llave, y
   * los que no entran en los 10s del hook quedan reportados como "skipped" — un suite que
   * falla en masa, en tests que no tienen relación entre sí y que pasan cuando los corrés
   * solos. Pasó dos veces el 2026-09-13 y las dos mandó a buscar el problema al lugar
   * equivocado.
   *
   * Es seguro: si dos procesos leen a la vez que falta una migración, los dos siguen al
   * camino con lock, que vuelve a leer `schema_migrations` ADENTRO del lock y decide de nuevo.
   * Lo único que este atajo puede hacer mal es no tomar el lock cuando no hacía falta.
   */
  try {
    const { rows } = await pool.query('select name from schema_migrations')
    const aplicadas = new Set(rows.map((r) => r.name as string))
    const archivos = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
    if (archivos.every((f) => aplicadas.has(f))) return 0
  } catch {
    // La tabla todavía no existe (base nueva): sigue por el camino de siempre.
  }

  const client = await pool.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    await client.query(
      `create table if not exists schema_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`
    )
    const { rows } = await client.query('select name from schema_migrations')
    const done = new Set(rows.map((r) => r.name))
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()

    let applied = 0
    for (const file of files) {
      if (done.has(file)) continue
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      // Each migration is its own transaction: a failure rolls that step back whole and
      // leaves schema_migrations untouched, so the next boot retries exactly it.
      await client.query('begin')
      try {
        await client.query(sql)
        await client.query('insert into schema_migrations (name) values ($1)', [file])
        await client.query('commit')
        applied++
      } catch (err) {
        await client.query('rollback')
        throw err
      }
    }
    return applied
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    client.release()
  }
}
