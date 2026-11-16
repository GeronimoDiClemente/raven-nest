// Orquestación de punta a punta (spec 2026-11-12-orquestacion-panes, §8.9) sobre la app REAL:
// un coordinador en un pane lanza un worker, el worker commitea y reporta `done` por el socket,
// Nest le apunta al coordinador, cierra el pane del worker solo y la rama queda para revisar.
//
// Los agentes son `e2e/helpers/fake-agent.mjs`, puesto como `claude` en el PATH de la app: el
// pane se abre por el diálogo de siempre (Claude + cuenta nueva), así que el PTY, el token por
// pane, `--mcp-config`, la tarea por `initialInput` y el cierre son los de producción. Lo único
// que no hace un agente: el `worker.launch` lo manda el test directo al socket con el token del
// pane coordinador (el fake lo deja en NEST_E2E_FAKE_OUT al arrancar).
//
// Toda la corrida es con Memories APAGADO (`localEnabled: false` en connection.json, antes del
// primer arranque): la orquestación no depende de Memories (§6.8).
//
// Necesita `npm run build` (corre contra dist/) y el binding de Electron. En este worktree sin
// .env: `VITE_SUPABASE_URL=http://127.0.0.1:1 VITE_SUPABASE_ANON_KEY=e2e-fake npm run build`.
// En macOS: `RAVEN_E2E_KEEP_REAL_HOME=1` (ver harness.ts).
import { test, expect } from '@playwright/test'
import { connect } from 'net'
import { randomUUID } from 'crypto'
import { execFileSync } from 'child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join, resolve } from 'path'
import { launchHarness, teardown, initRepo, type Harness } from './helpers/harness'
import { workerSwatch } from '../src/lib/worker-palette'

const FAKE_AGENT = resolve(__dirname, 'helpers', 'fake-agent.mjs')
// El cierre automático real es de 2 min; el override sólo existe con RAVEN_E2E=1 (preload.ts).
const AUTO_CLOSE_MS = 3000

interface AgentRecord {
  pid: number
  cwd: string
  argv: string[]
  socket: string | null
  token: string | null
  memoryEnabled: string | null
  role: 'unknown' | 'worker'
  task?: string
  reported?: string
  reportError?: string
}

interface Gancho {
  pty: { getAllPids(): Array<{ paneId: string }>; getBuffer(paneId: string): string }
  reviewStore: { list(): Array<{ workerId: string; branch: string; status: string; worktreePath: string }> }
}

test.describe.configure({ mode: 'serial' })
test.skip(process.platform === 'win32', 'el CLI falso es un script sh')

let h: Harness
let base = ''
let repoDir = ''
let outDir = ''
let coordPaneId = ''
let coord: AgentRecord
let primero: { workerId: string; branch: string; label: string }

function agentes(): AgentRecord[] {
  if (!existsSync(outDir)) return []
  return readdirSync(outDir)
    .filter((f) => f.startsWith('agent-') && f.endsWith('.json'))
    .flatMap((f) => {
      try { return [JSON.parse(readFileSync(join(outDir, f), 'utf8')) as AgentRecord] } catch { return [] }
    })
}

/** Una request al socket de orquestación, con el framing del shim (una línea JSON). */
function llamar<T>(method: string, params: unknown, token: string): Promise<T> {
  return new Promise((ok, mal) => {
    const s = connect(coord.socket!)
    const id = randomUUID()
    let buf = ''
    const timer = setTimeout(() => { s.destroy(); mal(new Error(`timeout ${method}`)) }, 15_000)
    s.setEncoding('utf8')
    s.on('connect', () => s.write(`${JSON.stringify({ id, method, params, token })}\n`))
    s.on('data', (c: string) => {
      buf += c
      const i = buf.indexOf('\n')
      if (i < 0) return
      clearTimeout(timer)
      s.destroy()
      const r = JSON.parse(buf.slice(0, i))
      if (r.ok) ok(r.result as T)
      else mal(new Error(r.error))
    })
    s.on('error', (e) => { clearTimeout(timer); mal(e) })
  })
}

// El gancho que main.ts expone sólo con RAVEN_E2E=1. `app.evaluate` serializa la función: lo
// que no vaya por el argumento no llega a main.
const ptysVivos = (): Promise<string[]> => h.app.evaluate(() =>
  (globalThis as unknown as { __nestOrchestrationE2E: Gancho }).__nestOrchestrationE2E.pty.getAllPids().map((p) => p.paneId))
const bufferDe = (paneId: string): Promise<string> => h.app.evaluate((_e, id) =>
  (globalThis as unknown as { __nestOrchestrationE2E: Gancho }).__nestOrchestrationE2E.pty.getBuffer(id), paneId)
