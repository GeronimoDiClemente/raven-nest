// El entry `dist-electron/memory-tui.js`: la TUI de memoria adentro de Nest.
//
// Lo corre un pane con el Electron de Nest en modo Node (`ELECTRON_RUN_AS_NODE=1`, ver
// comando-de-la-tui.ts). Ese Node es el 20 de Electron: no tiene `node:sqlite` ni puede hacer
// `require` de Ink, y el CLI del paquete no viaja en la app. Por eso este entry no abre ninguna
// base: sólo le habla al daemon de la Nest que abrió el pane, por las variables que
// PtyManager le inyecta. Un test de grafo de imports fija que de acá no se llega a
// `node:sqlite`, `better-sqlite3` ni `electron`.
import { decidirArranque, arrancarTui } from './tui-del-paquete/arrancar'
import { crearFuenteDelDaemon } from './tui-del-paquete/fuente-del-daemon'

async function principal(): Promise<number> {
  const socket = process.env.NEST_MEMORY_SOCKET
  const token = process.env.NEST_MEMORY_TOKEN
  if (!socket || !token) {
    process.stderr.write("Open this from Nest — the pane didn't get Nest's memory variables.\n")
    return 1
  }
  const decision = decidirArranque({
    stdinTTY: Boolean(process.stdin.isTTY),
    stdoutTTY: Boolean(process.stdout.isTTY),
    tieneSetRawMode: typeof process.stdin.setRawMode === 'function',
  })
  if (decision === 'ayuda') {
    process.stderr.write('The memory view needs an interactive terminal on both ends.\n')
    return 1
  }
  if (decision === 'sin-modo-crudo') {
    process.stderr.write("This terminal can't run the interactive view. Use `nestmux-memory search` or open Nest.\n")
    return 1
  }
  await arrancarTui(crearFuenteDelDaemon(socket, token, process.cwd()))
  return 0
}

// `process.exit` y no `exitCode`: el socket del daemon o el stdin en modo crudo pueden dejar
// el loop vivo, y el pane tiene que volver a su shell al salir con `q`.
principal().then(
  (codigo) => process.exit(codigo),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  },
)
