// Fija `stagingPercentage` en los `latest*.yml` del auto-updater: qué porcentaje de las
// instalaciones recibe una versión publicada. Lo usa `.github/workflows/rollout.yml`.
//
// electron-updater lo lee del feed (`AppUpdater.isStagingMatch`): cada instalación tiene un id
// estable y se actualiza sólo si cae dentro del porcentaje. Con 0 no se actualiza nadie más:
// es el freno cuando una versión rompió. Con 100 (o sin la clave) llega a todos.
//
// Frena a quien todavía NO la bajó. Quien ya actualizó no vuelve atrás: electron-updater no
// hace downgrade. Ver docs/RUNBOOK-VERSION-ROTA.md.
//
// Uso: node scripts/staging-del-feed.mjs <0-100> latest.yml latest-mac.yml latest-linux.yml
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function conStaging(yaml, porcentaje) {
  if (!Number.isInteger(porcentaje) || porcentaje < 0 || porcentaje > 100) {
    throw new Error(`porcentaje inválido: ${porcentaje} (tiene que ser un entero de 0 a 100)`)
  }
  // Sólo la clave de primer nivel: una línea indentada con ese nombre no es la del feed.
  const sinLaVieja = yaml.split('\n').filter((l) => !/^stagingPercentage:/.test(l)).join('\n')
  const base = sinLaVieja.endsWith('\n') ? sinLaVieja : `${sinLaVieja}\n`
  return `${base}stagingPercentage: ${porcentaje}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [crudo, ...archivos] = process.argv.slice(2)
  const porcentaje = Number(crudo)
  if (archivos.length === 0) {
    console.error('uso: node scripts/staging-del-feed.mjs <0-100> <latest*.yml...>')
    process.exit(2)
  }
  for (const f of archivos) {
    writeFileSync(f, conStaging(readFileSync(f, 'utf8'), porcentaje))
    console.log(`${f}: stagingPercentage ${porcentaje}`)
  }
}
