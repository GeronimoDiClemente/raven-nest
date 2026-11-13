#!/usr/bin/env node
// Deja el binding de better-sqlite3 para el ABI de Electron.
//
// OJO: `electron-rebuild -f -o better-sqlite3` es un no-op silencioso en
// Windows — imprime "Rebuild Complete" y no toca
// node_modules/better-sqlite3/build/Release/better_sqlite3.node. Bajamos el
// prebuild de Electron a mano, igual que native:node hace con el de Node, y
// sólo caemos a electron-rebuild si no hay prebuild para este ABI.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const target = require('electron/package.json').version
const cwd = fileURLToPath(new URL('../node_modules/better-sqlite3/', import.meta.url))

const run = (bin, args, opts = {}) =>
  execFileSync(process.execPath, [require.resolve(bin), ...args], { stdio: 'inherit', ...opts })

try {
  run('prebuild-install/bin.js', ['-r', 'electron', '-t', target, '--tag-prefix', 'v'], { cwd })
} catch {
  console.warn(`sin prebuild de Electron ${target}; compilando desde source`)
  run('@electron/rebuild/lib/cli.js', ['-f', '-o', 'better-sqlite3'])
}
