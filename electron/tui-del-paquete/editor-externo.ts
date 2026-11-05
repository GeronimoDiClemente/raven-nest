// El ida y vuelta con el editor del usuario ($VISUAL / $EDITOR, como `git commit`): escribe un .md
// temporal, lanza el editor de forma síncrona y al volver parsea el archivo. Sin Ink: la TUI suelta
// la terminal antes de llamar acá. Spec §2 de docs/superpowers/specs/2026-11-02-tui-de-memory-design.md.

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { parsearMemoria, type MemoriaEscrita } from './frontmatter'

export type ResultadoDeEdicion =
  | { tipo: 'sin-cambios' }
  | { tipo: 'lista'; memoria: MemoriaEscrita }
  | { tipo: 'invalida'; error: string; archivo: string } // el archivo NO se borra: lo necesita Reopen
  | { tipo: 'fallo-el-editor'; error: string }

export type Lanzar = (bin: string, args: string[]) => { status: number | null; error?: Error }

const lanzarPorDefecto: Lanzar = (bin, args) => {
  const r = spawnSync(bin, args, { stdio: 'inherit', shell: false })
  return { status: r.status, error: r.error }
}

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

// Lanza el editor sobre `archivo` y decide el resultado. `previo` es el contenido a comparar para
// "sin cambios" (por contenido, no por mtime: hay editores que guardan sin cambiar nada).
function correr(archivo: string, editor: string[], previo: string | null, lanzar: Lanzar): ResultadoDeEdicion {
  let conservar = false
  try {
    let r: { status: number | null; error?: Error }
    try {
      r = lanzar(editor[0], [...editor.slice(1), archivo])
    } catch (e) {
      return { tipo: 'fallo-el-editor', error: e instanceof Error ? e.message : String(e) }
    }
    if (r.error) return { tipo: 'fallo-el-editor', error: r.error.message }
    if (r.status !== 0) {
      return { tipo: 'fallo-el-editor', error: `Editor exited with code ${r.status ?? 'unknown'}` }
    }
    let texto: string
    try {
      texto = readFileSync(archivo, 'utf8')
    } catch (e) {
      return { tipo: 'fallo-el-editor', error: e instanceof Error ? e.message : String(e) }
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
  id: string
  editor: string[]
  lanzar?: Lanzar
}): ResultadoDeEdicion {
  const archivo = join(tmpdir(), `memory-${o.id}.md`)
  try {
    writeFileSync(archivo, o.inicial, { mode: 0o600 })
    chmodSync(archivo, 0o600) // por si el archivo ya existía con otro modo
  } catch (e) {
    borrar(archivo)
    return { tipo: 'fallo-el-editor', error: e instanceof Error ? e.message : String(e) }
  }
  return correr(archivo, o.editor, o.inicial, o.lanzar ?? lanzarPorDefecto)
}

// Reopen tras una `invalida`: no hay "sin cambios" posible (el contenido ya era inválido).
export function reabrirEnEditor(archivo: string, editor: string[], lanzar: Lanzar = lanzarPorDefecto): ResultadoDeEdicion {
  return correr(archivo, editor, null, lanzar)
}

export function descartar(archivo: string): void {
  borrar(archivo)
}

/**
 * Deja `texto` en un temporal para Reopen, cuando lo que el editor devolvió no se pudo
 * escribir (o el editor de Reopen se cayó): el texto del usuario no se pierde. Se borra lo
 * que hubiera con ese nombre y se crea con `wx` y 0600 de entrada, sin ventana con otro modo.
 */
export function conservarEnTemporal(texto: string, id: string): string {
  const archivo = join(tmpdir(), `memory-${id}.md`)
  borrar(archivo)
  writeFileSync(archivo, texto, { mode: 0o600, flag: 'wx' })
  return archivo
}
