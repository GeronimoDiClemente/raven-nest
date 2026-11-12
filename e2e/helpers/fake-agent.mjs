#!/usr/bin/env node
// CLI falso que el e2e de orquestación (e2e/20-orquestacion-panes.spec.ts) pone como `claude`
// en el PATH de la app. Hace lo mínimo que hace un agente de verdad dentro de un pane de Nest:
//
// - Ignora los args que Nest le agrega (`--mcp-config <archivo>`, flags de memoria).
// - Al arrancar deja en `$NEST_E2E_FAKE_OUT/agent-<pid>.json` su cwd, sus args y las variables
//   que Nest le inyectó. Así el test obtiene el token del pane coordinador sin código de
//   producción para eso. Sin NEST_E2E_FAKE_OUT no escribe nada.
// - Worker: cuando llega el envío (el `initialInput` con el preámbulo, y el Enter aparte) lee
//   la línea de la tarea. `create <archivo>` crea el archivo, hace `git add` + `git commit` y
//   llama al socket (`worker.report done`) con NEST_ORCH_TOKEN, con el mismo framing que el
//   shim (una línea JSON {id, method, params, token}). `idle` no hace nada (un worker que
//   sigue trabajando). Después queda vivo y quieto, como un agente real.
// - Coordinador (cualquier envío sin preámbulo): al Enter escribe `received: <línea>`, para que
//   el test lea el puntero en el buffer del pane.
//
// Modo raw y sin eco a propósito: el eco de la tty pondría el preámbulo en el buffer del worker,
// y el vigía de "esperando input" (detectNeedsInput) lo lee.
import { connect } from 'node:net'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const PROMPT = 'fake-agent> '
const out = process.env.NEST_E2E_FAKE_OUT

function registrar(extra) {
  if (!out) return
  try {
    mkdirSync(out, { recursive: true })
    writeFileSync(
      join(out, `agent-${process.pid}.json`),
      JSON.stringify({
        pid: process.pid,
        cwd: process.cwd(),
        argv: process.argv.slice(2),
        socket: process.env.NEST_ORCH_SOCKET ?? null,
        token: process.env.NEST_ORCH_TOKEN ?? null,
        memoryEnabled: process.env.NEST_MEMORY_ENABLED ?? null,
        ...extra,
      }),
    )
  } catch { /* el test lo nota por la ausencia del archivo */ }
}

function llamar(method, params) {
  return new Promise((resolve, reject) => {
    const socket = connect(process.env.NEST_ORCH_SOCKET ?? '')
    const id = randomUUID()
    let buf = ''
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('timeout')) }, 10_000)
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id, method, params, token: process.env.NEST_ORCH_TOKEN })}\n`)
    })
    socket.on('data', (c) => {
      buf += c
      const i = buf.indexOf('\n')
      if (i < 0) return
      clearTimeout(timer)
      socket.destroy()
      const r = JSON.parse(buf.slice(0, i))
      if (r.ok) resolve(r.result)
      else reject(new Error(r.error))
    })
    socket.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
}

function git(args) {
  execFileSync('git', args, { cwd: process.cwd(), stdio: 'pipe' })
}

async function trabajar(envio) {
  const marca = envio.indexOf('=== TASK ===')
  const tarea = envio.slice(marca + '=== TASK ==='.length).trim().split(/\r?\n/)[0].trim()
  registrar({ role: 'worker', task: tarea })
  const m = /^create\s+(\S+)/.exec(tarea)
  if (!m) {
    process.stdout.write(`\r\nworking on: ${tarea}\r\n`)
    return
  }
  writeFileSync(join(process.cwd(), m[1]), `written by the fake worker\n`)
  git(['add', '--', m[1]])
  git(['-c', 'user.name=e2e', '-c', 'user.email=e2e@test.local', '-c', 'commit.gpgsign=false',
    'commit', '-q', '-m', `fake worker: ${m[1]}`])
  try {
    await llamar('worker.report', { kind: 'done', text: `Created ${m[1]} and committed it. Nothing found. Nothing left.` })
    registrar({ role: 'worker', task: tarea, reported: 'done' })
    process.stdout.write(`\r\nreported done\r\n${PROMPT}`)
  } catch (e) {
    registrar({ role: 'worker', task: tarea, reportError: e instanceof Error ? e.message : String(e) })
    process.stdout.write(`\r\nreport failed: ${e instanceof Error ? e.message : e}\r\n${PROMPT}`)
  }
}

registrar({ role: 'unknown' })
process.stdout.write(`fake agent ready\r\n${PROMPT}`)

if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')
let linea = ''
let esWorker = false
process.stdin.on('data', (chunk) => {
  for (const c of chunk) {
    if (c === '\x03') process.exit(130)
    if (c === '\r') {
      const envio = linea
      linea = ''
      if (!esWorker && envio.includes('=== TASK ===')) {
        esWorker = true
        void trabajar(envio)
      } else if (!esWorker) {
        process.stdout.write(`\r\nreceived: ${envio}\r\n${PROMPT}`)
      }
      continue
    }
    linea += c
  }
})
// Un agente real sigue vivo después de terminar su turno.
setInterval(() => {}, 1 << 30)
