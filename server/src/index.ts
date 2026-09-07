import { getPool, migrate } from './db'
import { createApp } from './http'
import { purgeTombstones } from './purge'
import { backupDepsFromEnv, runBackup, shouldRunBackup } from './backup'

const PORT = Number(process.env.PORT ?? 8080)

const pool = getPool()
// Top-level await: this module's evaluation does not proceed to `.listen()` until the
// migration settles. If it rejects, Node surfaces it as an unhandled rejection during
// module load and exits non-zero before the process ever binds a port — a service that
// fails to migrate must refuse to start, not accept traffic against an unmigrated schema.
await migrate(pool)

createApp(pool).listen(PORT, () => {
  console.log(`[sync] listening on ${PORT}`)
})

// Una vez por día, y una al arrancar. `unref()` para que un contenedor que se está apagando
// no se quede esperando el timer. El catch es obligatorio: una purga fallida es un problema
// de higiene, no una razón para tumbar un servicio que está sirviendo tráfico.
const PURGE_EVERY_MS = 24 * 60 * 60 * 1000
const runPurge = () =>
  purgeTombstones(pool)
    .then((n) => n > 0 && console.log(`[purge] ${n} tombstones borrados`))
    .catch((err) => console.error('[purge]', err))

void runPurge()
setInterval(runPurge, PURGE_EVERY_MS).unref()

// Un backup por día, y uno al arrancar si hace más de 20 horas del último bueno. Ese margen
// existe por los redeploys: Railway reinicia el contenedor en cada push, y sin la guarda una
// tarde de trabajo serían veinte dumps de la base entera.
//
// Mismo criterio que la purga para el catch: un backup fallido NO tumba un servicio que está
// sirviendo tráfico. La diferencia es que este además deja una fila en `backups`, así que el
// fallo se puede consultar después en vez de vivir sólo en un log que nadie mira.
const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000
const BACKUP_MIN_GAP_HOURS = 20
const backupDeps = backupDepsFromEnv()
if (!backupDeps) {
  console.warn('[backup] R2 no configurado (faltan R2_*): no se van a hacer backups')
}
const runBackupIfDue = async () => {
  try {
    if (!backupDeps) return
    if (!(await shouldRunBackup(pool, backupDeps, BACKUP_MIN_GAP_HOURS))) return
    const r = await runBackup(pool, backupDeps)
    console.log(`[backup] ${r.key} — ${r.bytes} bytes, sha256 ${r.sha256.slice(0, 12)}`)
  } catch (err) {
    console.error('[backup]', err)
  }
}

void runBackupIfDue()
setInterval(() => void runBackupIfDue(), BACKUP_EVERY_MS).unref()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void pool.end().then(() => process.exit(0))
  })
}
