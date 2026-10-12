// La memoria de EQUIPO en la app real, con dos cuentas distintas y un servicio de verdad.
//
// `server/__tests__/pull-team-scope.test.ts` prueba el filtro del pull llamando a `handlePull`
// a mano, con un cursor en 0 y un proyecto que el compañero no tiene. Esto prueba lo que ese
// test no ve: el recorrido entero cuando lo hacen dos instalaciones de Nest —guardar,
// compartir el proyecto, promover desde un agente (MCP), y que la OTRA cuenta lo termine
// viendo en su pantalla—, con el daemon de cada una manejando sus propios cursores.
//
// Dos cuentas son dos `RAVEN_HOME` con dos repos distintos que apuntan al MISMO remoto: es lo
// que hace que las dos calculen el mismo `project_key` (memory-project-key.ts), igual que dos
// personas con el mismo repo clonado.
//
// Se saltea si no le pasan un servicio. Para correrlo (ver `server/README.md`):
//
//   docker start nest-memory-pg
//   (cd server && PORT=8099 npx tsx src/index.ts)
//   npm run build
//   NEST_E2E_SYNC_URL=http://127.0.0.1:8099 NEST_E2E_PG_DOCKER=nest-memory-pg \
//     npx playwright test e2e/13-equipo-dos-cuentas.spec.ts
//
// Lo que NO pasa por la app, y por qué:
//   · Emitir el token: el camino de producto lo pide con el login de Supabase (igual que el 12).
//   · La membresía: `team_memberships` es un espejo que `registerDevice` llena desde Supabase
//     con el JWT del login. Acá se siembra por SQL. Ese espejo queda SIN probar de punta a punta.
//   · El selector de equipo de ShareProjectCard: lista los equipos de `useTeam()` (Supabase).
//     Se llama al mismo IPC que dispara su botón, `memory:shareProjectWithTeam`.
import { test, expect, type Page } from '@playwright/test'
import { launchHarness, teardown, type Harness } from './helpers/harness'
import { execFileSync, spawn } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'

const SYNC_URL = process.env.NEST_E2E_SYNC_URL
const PG_DOCKER = process.env.NEST_E2E_PG_DOCKER
const DATABASE_URL = process.env.NEST_E2E_DATABASE_URL ?? 'postgres://postgres:nestmem@127.0.0.1:55432/nest_memory'

const REPO = join(__dirname, '..')
const PAQUETE = join(REPO, 'packages', 'nest-memory')
const CLI = join(PAQUETE, 'dist', 'cli-del-paquete.js')
const SHOTS = join(REPO, 'test-results', 'equipo-dos-cuentas')
mkdirSync(SHOTS, { recursive: true })

test.skip(!SYNC_URL || !PG_DOCKER, 'necesita NEST_E2E_SYNC_URL y NEST_E2E_PG_DOCKER (ver el encabezado)')
test.setTimeout(300_000)

