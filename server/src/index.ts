import { getPool, migrate } from './db'
import { createApp } from './http'
import { purgeTombstones } from './purge'

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

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void pool.end().then(() => process.exit(0))
  })
}
