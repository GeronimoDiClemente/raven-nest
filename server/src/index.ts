import { getPool, migrate } from './db'
import { createApp } from './http'

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

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void pool.end().then(() => process.exit(0))
  })
}