test.beforeAll(() => {
  if (!SYNC_URL || !PG_DOCKER) return
  // El MCP del paquete: es por donde un agente promueve una memoria (`memory_promote`).
  execFileSync(process.execPath, [join(REPO, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(PAQUETE, 'tsconfig.json')], { stdio: 'pipe' })
})

function sql(q: string): string {
  return execFileSync('docker', ['exec', '-i', PG_DOCKER!, 'psql', '-U', 'postgres', '-d', 'nest_memory', '-t', '-A', '-c', q], {
    encoding: 'utf8',
  }).trim()
}

interface Cuenta { userId: string; deviceId: string; token: string }

/** Una cuenta nueva con plan `team` y un device, con el mismo script que se usa en la beta. */
function cuentaNueva(marca: string, quien: string): Cuenta {
  const dir = mkdtempSync(join(tmpdir(), 'nest-e2e-equipo-'))
  const out = join(dir, 'token.txt')
  const salida = execFileSync(process.execPath, [
    join(REPO, 'server', 'scripts', 'mint-device-token.mjs'),
    '--email', `${quien}-${marca}@e2e.test`, '--device', `e2e-${quien}`, '--plan', 'team', '--out', out,
  ], { encoding: 'utf8', env: { ...process.env, DATABASE_URL }, cwd: join(REPO, 'server') })
  const campo = (k: string): string => salida.match(new RegExp(`^${k}=(.+)$`, 'm'))![1].trim()
  return { userId: campo('user_id'), deviceId: campo('device_id'), token: readFileSync(out, 'utf8').trim() }
}

function hacerMiembro(c: Cuenta, teamId: string): void {
  sql(`insert into team_memberships (user_id, team_id, team_name, role, status)
       values ('${c.userId}', '${teamId}', 'Equipo e2e', 'member', 'active')`)
}

/** El mismo remoto en dos carpetas distintas: dos clones del mismo repo. */
function apuntarAlRemoto(repoDir: string, marca: string): void {
  execFileSync('git', ['remote', 'add', 'origin', `https://github.com/nest-e2e/equipo-${marca}.git`], { cwd: repoDir })
}

type Memoria = Record<string, (...a: unknown[]) => Promise<unknown>>
const memoria = 'window.memory'

async function conectar(page: Page, c: Cuenta): Promise<void> {
  const r = await page.evaluate(async ({ url, token, deviceId }) => {
    const m = (window as unknown as { memory: Memoria }).memory
    const svc = await m.setSyncService(url)
    const con = await m.connect(token, deviceId)
    return { svc, con }
  }, { url: SYNC_URL!, token: c.token, deviceId: c.deviceId })
  expect((r.svc as { ok: boolean }).ok, JSON.stringify(r.svc)).toBe(true)
  expect((r.con as { ok?: boolean }).ok ?? true, JSON.stringify(r.con)).toBe(true)
}

async function guardar(page: Page, repoDir: string, title: string): Promise<string> {
  const r = await page.evaluate(async ({ title, worktreePath }) =>
    (window as unknown as { memory: { saveFromUi(i: unknown): Promise<{ ok: boolean; syncId?: string; error?: string }> } })
      .memory.saveFromUi({ title, content: `Contenido de: ${title}`, type: 'decision', worktreePath }), { title, worktreePath: repoDir })
  expect(r.ok, `${memoria}.saveFromUi: ${r.error}`).toBe(true)
  return r.syncId!
}

async function estado(page: Page): Promise<{ pendingCount: number; daemonStatus: string; daemonStatusDetail?: string }> {
  return page.evaluate(() =>
    (window as unknown as { memory: { status(): Promise<{ pendingCount: number; daemonStatus: string; daemonStatusDetail?: string }> } })
      .memory.status())
}

async function todoSubido(page: Page): Promise<void> {
  await expect.poll(async () => (await estado(page)).pendingCount, { timeout: 60_000 }).toBe(0)
}

async function projectKeyDe(page: Page, repoDir: string): Promise<string> {
  const r = await page.evaluate(async (dir) =>
    (window as unknown as { memory: { teamThreadProjectKeyForWorktree(d: string): Promise<{ ok: boolean; projectKey?: string }> } })
      .memory.teamThreadProjectKeyForWorktree(dir), repoDir)
  expect(r.ok).toBe(true)
  return r.projectKey!
}

async function compartir(page: Page, projectKey: string, teamId: string): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate(async ({ projectKey, teamId }) =>
    (window as unknown as { memory: { shareProjectWithTeam(p: string, t: string): Promise<{ ok: boolean; error?: string }> } })
      .memory.shareProjectWithTeam(projectKey, teamId), { projectKey, teamId })
}

/** Lo que la base LOCAL de esta instalación tiene con esa marca: título y scope. */
async function loQueTiene(page: Page, marca: string): Promise<Array<{ title: string; scope: string }>> {
  return page.evaluate(async (q) => {
    const r = await (window as unknown as { memory: { crossProject(i: unknown): Promise<{ items: Array<{ title: string; scope: string }> }> } })
      .memory.crossProject({ query: q, limit: 50 })
    return r.items.map((i) => ({ title: i.title, scope: i.scope }))
  }, marca)
}

