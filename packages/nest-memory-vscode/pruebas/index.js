// La extensión adentro de un VS Code de VERDAD.
//
// Es lo único que no se podía probar de otra forma, y lo dijo el propio spec: todo lo que
// decide algo vive en `extension-vscode.ts` y `panel-de-la-extension.ts`, que se testean sin
// editor, pero que el panel SE DIBUJE —y que leer el estado real no explote adentro del
// runtime del editor— sólo lo contesta el editor.
//
// Corre con el `code` instalado, sin descargar nada y sin `@vscode/test-electron`:
//
//   code --extensionDevelopmentPath=<paquete> --extensionTestsPath=<paquete>/pruebas/index.js \
//        --user-data-dir=<temporal> --disable-extensions
//
// VS Code carga este módulo ADENTRO del host de extensiones, así que acá `require('vscode')`
// existe. Si `run()` rechaza, el proceso sale distinto de cero. Ver `scripts/probar-en-vscode.mjs`.
const assert = require('node:assert')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const os = require('node:os')
const vscode = require('vscode')

const ID = 'nest.nest-memory'

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** El tab del panel, buscado por su etiqueta en todos los grupos. */
function tabDelPanel() {
  for (const grupo of vscode.window.tabGroups.all) {
    for (const tab of grupo.tabs) if (tab.label === 'Nest Memory') return tab
  }
  return null
}

async function run() {
  const ext = vscode.extensions.getExtension(ID)
  assert.ok(ext, `la extensión ${ID} no la cargó el editor`)

  // Activar es el primer test: `activate` corre `configurar()`, que escribe en disco. Si eso
  // tira, el editor muestra un error rojo en cada arranque.
  await ext.activate()
  assert.equal(ext.isActive, true, 'la extensión no quedó activa')

  const comandos = await vscode.commands.getCommands(true)
  for (const id of ['nest-memory.status', 'nest-memory.setup']) {
    assert.ok(comandos.includes(id), `el comando ${id} no quedó registrado`)
  }

  // Al activarse configura el editor que la hospeda. Con el HOME apuntando a un directorio
  // de prueba, lo que tiene que aparecer es el mcp.json de VS Code — y bajo `servers`, que
  // es la clave que VS Code usa y los otros seis no.
  const mcp = join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
  assert.ok(existsSync(mcp), `setup no escribió ${mcp}`)
  const config = JSON.parse(readFileSync(mcp, 'utf8'))
  assert.ok(config.servers && config.servers.nest_memory, 'la entrada no quedó bajo `servers`')
  assert.equal(config.servers.nest_memory.command, 'npx')

  // Y el panel. Esto es lo que ninguna prueba de acá abajo podía contestar: que `mostrarPanel`
  // hable bien con `createWebviewPanel`, y que leer el estado real —que abre la base con
  // `node:sqlite`, que el runtime del editor puede no tener— no tire adentro del comando.
  assert.equal(tabDelPanel(), null, 'ya había un panel abierto antes de pedirlo')
  await vscode.commands.executeCommand('nest-memory.status')
  // El tab aparece en el próximo turno del event loop del editor.
  for (let i = 0; i < 40 && !tabDelPanel(); i++) await esperar(50)
  const tab = tabDelPanel()
  assert.ok(tab, 'el comando corrió pero no quedó ningún panel abierto')
  assert.ok(tab.input instanceof vscode.TabInputWebview, 'el panel no es un webview')

  console.log('[pruebas] la extensión activa, configura y dibuja el panel en un VS Code real')
}

module.exports = { run }