const revision = (): Promise<ReturnType<Gancho['reviewStore']['list']>> => h.app.evaluate(() =>
  (globalThis as unknown as { __nestOrchestrationE2E: Gancho }).__nestOrchestrationE2E.reviewStore.list())

const git = (...args: string[]): string =>
  execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const workerPanes = () => h.page.locator('.terminal-pane').filter({ has: h.page.locator('[data-testid="worker-badge"]') })
const coordPane = () => h.page.locator('.terminal-pane').filter({ hasNot: h.page.locator('[data-testid="worker-badge"]') })

/** El pane que tiene el foco del teclado (xterm enfoca su textarea). */
const paneConFoco = () => h.page.evaluate(() => {
  const p = document.activeElement?.closest('.terminal-pane')
  if (!p) return null
  return p.querySelector('[data-testid="worker-badge"]') ? 'worker' : 'coordinator'
})

test.beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'raven-e2e-orq-'))
  // Los worktrees de los workers caen al lado del repo (createWorktreeForBot): adentro de `base`.
  repoDir = join(base, 'repo')
  initRepo(repoDir)
  outDir = join(base, 'agents')

  const bin = join(base, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_AGENT}" "$@"\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  // El PATH del pane: pty-manager antepone ~/.local/bin y Homebrew si no están (ahí vive el
  // claude de verdad), y el login shell de macOS corre path_helper. Con todo eso ya en el PATH
  // detrás de `bin` no se antepone nada, y un .zshrc (ZDOTDIR) vuelve a poner `bin` primero
  // después de path_helper.
  const PATH = [bin, join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', process.env.PATH].join(':')
  const zdot = join(base, 'zdot')
  mkdirSync(zdot)
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\n`)

  // Memories apagado desde el primer arranque.
  const homeDir = mkdtempSync(join(tmpdir(), 'raven-e2e-home-'))
  mkdirSync(join(homeDir, '.raven-nest', 'memory'), { recursive: true })
  writeFileSync(join(homeDir, '.raven-nest', 'memory', 'connection.json'), JSON.stringify({ connected: false, localEnabled: false }))

  h = await launchHarness({
    withRepo: false,
    homeDir,
    env: {
      PATH,
      ZDOTDIR: zdot,
      NEST_E2E_FAKE_OUT: outDir,
      RAVEN_E2E_WORKER_AUTO_CLOSE_MS: String(AUTO_CLOSE_MS),
    },
  })
  const { app, page } = h

  // El picker de carpeta es nativo: se contesta desde main (igual que fingir-orquestacion).
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, repoDir)
  await page.locator('.sidebar-repo').click()
  await expect(page.locator('.sidebar-repo')).toHaveAttribute('title', repoDir, { timeout: 10_000 })

  // El coordinador: un pane de Claude con una cuenta nueva, por el diálogo de siempre.
  await page.getByRole('button', { name: '+ New Terminal' }).click()
  await page.locator('.ai-card', { hasText: /^Claude$/ }).click()
  await page.locator('.new-account-input').fill('e2e')
  await page.getByRole('button', { name: 'Login →' }).click()
  await expect(page.locator('.terminal-pane')).toHaveCount(1, { timeout: 10_000 })

  const real = realpathSync(repoDir)
  await expect.poll(() => agentes().find((a) => a.cwd === real), { timeout: 20_000 }).toBeTruthy()
  coord = agentes().find((a) => a.cwd === real)!
  const pids = await ptysVivos()
  expect(pids).toHaveLength(1)
  coordPaneId = pids[0]
})

test.afterAll(async () => {
  if (h) await teardown(h)
  // Los agentes mueren con su PTY; por las dudas, nada queda vivo.
  for (const a of agentes()) {
    try { process.kill(a.pid, 'SIGKILL') } catch { /* ya no está */ }
  }
  if (base) rmSync(base, { recursive: true, force: true })
})

test('lanza un worker visible en el tab del coordinador', async () => {
  const { page } = h
  expect(coord.socket, 'el pane coordinador recibe el socket').toBeTruthy()
  expect(coord.token, 'y su token').toBeTruthy()
  // El foco está en el coordinador antes de lanzar.
  // El textarea de xterm es el que recibe el teclado (el mismo que enfoca un click en la terminal).
  await coordPane().locator('textarea').focus()
  await expect.poll(paneConFoco).toBe('coordinator')

  primero = await llamar('worker.launch', { task: 'create hello.txt', label: 'hello' }, coord.token!)
  expect(primero.branch).toMatch(/^nest\/hello-/)

  await expect(page.locator('.terminal-pane')).toHaveCount(2, { timeout: 10_000 })
  const w = workerPanes()
  await expect(w).toHaveCount(1)
  await expect(w.locator('.pane-custom-label')).toHaveText('hello')
  // Color 1 de la paleta de workers (colorIndex 0), en el punto del badge.
  const esperado = workerSwatch(0).toLowerCase()
  const rgb = await w.locator('[data-testid="worker-dot"]').evaluate((el) => getComputedStyle(el).backgroundColor)
  const hex = '#' + (rgb.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
  expect(hex).toBe(esperado)
  // Lanzar no le roba el foco a Gero.
  await page.waitForTimeout(1000)
  expect(await paneConFoco()).toBe('coordinator')
})

test('done cierra el pane a los 2 min y la rama queda', async () => {
  const { page } = h
  // El worker recibió la tarea por initialInput, commiteó y reportó done.
  await expect.poll(() => agentes().find((a) => a.role === 'worker' && a.task === 'create hello.txt')?.reported ?? null, {
    timeout: 20_000,
  }).toBe('done')
  // El badge pasa a Done y aparece la cuenta del cierre (el override de RAVEN_E2E).
  await expect(workerPanes().locator('[data-testid="worker-badge"]')).toHaveAttribute('data-status', 'done', { timeout: 10_000 })
  await expect(page.locator('[data-testid="worker-auto-close"]')).toBeVisible()
  // Y el pane se cierra solo.
  await expect(workerPanes()).toHaveCount(0, { timeout: 20_000 })
  await expect(page.locator('.terminal-pane')).toHaveCount(1)

  // La rama queda con el commit del worker, el worktree también, y nada llegó a main.
  expect(git('branch', '--list', primero.branch)).toContain(primero.branch)
  expect(git('show', `${primero.branch}:hello.txt`)).toBe('written by the fake worker')
  expect(() => git('show', 'main:hello.txt')).toThrow()
  const entradas = await revision()
  const e = entradas.find((x) => x.workerId === primero.workerId)
  expect(e?.status).toBe('done')
  expect(existsSync(e!.worktreePath)).toBe(true)
  await expect(page.locator('[data-testid="worker-review"]')).toBeVisible()
})

test('el coordinador recibe el puntero', async () => {
  // Nest tipea la línea en el PTY del coordinador cuando está quieto; el Enter va aparte, y el
  // fake contesta `received: <línea>` sólo al Enter.
  await expect.poll(() => bufferDe(coordPaneId), { timeout: 20_000 })
    .toContain('received: You have 1 worker message. Call nest_inbox.')
  const inbox = await llamar<Array<{ kind: string; text: string; workerId: string }>>('inbox.read', {}, coord.token!)
  expect(inbox).toEqual([
    expect.objectContaining({ kind: 'done', workerId: primero.workerId, text: expect.stringContaining('Created hello.txt') }),
  ])
})

test('cerrar el coordinador cierra al worker y deja la rama', async () => {
  const { page } = h
  const lento = await llamar<{ workerId: string; branch: string }>('worker.launch', { task: 'idle', label: 'slow' }, coord.token!)
  await expect(workerPanes()).toHaveCount(1, { timeout: 10_000 })
  // El agente del worker arrancó y recibió la tarea (sigue trabajando, no reporta).
  await expect.poll(() => agentes().some((a) => a.role === 'worker' && a.task === 'idle'), { timeout: 20_000 }).toBe(true)
  await expect(workerPanes().locator('[data-testid="worker-badge"]')).toHaveAttribute('data-status', 'working')

  await coordPane().locator('.pane-close-btn').click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.terminal-pane')).toHaveCount(0, { timeout: 10_000 })

  expect(git('branch', '--list', lento.branch)).toContain(lento.branch)
  expect(git('branch', '--list', primero.branch)).toContain(primero.branch)
  const entradas = await revision()
  const e = entradas.find((x) => x.workerId === lento.workerId)
  expect(e?.status).toBe('stopped')
  expect(existsSync(e!.worktreePath)).toBe(true)
  // El proceso del worker murió con su pane.
  const w = agentes().find((a) => a.role === 'worker' && a.task === 'idle')!
  await expect.poll(() => { try { process.kill(w.pid, 0); return true } catch { return false } }, { timeout: 10_000 }).toBe(false)
})

test('funciona con Memories apagado', async () => {
  // Todo lo de arriba corrió con Memories apagado: cada pane de agente (coordinador y los dos
  // workers) recibió el canal de orquestación y ninguno quedó con la memoria prendida.
  const todos = agentes()
  expect(todos.length).toBe(3)
  for (const a of todos) {
    expect(a.socket, JSON.stringify(a)).toBeTruthy()
    expect(a.token, JSON.stringify(a)).toBeTruthy()
    expect(a.memoryEnabled, JSON.stringify(a)).not.toBe('1')
    // Sin los args que agrega el provisioning de memoria (hooks por --settings).
    expect(a.argv).not.toContain('--settings')
    expect(a.argv).toContain('--mcp-config')
  }
  // Cada pane tuvo SU token.
  expect(new Set(todos.map((a) => a.token)).size).toBe(3)
})