/** `memory_promote` como lo llama un agente: por el MCP del paquete, que le delega a Nest. */
async function promoverPorMcp(h: Harness, syncId: string): Promise<string> {
  const env: Record<string, string | undefined> = { ...process.env, RAVEN_HOME: h.homeDir, HOME: h.homeDir, USERPROFILE: h.homeDir, NODE_NO_WARNINGS: '1' }
  delete env.NEST_MEMORY_SOCKET
  delete env.NEST_MEMORY_TOKEN
  const p = spawn(process.execPath, [CLI, 'mcp'], { env, cwd: h.repoDir, windowsHide: true })
  let buf = ''
  let stderr = ''
  let id = 0
  const pendientes = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>()
  p.stdout.on('data', (d) => {
    buf += d
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const linea = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!linea) continue
      const m = JSON.parse(linea)
      pendientes.get(m.id)?.(m)
    }
  })
  p.stderr.on('data', (d) => { stderr += d })
  const rpc = (method: string, params: unknown) => new Promise<{ result?: unknown; error?: { message: string } }>((resolve) => {
    const n = ++id
    pendientes.set(n, resolve)
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n')
  })
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } })
    expect(init.error, stderr).toBeUndefined()
    const r = await rpc('tools/call', { name: 'memory_promote', arguments: { sync_id: syncId, reason: 'e2e de equipo' } })
    expect(r.error, stderr).toBeUndefined()
    return JSON.stringify(r.result)
  } finally {
    p.stdin.end()
  }
}

async function abrirMemories(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await page.getByTitle(/^Memories/).first().click()
  await expect(page.locator('.memories-workspace')).toBeVisible({ timeout: 15_000 })
}

/** La fila en el servicio, mirada en su base. */
function filaEnElServicio(syncId: string): { scope: string; seq: number; title: string } | null {
  const r = sql(`select scope || '|' || project_seq || '|' || title from observations where sync_id = '${syncId}'`)
  if (!r) return null
  const [scope, seq, ...resto] = r.split('|')
  return { scope, seq: Number(seq), title: resto.join('|') }
}

/**
 * Reconectar es la forma de pedirle al daemon un ciclo entero AHORA (status → pull → push):
 * `memory:connect` termina en `onNetworkRegain()`. Sin esto habría que esperar el intervalo
 * que dicta el servicio, que para el plan `team` son 5 minutos.
 */
async function hastaQueTenga(page: Page, c: Cuenta, marca: string, title: string, timeout = 60_000): Promise<boolean> {
  const hasta = Date.now() + timeout
  while (Date.now() < hasta) {
    await conectar(page, c)
    await page.waitForTimeout(3_000)
    if ((await loQueTiene(page, marca)).some((m) => m.title === title)) return true
  }
  return false
}

/** El autor: guarda una personal y una que promueve, comparte el proyecto y espera a que suba. */
async function autorComparteYPromueve(a: Harness, teamId: string, marca: string): Promise<{
  deEquipo: string; personal: string; syncIdEquipo: string; syncIdPersonal: string; projectKey: string
}> {
  const personal = `Nota personal del autor ${marca}`
  const deEquipo = `Decision de equipo ${marca}`
  const syncIdPersonal = await guardar(a.page, a.repoDir, personal)
  const syncIdEquipo = await guardar(a.page, a.repoDir, deEquipo)
  await todoSubido(a.page)

  const projectKey = await projectKeyDe(a.page, a.repoDir)
  const share = await compartir(a.page, projectKey, teamId)
  expect(share.ok, `shareProjectWithTeam: ${share.error}`).toBe(true)

  const promo = await promoverPorMcp(a, syncIdEquipo)
  expect(promo, promo).toContain('true')
  await expect.poll(() => filaEnElServicio(syncIdEquipo)?.scope, { timeout: 60_000 }).toBe('team')
  // La personal sigue siendo personal aunque el proyecto ya esté compartido.
  expect(filaEnElServicio(syncIdPersonal)?.scope).toBe('personal')
  return { deEquipo, personal, syncIdEquipo, syncIdPersonal, projectKey }
}

