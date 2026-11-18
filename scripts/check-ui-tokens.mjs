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
const LINEA_PERMITIDA = /^\s*(?:$|\/\*.*\*\/\s*$|--[\w-]+\s*:[^;]*;\s*(?:\/\*.*\*\/\s*)?$)/

export function findColorLiterals(source) {
  const out = []
  source.split('\n').forEach((texto, i) => {
    for (const m of texto.matchAll(COLOR)) out.push({ line: i + 1, text: m[0] })
  })
  return out
}

export function addedLinesViolations(path, lines) {
  if (path !== GLOBAL_CSS) return []
  return lines
    .filter((l) => !LINEA_PERMITIDA.test(l.text))
    .map((l) => ({ path, line: l.line, text: l.text }))
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
  const cambiados = git(['diff', '--name-only', '--diff-filter=AM', `${base}...HEAD`]).split('\n').filter(Boolean)
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
