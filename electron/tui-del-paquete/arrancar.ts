/**
 * El arranque de la TUI: la pantalla alternativa, Ink, y el ida y vuelta con $EDITOR.
 *
 * La terminal se deja SIEMPRE como estaba: al salir con `q`/Ctrl+C (los maneja el reducer,
 * por eso `exitOnCtrlC: false`), si Ink revienta, en `exit` y con SIGINT/SIGTERM de afuera.
 *
 * Para editar, Ink se desmonta, la terminal se suelta, el editor corre síncrono y se vuelve a
 * montar la App con el MISMO runner: el estado vive ahí, fuera de React, y el usuario vuelve a
 * donde estaba. Recién entonces se escribe por la fuente. Si la escritura falla, el texto se
 * conserva en un temporal y la barra ofrece Reopen/Discard.
 *
 * Este módulo arrastra React e Ink: el CLI lo carga con `import()` sólo para el caso `tui`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { App } from './app'
import { cargarInk, type Ink } from './ink'
import { crearRunner, type EfectoDeEditor } from './runner'
import {
  conservarEnTemporal, descartar, editarEnEditor, elegirEditor, reabrirEnEditor, type ResultadoDeEdicion,
} from './editor-externo'
import { plantillaDeNueva, serializarMemoria } from './frontmatter'
import type { FuenteDeLaTui } from './fuente'
import type { Accion } from './estado'

export { decidirArranque, type Decision } from './decidir-arranque'

const ENTRAR_A_LA_ALTERNATIVA = '\x1b[?1049h'
const SALIR_DE_LA_ALTERNATIVA = '\x1b[?1049l'
const MOSTRAR_CURSOR = '\x1b[?25h'

/** Sale de la pantalla alternativa, muestra el cursor y apaga el modo crudo si se puede. */
export function restaurarTerminal(stdout: NodeJS.WriteStream, stdin: NodeJS.ReadStream = process.stdin): void {
  stdout.write(SALIR_DE_LA_ALTERNATIVA + MOSTRAR_CURSOR)
  if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
    try { stdin.setRawMode(false) } catch { /* la terminal ya no está */ }
  }
}

export interface EntradaSalida {
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
  env: NodeJS.ProcessEnv
  plataforma: NodeJS.Platform
  /** Sólo para los tests: frames enteros (`debug`) y sin tocar la consola. */
  opcionesDeInk?: { debug?: boolean; patchConsole?: boolean }
  /** Sólo para los tests: dónde van los temporales (default, tmpdir). */
  dirTemporal?: string
}

type Instancia = ReturnType<Ink['render']>

const mensajeDe = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Los temporales tienen siempre un nombre al azar (`editor-externo.ts`): el syncId es un dato
// remoto y en un nombre de archivo sería un path traversal. Qué memoria va con cada uno lo
// lleva `pendientes`.