test('el compañero ve la memoria promovida, no ve la personal, y alguien de afuera no ve nada', async () => {
  const marca = `eq${Date.now()}`
  const teamId = randomUUID()
  const cA = cuentaNueva(marca, 'autor')
  const cB = cuentaNueva(marca, 'companero')
  const cC = cuentaNueva(marca, 'afuera')
  hacerMiembro(cA, teamId)
  hacerMiembro(cB, teamId)

  let h: Harness | null = null
  try {
    // ── A: guarda, comparte, promueve ──────────────────────────────────────────
    h = await launchHarness()
    apuntarAlRemoto(h.repoDir, marca)
    await conectar(h.page, cA)
    const a = await autorComparteYPromueve(h, teamId, marca)
    await abrirMemories(h.page)
    await h.page.screenshot({ path: join(SHOTS, '01-autor.png') })
    await teardown(h); h = null

    // ── B: miembro del equipo, con el mismo repo y una memoria propia ──────────
    h = await launchHarness()
    apuntarAlRemoto(h.repoDir, marca)
    await conectar(h.page, cB)
    expect(await projectKeyDe(h.page, h.repoDir)).toBe(a.projectKey)
    await guardar(h.page, h.repoDir, `Nota propia del companero ${marca}`)
    await todoSubido(h.page)

    expect(await hastaQueTenga(h.page, cB, marca, a.deEquipo), 'la memoria de equipo nunca llegó al compañero').toBe(true)
    const enB = await loQueTiene(h.page, marca)
    expect(enB.find((m) => m.title === a.deEquipo)?.scope).toBe('team')
    expect(enB.map((m) => m.title)).not.toContain(a.personal)

    // Y en pantalla, que es donde lo va a buscar una persona.
    await abrirMemories(h.page)
    await expect(h.page.getByText(a.deEquipo).first()).toBeVisible({ timeout: 20_000 })
    await expect(h.page.getByText(a.personal)).toHaveCount(0)
    await h.page.screenshot({ path: join(SHOTS, '02-companero-la-ve.png') })
    await teardown(h); h = null

    // ── C: mismo repo, plan de equipo, pero NO es miembro ──────────────────────
    h = await launchHarness()
    apuntarAlRemoto(h.repoDir, marca)
    await conectar(h.page, cC)
    await guardar(h.page, h.repoDir, `Nota propia del de afuera ${marca}`)
    await todoSubido(h.page)
    // Tiene que haber PEDIDO de verdad: sin un pull con el cursor del proyecto, "no ve nada"
    // sería cierto por no haber preguntado.
    const antes = Number(sql(`select pull_count from devices where id = '${cC.deviceId}'`))
    expect(await hastaQueTenga(h.page, cC, marca, a.deEquipo, 12_000)).toBe(false)
    expect(Number(sql(`select pull_count from devices where id = '${cC.deviceId}'`))).toBeGreaterThan(antes)
    expect((await loQueTiene(h.page, marca)).map((m) => m.title)).toEqual([`Nota propia del de afuera ${marca}`])
  } finally {
    if (h) await h.page.screenshot({ path: join(SHOTS, 'zz-1-final.png') }).catch(() => {})
    if (h) await teardown(h)
  }
})

