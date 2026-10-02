// Calla UN aviso de Node: el `ExperimentalWarning` de `node:sqlite`.
//
// Sale en stderr cada vez que el paquete portátil arranca —o sea en cada comando, y en el log
// de MCP de cada editor que lanza el servidor— y no le dice nada accionable al usuario: que
// el motor sea experimental ya lo decidió el spec (§4, P-R4) y está detrás de un adaptador.
// Con siete comandos y siete editores, era el primer renglón de todo lo que imprimíamos.
//
// Tiene que importarse ANTES que `sqlite-sin-compilar`: el aviso se emite al cargar
// `node:sqlite`, no al usarlo. Por eso es el primer import de cli-del-paquete.ts.
//
// Sólo ése. Cualquier otro aviso pasa igual que antes, por los mismos listeners de Node.
const originales = process.listeners('warning')
process.removeAllListeners('warning')
process.on('warning', (aviso) => {
  if (aviso.name === 'ExperimentalWarning' && /SQLite/i.test(aviso.message)) return
  for (const escuchar of originales) escuchar(aviso)
})

export {}
