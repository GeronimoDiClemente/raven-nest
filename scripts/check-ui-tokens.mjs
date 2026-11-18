#!/usr/bin/env node
// Falla (exit 1, con archivo:línea) si el diff contra la base:
//  - suma a src/styles/global.css algo que no sea vacío, comentario o `--custom-property: valor;`
//  - mete un literal de color en src/components/ui/ o src/components/ui-preview/
// Uso: node scripts/check-ui-tokens.mjs [baseRef]   (default: origin/main)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const GLOBAL_CSS = 'src/styles/global.css'
const DIRS_PIEZAS = ['src/components/ui/', 'src/components/ui-preview/']
const EXT_PIEZAS = /\.(tsx|ts|css)$/

const COLOR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\b(?:rgba|rgb|hsla|hsl)\(/g
const SOLO_CUSTOM_PROPS = /^\s*(?:--[\w-]+\s*:[^;]*;\s*)*$/

export function findColorLiterals(source) {
  const out = []
  source.split('\n').forEach((texto, i) => {
    for (const m of texto.matchAll(COLOR)) out.push({ line: i + 1, text: m[0] })
  })
  return out
}

/** Quita los comentarios de una línea; `abierto` indica si arranca dentro de un comentario multilínea. */
function sinComentarios(texto, abierto) {
  let resto = ''
  let i = 0
  while (i < texto.length) {
    if (abierto) {
      const fin = texto.indexOf('*/', i)
      if (fin === -1) return { resto, abierto: true }
      i = fin + 2
      abierto = false
    } else {
      const ini = texto.indexOf('/*', i)
      if (ini === -1) return { resto: resto + texto.slice(i), abierto: false }
      resto += texto.slice(i, ini)
      i = ini + 2
      abierto = true
    }
  }
  return { resto, abierto }
}

export function addedLinesViolations(path, lines) {
  if (path !== GLOBAL_CSS) return []
  const out = []
  let abierto = false
  let previa = null
  for (const l of lines) {
    if (previa === null || l.line !== previa + 1) abierto = false
    previa = l.line
    const r = sinComentarios(l.text, abierto)
    abierto = r.abierto
    if (!SOLO_CUSTOM_PROPS.test(r.resto)) out.push({ path, line: l.line, text: l.text })
  }
  return out
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/** Líneas agregadas de un archivo según `git diff -U0 base...HEAD`, con su número en el archivo nuevo. */
function addedLines(base, path) {
  const lines = []
  let n = 0
  for (const raw of git(['diff', '-U0', `${base}...HEAD`, '--', path]).split('\n')) {
    const h = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/)
    if (h) { n = Number(h[1]); continue }
    if (raw.startsWith('+++') || raw.startsWith('---')) continue
    if (raw.startsWith('+')) lines.push({ line: n++, text: raw.slice(1) })
  }
  return lines
}

function main() {
  const base = process.argv[2] ?? 'origin/main'
  const cambiados = git(['diff', '--name-only', '--diff-filter=AMR', `${base}...HEAD`]).split('\n').filter(Boolean)
  const violaciones = []

  if (cambiados.includes(GLOBAL_CSS)) {
    for (const v of addedLinesViolations(GLOBAL_CSS, addedLines(base, GLOBAL_CSS))) {
      violaciones.push(`${v.path}:${v.line}  línea no permitida en global.css: ${v.text.trim()}`)
    }
  }
  for (const path of cambiados) {
    if (!DIRS_PIEZAS.some((d) => path.startsWith(d)) || !EXT_PIEZAS.test(path)) continue
    for (const h of findColorLiterals(readFileSync(path, 'utf8'))) {
      violaciones.push(`${path}:${h.line}  literal de color ${h.text}`)
    }
  }

  if (violaciones.length) {
    console.error(violaciones.join('\n'))
    process.exit(1)
  }
  console.log('check-ui-tokens: sin violaciones')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