// El caso que el camino feliz tapa por construcción. `project_seq` lo cuenta el servicio POR
// PROYECTO (y el de A y el de B son dos proyectos distintos con la misma `project_key`), pero
// cada instalación guarda UN cursor por `project_key`. Un compañero que ya escribió más
// memorias propias en ese repo que las que lleva el autor tiene su cursor por delante del
// `project_seq` de la fila de equipo.
test('un compañero que ya tiene MÁS memorias propias en ese repo también recibe la de equipo', async () => {
  const marca = `cu${Date.now()}`
  const teamId = randomUUID()
  const cA = cuentaNueva(marca, 'autor')
  const cB = cuentaNueva(marca, 'companero')
  hacerMiembro(cA, teamId)
  hacerMiembro(cB, teamId)

  let a: Harness | null = null
  let b: Harness | null = null
  try {
    // B primero, y con ventaja: 6 memorias propias ya sincronizadas (subidas Y vueltas a bajar,
    // que es lo que adelanta su cursor).
    b = await launchHarness()
    apuntarAlRemoto(b.repoDir, marca)
    await conectar(b.page, cB)
    for (let i = 1; i <= 6; i++) await guardar(b.page, b.repoDir, `Nota propia ${i} del companero ${marca}`)
    await todoSubido(b.page)
    await conectar(b.page, cB)
    await b.page.waitForTimeout(4_000)

    a = await launchHarness()
    apuntarAlRemoto(a.repoDir, marca)
    await conectar(a.page, cA)
    const r = await autorComparteYPromueve(a, teamId, marca)

    const seqDeEquipo = filaEnElServicio(r.syncIdEquipo)!.seq
    const seqMaxDeB = Number(sql(`select coalesce(max(o.project_seq), 0) from observations o join projects p on p.id = o.project_id
                                   where p.user_id = '${cB.userId}' and p.project_key = '${r.projectKey}'`))
    const llego = await hastaQueTenga(b.page, cB, marca, r.deEquipo, 45_000)
    expect(llego, `la fila de equipo tiene project_seq=${seqDeEquipo} en el proyecto del autor; ` +
      `el compañero ya iba por project_seq=${seqMaxDeB} en el suyo (misma project_key, un solo cursor)`).toBe(true)
  } finally {
    if (b) await b.page.screenshot({ path: join(SHOTS, 'zz-2-companero-final.png') }).catch(() => {})
    if (a) await teardown(a)
    if (b) await teardown(b)
  }
})

// Decisión §9.1 de la spec de cifrado: el scope `team` NO se cifra. Si la promoción subiera
// la fila con la clave del autor, el compañero —otra cuenta, otra clave— bajaría algo que no
// puede abrir. Y al revés: la personal del autor tiene que seguir viajando cifrada.
test('con el cifrado activo en el autor, la de equipo viaja en claro y la personal no', async () => {
  const marca = `ci${Date.now()}`
  const teamId = randomUUID()
  const cA = cuentaNueva(marca, 'autor')
  const cB = cuentaNueva(marca, 'companero')
  hacerMiembro(cA, teamId)
  hacerMiembro(cB, teamId)

  let h: Harness | null = null
  try {
    h = await launchHarness()
    apuntarAlRemoto(h.repoDir, marca)
    await conectar(h.page, cA)
    const act = await h.page.evaluate(() =>
      (window as unknown as { memory: { encryptionActivate(): Promise<{ ok: boolean; error?: string }> } }).memory.encryptionActivate())
    expect(act.ok, `encryptionActivate: ${act.error}`).toBe(true)

    const a = await autorComparteYPromueve(h, teamId, marca)
    expect(filaEnElServicio(a.syncIdPersonal)!.title).toMatch(/^nmc1:/)
    expect(filaEnElServicio(a.syncIdEquipo)!.title, 'la fila de equipo tiene que estar en claro en el servicio').toBe(a.deEquipo)
    // Ni la marca de la personal en ningún lado legible del servicio.
    expect(sql(`select count(*) from observations where title like '%personal del autor ${marca}%' or content like '%personal del autor ${marca}%'`)).toBe('0')
    await teardown(h); h = null

    h = await launchHarness()
    apuntarAlRemoto(h.repoDir, marca)
    await conectar(h.page, cB)
    await guardar(h.page, h.repoDir, `Nota propia del companero ${marca}`)
    await todoSubido(h.page)
    expect(await hastaQueTenga(h.page, cB, marca, a.deEquipo), 'la memoria de equipo nunca llegó al compañero').toBe(true)
    await abrirMemories(h.page)
    await expect(h.page.getByText(a.deEquipo).first()).toBeVisible({ timeout: 20_000 })
    await h.page.screenshot({ path: join(SHOTS, '03-companero-con-autor-cifrado.png') })
  } finally {
    if (h) await h.page.screenshot({ path: join(SHOTS, 'zz-3-final.png') }).catch(() => {})
    if (h) await teardown(h)
  }
})
