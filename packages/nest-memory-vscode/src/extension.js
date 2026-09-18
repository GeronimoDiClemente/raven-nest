// El ÚNICO archivo que importa `vscode`, y por eso el único que no se puede probar sin abrir
// un editor. Todo lo que decide algo vive en `extension-vscode.ts` y `extension-arranque.ts`,
// que se testean sin VS Code de por medio.
//
// Acá sólo se traduce la API del editor a la interfaz chica que espera `activar`.
const vscode = require('vscode')
const { activar } = require('./extension-vscode')
const { depsDeExtension } = require('./extension-arranque')

/** Cursor es un fork de VS Code: mismo `require('vscode')`, otra carpeta de configuración. */
function editorQueHospeda() {
  const app = (vscode.env.appName || '').toLowerCase()
  return app.includes('cursor') ? 'cursor' : 'vscode'
}

function adaptar() {
  return {
    registrarComando: (id, fn) => vscode.commands.registerCommand(id, fn),
    mostrarMensaje: (texto) => { vscode.window.showInformationMessage(texto) },
    mostrarPanel: (titulo) => {
      const panel = vscode.window.createWebviewPanel(
        'nestMemory', titulo, vscode.ViewColumn.Beside,
        // Sin scripts: el panel sólo muestra texto, y parte de ese texto lo escribe el
        // servicio. Ver `htmlDelPanel`.
        { enableScripts: false },
      )
      return { set html(v) { panel.webview.html = v } }
    },
    copiarAlPortapapeles: (texto) => vscode.env.clipboard.writeText(texto),
  }
}

function activate(context) {
  const registros = activar(adaptar(), depsDeExtension(editorQueHospeda()))
  context.subscriptions.push(...registros)
}

module.exports = { activate, deactivate() {} }
