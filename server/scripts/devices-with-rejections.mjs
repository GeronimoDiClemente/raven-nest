#!/usr/bin/env node
// La consulta de §11.5: "qué devices tienen mutaciones rechazadas". Agrupa `rejected_pushes`
// por device, trae nombre/plataforma del device via JOIN, y para no inundar la salida con
// TODOS los motivos de cada device sólo muestra el del rechazo más reciente (el resto queda
// en la tabla por si hace falta mirarlo a mano con un `select` aparte).
//
// SE CORRE CON `npx tsx`, no con `node` pelado — mismo motivo que scripts/restore-check.mjs:
// es la convención del paquete, aunque este script en particular no importa nada de `src/`.
//
//   npx tsx scripts/devices-with-rejections.mjs             # top 20 devices más problemáticos
//   npx tsx scripts/devices-with-rejections.mjs --limit 50  # hasta 50
//
// De sólo lectura: nunca escribe en `rejected_pushes` ni en `devices`.
import pg from 'pg'

const args = process.argv.slice(2)
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }

// Mismo default que restore-check.mjs: el Postgres real levantado en Docker para dev/tests.
const DATABASE_URL = process.env.DATABASE_URL
  ?? 'postgres://postgres:nestmem@127.0.0.1:55432/nest_memory'

const limitArg = Number.parseInt(value('--limit') ?? '20', 10)
const LIMIT = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : 20

function fatal(msg) { console.error(`x ${msg}`); process.exit(1) }

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    // `distinct on` + `order by ... created_at desc` para quedarnos con el error del rechazo
    // MÁS RECIENTE de cada device (no todos): es la fila que gana el empate de ordenamiento
    // dentro de cada device_id. El conteo y el máximo van en una CTE aparte porque son
    // agregados sobre TODAS las filas del device, no sólo la última.
    const { rows } = await client.query(
      `with conteos as (
         select device_id, count(*)::bigint as rechazos, max(created_at) as ultimo
         from rejected_pushes
         group by device_id
       ),
       ultimo_error as (
         select distinct on (device_id) device_id, error
         from rejected_pushes
         order by device_id, created_at desc
       )
       select
         d.name as device,
         d.platform,
         c.rechazos,
         c.ultimo as ultimo_rechazo,
         u.error as motivo_mas_reciente
       from conteos c
       join devices d on d.id = c.device_id
       join ultimo_error u on u.device_id = c.device_id
       order by c.rechazos desc
       limit $1`,
      [LIMIT]
    )

    if (rows.length === 0) {
      console.log('sin rechazos registrados')
      return
    }

    console.table(rows)
  } finally {
    await client.end()
  }
}

await main().catch((err) => fatal(err.message))