export async function arrancarTui(fuente: FuenteDeLaTui, io?: EntradaSalida): Promise<void> {
  const { stdin, stdout, env, plataforma, opcionesDeInk, dirTemporal } = io ?? {
    stdin: process.stdin, stdout: process.stdout, env: process.env, plataforma: process.platform,
  }
  const { render } = await cargarInk()
  const editor = elegirEditor(env, plataforma)

  /** Los temporales que esperan Reopen/Discard, con la memoria a la que van (null = nueva). */
  const pendientes = new Map<string, string | null>()
  let instancia: Instancia | null = null
  let enAlterna = false
  let terminar: (err?: unknown) => void = () => {}
  /** La edición en curso (editor + escritura). Una sola a la vez: el reducer ya lo cuida, esto es la segunda red. */
  let enCurso: Promise<Accion | null> | null = null
  /** La TUI terminó: lo que llegue tarde no vuelve a montar Ink ni deja temporales. */
  let cerrando = false

  const restaurar = () => {
    if (!enAlterna) return
    enAlterna = false
    restaurarTerminal(stdout, stdin)
  }

  const descartarPendientes = () => {
    for (const archivo of pendientes.keys()) descartar(archivo)
    pendientes.clear()
  }

  function montar(): void {
    stdout.write(ENTRAR_A_LA_ALTERNATIVA)
    enAlterna = true
    let esta: Instancia
    try {
      esta = render(
        createElement(App, { fuente, ancho: stdout.columns || 80, suspenderYEditar, runner }),
        { stdin, stdout, exitOnCtrlC: false, ...opcionesDeInk },
      )
    } catch (err) {
      // Al volver del editor nadie más se enteraría: sin esto la TUI queda muerta y colgada.
      terminar(err)
      return
    }
    instancia = esta
    // Ink terminó por su cuenta (la App pidió salir, o reventó): se termina todo. Si la
    // desmontamos nosotros para el editor, `instancia` ya no es ésta y no cuenta.
    esta.waitUntilExit().then(
      () => { if (instancia === esta) terminar() },
      (err) => { if (instancia === esta) terminar(err) },
    )
  }

  function suspender(): void {
    const vieja = instancia
    instancia = null
    vieja?.unmount()
    restaurar()
  }

  /** Suelta la terminal, corre el editor (síncrono) y la vuelve a tomar pase lo que pase. */
  function enPausa(f: () => ResultadoDeEdicion): ResultadoDeEdicion {
    suspender()
    try {
      return f()
    } finally {
      montar()
    }
  }

  /** Lo que el editor devolvió, ya con la terminal de vuelta: se escribe por la fuente. */
  async function resolver(r: ResultadoDeEdicion, syncId: string | null): Promise<Accion | null> {
    switch (r.tipo) {
      case 'sin-cambios':
        return { tipo: 'limpiar-aviso' }
      case 'fallo-el-editor':
        return { tipo: 'fallo', mensaje: r.error }
      case 'invalida':
        pendientes.set(r.archivo, syncId)
        return { tipo: 'error-de-editor', mensaje: r.error, archivo: r.archivo }
      case 'lista':
        try {
          if (syncId) await fuente.actualizar(syncId, r.memoria)
          else await fuente.guardar(r.memoria)
          return { tipo: 'escrito', syncId }
        } catch (err) {
          // Se salió con la escritura en vuelo: no queda quién ofrezca Reopen, y un temporal
          // ahora quedaría huérfano en tmpdir.
          if (cerrando) return null
          // Lo normal es un `ErrorDeEscritura` (candado, sólo lectura, cambió en otro lado),
          // pero el texto del usuario se conserva ante CUALQUIER fallo: perderlo no tiene arreglo.
          const archivo = conservarEnTemporal(serializarMemoria(r.memoria), dirTemporal)
          pendientes.set(archivo, syncId)
          return { tipo: 'error-de-editor', mensaje: mensajeDe(err), archivo }
        }
    }
  }

  function suspenderYEditar(ef: EfectoDeEditor): Promise<Accion | null> {
    if (enCurso || cerrando) return Promise.resolve(null)
    const esta = editar(ef).finally(() => { if (enCurso === esta) enCurso = null })
    enCurso = esta
    return esta
  }

  async function editar(ef: EfectoDeEditor): Promise<Accion | null> {
    if (ef.tipo === 'editar') {
      const { syncId } = ef
      let inicial = plantillaDeNueva()
      if (syncId) {
        // El texto entero: el `content` de la lista puede venir recortado.
        const d = await fuente.obtener(syncId)
        if (cerrando) return null // se salió mientras se leía: no se abre ningún editor
        if (!d) return { tipo: 'fallo', mensaje: 'This memory no longer exists' }
        const { title, type, tags, content } = d.item
        inicial = serializarMemoria({ title, type, tags, content })
      }
      return resolver(enPausa(() => editarEnEditor({ inicial, editor, dir: dirTemporal })), syncId)
    }

    // Reopen sobre el temporal que quedó de una edición inválida o de una escritura fallida.
    const { archivo } = ef
    const syncId = pendientes.get(archivo) ?? null
    pendientes.delete(archivo)
    let previo: string | null = null
    try { previo = readFileSync(archivo, 'utf8') } catch { /* ya no está */ }
    const r = enPausa(() => reabrirEnEditor(archivo, editor))
    if (r.tipo === 'fallo-el-editor' && !existsSync(archivo)) {
      // Sin el temporal no hay qué reabrir: se suelta el error, si no `r` abriría un archivo
      // vacío sin saber a qué memoria iba.
      if (previo === null) return { tipo: 'edicion-perdida', mensaje: r.error }
      // El editor no arrancó y `reabrirEnEditor` borró el temporal: el texto vuelve a quedar.
      const nuevo = conservarEnTemporal(previo, dirTemporal)
      pendientes.set(nuevo, syncId)
      return { tipo: 'error-de-editor', mensaje: r.error, archivo: nuevo }
    }
    return resolver(r, syncId)
  }

  const runner = crearRunner({ fuente, suspenderYEditar })

  // Discard (o un Reopen que terminó bien) saca el error de la barra: su temporal se borra.
  let archivoEnLaBarra: string | null = null
  const dejarDeMirar = runner.suscribir(() => {
    const ahora = runner.instantanea().estado.errorDeEditor?.archivo ?? null
    if (archivoEnLaBarra && archivoEnLaBarra !== ahora) {
      descartar(archivoEnLaBarra)
      pendientes.delete(archivoEnLaBarra)
    }
    archivoEnLaBarra = ahora
  })

  const alSalirDelProceso = () => { restaurar(); descartarPendientes() }
  const alInterrumpir = () => { alSalirDelProceso(); process.exit(130) }
  const alTerminar = () => { alSalirDelProceso(); process.exit(143) }
  process.on('exit', alSalirDelProceso)
  process.on('SIGINT', alInterrumpir)
  process.on('SIGTERM', alTerminar)

  try {
    await new Promise<void>((resolve, reject) => {
      terminar = (err) => (err === undefined ? resolve() : reject(err))
      montar()
    })
  } finally {
    cerrando = true
    // `as`: tsc no ve que `montar` (un closure) la asignó y la estrecha a `null`.
    const ultima = instancia as Instancia | null
    instancia = null
    ultima?.unmount()
    restaurar()
    // Una escritura en vuelo termina antes de cerrar la fuente (si falla, `resolver` ya no
    // conserva nada); recién después se borran los temporales.
    const pendiente = enCurso as Promise<Accion | null> | null // mismo estrechamiento que `ultima`
    if (pendiente) await pendiente.catch(() => null)
    dejarDeMirar()
    runner.detener()
    descartarPendientes()
    // La fuente espera (con tope) el push que haya quedado en la fila antes de cerrar la base.
    try { await fuente.cerrar() } catch { /* cerrar no puede tapar cómo terminó la TUI */ }
    process.off('exit', alSalirDelProceso)
    process.off('SIGINT', alInterrumpir)
    process.off('SIGTERM', alTerminar)
  }
}
