// Corre `pruebas/index.js` adentro del VS Code instalado en esta máquina.
//
// **No usa `@vscode/test-electron`** —que descargaría un VS Code entero— porque el CLI del
// editor ya sabe hacer esto: `--extensionDevelopmentPath` carga la extensión desde el
// directorio y `--extensionTestsPath` le dice qué módulo correr adentro del host.
//
// **Corre con el HOME de verdad, y eso es una decisión, no una omisión.** El primer intento
// redirigía `HOME` a un directorio temporal para no tocar nada del usuario, y en macOS eso
// hace que el sistema no encuentre el llavero de login: VS Code, que guarda ahí su "Code
// Key", abre un **modal que espera un clic** — la prueba dejaba de ser automática y encima le
// tapaba la pantalla a quien estuviera trabajando. `--password-store=basic` no lo arregla:
// ese flag de Electron sólo tiene efecto en Linux; en macOS el llavero es el único almacén.
//
// El aislamiento se consigue de otra forma, y es más honesta: la única cosa del usuario que
// esto escribe es el `mcp.json` de VS Code —lo escribe la extensión al activarse, que es su
// trabajo— así que el script lo respalda antes y lo restaura después. El perfil (ajustes,
// extensiones, ventanas) queda aparte con `--user-data-dir`.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, rmSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

// **El binario de adentro del .app, no el `code` del PATH.** Ese `code` es un script que
// lanza el editor en segundo plano y vuelve con 0 enseguida: la prueba parecía pasar sin
// haber corrido nada. El ejecutable sí se queda hasta que los tests terminan, y sale con el
// código de ellos.
const CODE = process.env.VSCODE_BIN ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code'

if (!existsSync(CODE)) {
  console.error(`No encontré VS Code en ${CODE}. Se puede pasar con VSCODE_BIN=.`)
  process.exit(1)
}
if (!existsSync(join(RAIZ, 'dist', 'extension.js'))) {
  console.error('No hay dist/. Corré `npm run build` en este paquete primero.')
  process.exit(1)
}

const MCP = join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
const caja = mkdtempSync(join(tmpdir(), 'nest-memory-vscode-'))
const respaldo = join(caja, 'mcp.json.respaldo')
const habia = existsSync(MCP)
if (habia) copyFileSync(MCP, respaldo)
mkdirSync(dirname(MCP), { recursive: true })

/** Deja el `mcp.json` del usuario exactamente como estaba. */
function restaurar() {
  try {
    if (habia) copyFileSync(respaldo, MCP)
    else if (existsSync(MCP)) unlinkSync(MCP)
  } catch (err) {
    console.error(`[probar] NO pude restaurar ${MCP}: ${err.message}`)
    console.error(`[probar] la copia está en ${respaldo} — no borro la caja`)
    return false
  }
  return true
}

let estado = 1
try {
  const r = spawnSync(CODE, [
    `--extensionDevelopmentPath=${RAIZ}`,
    `--extensionTestsPath=${join(RAIZ, 'pruebas', 'index.js')}`,
    `--user-data-dir=${join(caja, 'user-data')}`,
    '--disable-extensions',
    '--disable-gpu',
    '--skip-release-notes',
    '--skip-welcome',
  ], {
    stdio: 'inherit',
    // Nest le inyecta estas dos a sus terminales. Con ellas puestas la extensión creería que
    // hay un daemon al que hablarle y no abriría ninguna base, que es justo el camino que
    // esta prueba quiere ejercitar.
    env: { ...process.env, NEST_MEMORY_SOCKET: '', NEST_MEMORY_TOKEN: '' },
  })
  estado = r.status ?? 1
} finally {
  const limpio = restaurar()
  if (limpio && !process.env.NEST_MEMORY_DEJAR_LA_CAJA) rmSync(caja, { recursive: true, force: true })
  else console.log(`[probar] caja en ${caja}`)
}

process.exit(estado)
