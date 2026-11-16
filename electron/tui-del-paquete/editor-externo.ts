// El ida y vuelta con el editor del usuario ($VISUAL / $EDITOR, como `git commit`): escribe un .md
// temporal, lanza el editor de forma síncrona y al volver parsea el archivo. Sin Ink: la TUI suelta
// la terminal antes de llamar acá. Spec §2 de docs/superpowers/specs/2026-11-02-tui-de-memory-design.md.

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { parsearMemoria, type MemoriaEscrita } from './frontmatter'

export type ResultadoDeEdicion =
  | { tipo: 'sin-cambios' }
  | { tipo: 'lista'; memoria: MemoriaEscrita }
  | { tipo: 'invalida'; error: string; archivo: string } // el archivo NO se borra: lo necesita Reopen
  | { tipo: 'fallo-el-editor'; error: string }

export type Lanzar = (bin: string, args: string[]) => { status: number | null; error?: Error }

/** Lo que `crearLanzar` usa de `spawnSync`: los tests lo cambian para ver los argumentos. */
export type Spawn = (
  bin: string,
  args: string[],
  o: { stdio: 'inherit'; shell: false; windowsVerbatimArguments?: boolean },
) => { status: number | null; error?: Error }

/**
 * Un argumento entre comillas para la línea de `cmd.exe`. Adentro de comillas cmd no
 * interpreta `&|<>()^`; un `"` (que un path de Windows no puede tener) se dobla.
 */
export function citarParaCmd(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`
}

/**
 * Cómo se lanza el editor. En posix, directo y sin shell. En Windows, por `cmd.exe /d /s /c`:
 * `code`, `subl` y compañía son shims `.cmd`, y `spawnSync` sin shell no puede ejecutarlos
 * (ENOENT/EINVAL). Con `/s`, cmd saca SÓLO las comillas de afuera y deja la línea tal cual.
 */
export function crearLanzar(plataforma: NodeJS.Platform = process.platform, spawn: Spawn = spawnSync as unknown as Spawn): Lanzar {
  return (bin, args) => {
    const r = plataforma === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"${[bin, ...args].map(citarParaCmd).join(' ')}"`], {
        stdio: 'inherit', shell: false, windowsVerbatimArguments: true,
      })
      : spawn(bin, args, { stdio: 'inherit', shell: false })
    return { status: r.status, error: r.error }
  }
}

const lanzarPorDefecto: Lanzar = crearLanzar()

// Chequeo simple en PATH (sin shell). Los tests inyectan el suyo.
function existeEnPath(bin: string): boolean {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const ext of exts) if (existsSync(join(dir, bin + ext))) return true
  }
  return false
}

// Parte una línea de comando respetando comillas dobles y simples. Sin shell: no expande nada.
export function partirComando(s: string): string[] {
  const partes: string[] = []
  let actual = ''
  let hay = false
  let comilla: '"' | "'" | null = null
  for (const c of s) {
    if (comilla) {
      if (c === comilla) comilla = null
      else actual += c
    } else if (c === '"' || c === "'") {
      comilla = c
      hay = true
    } else if (/\s/.test(c)) {
      if (hay || actual !== '') partes.push(actual)
      actual = ''
      hay = false
    } else {
      actual += c
    }
  }
  if (hay || actual !== '') partes.push(actual)
  return partes
}

export function elegirEditor(
  env: NodeJS.ProcessEnv,
  plataforma: NodeJS.Platform,
  existe: (bin: string) => boolean = existeEnPath,
): string[] {
  for (const v of [env.VISUAL, env.EDITOR]) {
    if (v && v.trim() !== '') {
      const partes = partirComando(v)
      if (partes.length > 0) return partes
    }
  }
  if (plataforma === 'win32') return ['notepad']
  return existe('nano') ? ['nano'] : ['vi']
}

function borrar(archivo: string): void {
  try {
    unlinkSync(archivo)
  } catch {
    // ya no estaba
  }
}

/**
 * El nombre de un temporal NUEVO, siempre al azar. Nunca lleva el syncId: es un dato remoto que
 * el servidor no valida, y un `x/../../repo/CLAUDE` haría escribir —y después borrar— un archivo
 * fuera de tmpdir. Qué memoria va con qué temporal lo lleva quien llama.
 */
export function nombreDeTemporal(dir: string = tmpdir()): string {
  return join(dir, `memory-${randomUUID()}.md`)
}

/**
 * Crea `archivo` con `texto`: se borra lo que hubiera con ese nombre y se abre con `wx` y 0600
 * de entrada. `wx` no sigue un symlink plantado (falla con EEXIST si alguien lo vuelve a poner
 * entre el borrado y la apertura) y no hay ventana con otro modo.
 */
export function escribirTemporalNuevo(archivo: string, texto: string): void {
  borrar(archivo)
  writeFileSync(archivo, texto, { mode: 0o600, flag: 'wx' })
}

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Lanza el editor sobre `archivo` y decide el resultado.
 * - `previo`: el contenido a comparar para "sin cambios" (por contenido, no por mtime: hay
 *   editores que guardan sin cambiar nada). `null` en Reopen: ahí no hay "sin cambios".
 * - `antes`: lo que había en el archivo al lanzar. Si el editor sale con error pero el archivo
 *   cambió (el vim de macOS sale con 1 tras cualquier error en la sesión), el texto se conserva.
 */
function correr(archivo: string, editor: string[], previo: string | null, antes: string | null, lanzar: Lanzar): ResultadoDeEdicion {
  let conservar = false
  try {
    let r: { status: number | null; error?: Error }
    try {
      r = lanzar(editor[0], [...editor.slice(1), archivo])
    } catch (e) {
      return { tipo: 'fallo-el-editor', error: mensajeDe(e) }
    }
    if (r.error) return { tipo: 'fallo-el-editor', error: r.error.message }
    if (r.status !== 0) {
      const codigo = r.status ?? 'unknown'
      let ahora: string | null = null
      try { ahora = readFileSync(archivo, 'utf8') } catch { /* no quedó nada que conservar */ }
      if (ahora !== null && ahora !== antes) {
        conservar = true
        return { tipo: 'invalida', error: `The editor exited with code ${codigo} — your text is kept`, archivo }
      }
      return { tipo: 'fallo-el-editor', error: `Editor exited with code ${codigo}` }
    }
    let texto: string
    try {
      texto = readFileSync(archivo, 'utf8')
    } catch (e) {
      return { tipo: 'fallo-el-editor', error: mensajeDe(e) }
    }
    if (previo !== null && texto === previo) return { tipo: 'sin-cambios' }
    const p = parsearMemoria(texto)
    if (p.ok) return { tipo: 'lista', memoria: p.memoria }
    conservar = true
    return { tipo: 'invalida', error: p.error, archivo }
  } finally {
    if (!conservar) borrar(archivo)
  }
}

export function editarEnEditor(o: {
  inicial: string
  editor: string[]
  lanzar?: Lanzar
  /** Dónde va el temporal; sólo los tests lo cambian. */
  dir?: string
}): ResultadoDeEdicion {
  const archivo = nombreDeTemporal(o.dir)
  try {
    escribirTemporalNuevo(archivo, o.inicial)
  } catch (e) {
    return { tipo: 'fallo-el-editor', error: mensajeDe(e) }
  }
  return correr(archivo, o.editor, o.inicial, o.inicial, o.lanzar ?? lanzarPorDefecto)
}

// Reopen tras una `invalida`: no hay "sin cambios" posible (el contenido ya era inválido).
export function reabrirEnEditor(archivo: string, editor: string[], lanzar: Lanzar = lanzarPorDefecto): ResultadoDeEdicion {
  let antes: string | null = null
  try { antes = readFileSync(archivo, 'utf8') } catch { /* ya no está */ }
  return correr(archivo, editor, null, antes, lanzar)
}

export function descartar(archivo: string): void {
  borrar(archivo)
}

/**
 * Deja `texto` en un temporal NUEVO para Reopen, cuando lo que el editor devolvió no se pudo
 * escribir (o el editor de Reopen se cayó): el texto del usuario no se pierde.
 */
export function conservarEnTemporal(texto: string, dir?: string): string {
  const archivo = nombreDeTemporal(dir)
  escribirTemporalNuevo(archivo, texto)
  return archivo
}
