// El cifrado de EQUIPO en la app real, de punta a punta: migración retroactiva, autorización
// del compañero y lectura en claro — con un servicio de verdad.
//
// Hermano de `e2e/13-equipo-dos-cuentas.spec.ts` (de ahí vienen la mayoría de los helpers,
// copiados tal cual porque no están exportados) y de `e2e/12-cifrado-dos-maquinas.spec.ts`
// (de ahí el patrón de activar/autorizar/adoptar, pero acá por `teamId` y por IPC directo en
// vez de clicks en la tarjeta — `TeamEncryptionCard` depende de `useTeam()`/Supabase, que este
// harness no tiene).
//
// Todo lo que este test llama por IPC real (`window.memory.teamEncryption*`) exige cifrado
// PERSONAL activo primero en quien llama (spec §2: ver el comentario en
// `memory:teamEncryption:activate` de `electron/main.ts`) — por eso A y B activan el cifrado
// personal antes de tocar nada de equipo.
//
// `teamMasterKeys` (electron/main.ts) es un Map EN MEMORIA, nunca persistido: cada relanzamiento
// de la app pierde la clave de equipo. Desde Task 14 NO hace falta pedirla a mano: el primer
// `status` de cada arranque trae `encrypted_teams` con `has_wrap`, y main.ts la readopta sola
// (`readoptarClavesDeEquipo`) antes del pull y del push de ese drain. El par de
// dispositivo (`keys.bin`) sí persiste en disco bajo RAVEN_HOME — así que este test, a
// diferencia de e2e/13, necesita conservar la identidad local de A y de B entre sus dos
// lanzamientos cada uno: un `RAVEN_HOME` nuevo generaría un par de dispositivo nuevo, que no
// puede abrir la envoltura que el leader selló para el par VIEJO. Y no alcanza con pasar el
// mismo `RAVEN_HOME` por `env` a un `homeDir` efímero nuevo: `safeStorage` en Windows deriva su
// clave de cifrado de `--user-data-dir` (Chromium guarda ahí, en `Local State`, la clave que
// DPAPI protege) y no sólo de la cuenta de Windows, así que un `userDataDir` nuevo deja
// indescifrable el `keys.bin` que el lanzamiento anterior escribió. `launchHarness({ homeDir })`
// + `teardown(h, { keepHomeDir: true })` (agregado a `e2e/helpers/harness.ts` para este test)
// reusan el mismo `homeDir` real y, con él, el mismo `userDataDir` derivado.
//
// Se saltea si no le pasan un servicio. Para correrlo (ver `e2e/13-equipo-dos-cuentas.spec.ts`
// y `server/README.md`):
//
//   docker start nest-memory-pg
//   (cd server && PORT=8099 npx tsx src/index.ts)
//   npm run build
//   NEST_E2E_SYNC_URL=http://127.0.0.1:8099 NEST_E2E_PG_DOCKER=nest-memory-pg \
//     npx playwright test e2e/16-cifrado-de-equipo.spec.ts
import { test, expect, type Page } from '@playwright/test'
import { launchHarness, teardown, type Harness } from './helpers/harness'
import { execFileSync, spawn } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'

const SYNC_URL = process.env.NEST_E2E_SYNC_URL
const PG_DOCKER = process.env.NEST_E2E_PG_DOCKER
const DATABASE_URL = process.env.NEST_E2E_DATABASE_URL ?? 'postgres://postgres:nestmem@127.0.0.1:55432/nest_memory'

const REPO = join(__dirname, '..')
const PAQUETE = join(REPO, 'packages', 'nest-memory')
const CLI = join(PAQUETE, 'dist', 'cli-del-paquete.js')
const SHOTS = join(REPO, 'test-results', 'cifrado-de-equipo')
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

/** Una cuenta nueva con plan `team` y un device, con el mismo script que se usa en la beta.
 *  Copiado tal cual de e2e/13 (no está exportado ahí). */
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

/** Variante de `hacerMiembro` de e2e/13 con `role` parametrizable: ese helper siempre pone
 *  `'member'`, y este test necesita que A sea `'leader'` de verdad para que el chequeo
 *  `isTeamLeader` del servidor (server/src/team-keys.ts) la deje activar/autorizar/re-cifrar. */
function hacerMiembroConRol(c: Cuenta, teamId: string, role: 'leader' | 'member'): void {
  sql(`insert into team_memberships (user_id, team_id, team_name, role, status)
       values ('${c.userId}', '${teamId}', 'Equipo e2e cifrado', '${role}', 'active')`)
}

/** El mismo remoto en dos carpetas distintas: dos clones del mismo repo. Copiado de e2e/13. */
function apuntarAlRemoto(repoDir: string, marca: string): void {
  execFileSync('git', ['remote', 'add', 'origin', `https://github.com/nest-e2e/cifrado-${marca}.git`], { cwd: repoDir })
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

/** `memory_promote` como lo llama un agente: por el MCP del paquete, que le delega a Nest.
 *  Copiado tal cual de e2e/13 (no está exportado ahí). */
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
    const r = await rpc('tools/call', { name: 'memory_promote', arguments: { sync_id: syncId, reason: 'e2e de cifrado de equipo' } })
    expect(r.error, stderr).toBeUndefined()
    return JSON.stringify(r.result)
  } finally {
    p.stdin.end()
  }
}

/**
 * I2 (review de Tasks 13–14): escribe una memoria de EQUIPO en la base local de una instalación
 * CERRADA, con el `MemoryStore` real (el del paquete compilado, sobre `node:sqlite`), para que
 * esté en el `mutation_log` desde ANTES de que la app arranque. Así el chequeo de §9.4 no
 * depende de cuándo cae un `guardar` respecto de la readopción: la fila ya está en la cola en
 * el instante cero, y el primer push que pueda salir la ve.
 *
 * No por el MCP del paquete: con Nest cerrado escribe en la base de Nest (modo `nest`) SIN
 * declarar la cuenta (`setCurrentUser`), y en una instalación con cuenta la fila queda con
 * `author_user_id = null` en un store con dueño: `pendingMutations()` de la app no la ofrece (es
 * una fila "sin reclamar", `countUnclaimedRows`). En este harness no muerde (no hay `setUser`),
 * pero el test no tiene por qué depender de eso; acá se declara el dueño que el store ya tenga.
 */
function escribirDeEquipoConLaAppCerrada(homeDir: string, projectKey: string, title: string): string {
  const dist = join(PAQUETE, 'dist').replace(/\\/g, '/')
  const script = `
    require('${dist}/silenciar-aviso-sqlite')
    require('${dist}/sqlite-motor').usarAbridorPorDefecto(require('${dist}/sqlite-sin-compilar').abrirBase)
    const ptr = require('${dist}/memory-active-store').readActivePointer(process.env.RAVEN_HOME)
    if (!ptr) throw new Error('sin puntero a la base activa en ' + process.env.RAVEN_HOME)
    const { MemoryStore } = require('${dist}/memory-store')
    const store = new MemoryStore(ptr.storePath)
    try {
      // La cuenta que la app ya declaró sobre este store (null en el harness, que no hace
      // \`memory:setUser\`): declarar OTRA reclamaría el store y la app dejaría de ver la cola.
      store.setCurrentUser(store.getOwnerUserId())
      const r = store.save({ projectKey: process.env.E2E_PK, scope: 'personal', type: 'decision',
        title: process.env.E2E_TITLE, content: 'Contenido de: ' + process.env.E2E_TITLE, source: 'mcp' })
      const p = store.promoteToTeam(r.syncId, 'e2e: escrita con la app cerrada')
      if (!p.promoted) throw new Error('no se pudo promover ' + r.syncId)
      process.stdout.write(r.syncId)
    } finally {
      store.close()
    }`
  return execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, RAVEN_HOME: homeDir, E2E_PK: projectKey, E2E_TITLE: title, NODE_NO_WARNINGS: '1' },
  }).trim()
}

async function abrirMemories(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await page.getByTitle(/^Memories/).first().click()
  await expect(page.locator('.memories-workspace')).toBeVisible({ timeout: 15_000 })
}

/** La fila en el servicio, mirada en su base. Copiado de e2e/13. */
function filaEnElServicio(syncId: string): { scope: string; seq: number; title: string } | null {
  const r = sql(`select scope || '|' || project_seq || '|' || title from observations where sync_id = '${syncId}'`)
  if (!r) return null
  const [scope, seq, ...resto] = r.split('|')
  return { scope, seq: Number(seq), title: resto.join('|') }
}

/** Lo que la base LOCAL de esta instalación tiene con esa marca: título y scope. Copiado de e2e/13. */
async function loQueTiene(page: Page, marca: string): Promise<Array<{ title: string; scope: string }>> {
  return page.evaluate(async (q) => {
    const r = await (window as unknown as { memory: { crossProject(i: unknown): Promise<{ items: Array<{ title: string; scope: string }> }> } })
      .memory.crossProject({ query: q, limit: 50 })
    return r.items.map((i) => ({ title: i.title, scope: i.scope }))
  }, marca)
}

/**
 * Reconectar es la forma de pedirle al daemon un ciclo entero AHORA (status → pull → push):
 * `memory:connect` termina en `onNetworkRegain()`. Copiado de e2e/13.
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

/** El autor: guarda una personal y una que promueve, comparte el proyecto y espera a que suba.
 *  Copiado tal cual de e2e/13 (no está exportado ahí). */
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
  expect(filaEnElServicio(syncIdPersonal)?.scope).toBe('personal')
  return { deEquipo, personal, syncIdEquipo, syncIdPersonal, projectKey }
}

/** El cifrado personal es precondición de todo lo de equipo (spec §2, ver el comentario en
 *  `memory:teamEncryption:activate` de electron/main.ts): sin maestra PERSONAL activa, el
 *  servidor rechaza activar/adoptar/autorizar/re-cifrar de equipo. */
async function activarCifradoPersonal(page: Page): Promise<void> {
  const r = await page.evaluate(() =>
    (window as unknown as { memory: { encryptionActivate(): Promise<{ ok: boolean; error?: string }> } }).memory.encryptionActivate())
  // "ya está activado, esta máquina queda autorizada" es un resultado válido (adoptExistingKey
  // internamente) si por algún motivo la cuenta ya tenía cifrado — no pasa en cuentas nuevas,
  // pero no hace falta que el test lo distinga: lo único que importa es `memoryKeys.master`
  // quedando seteado, y eso pasa en los dos casos.
  expect(r.ok || /already has encryption on/.test(r.error ?? ''), `encryptionActivate: ${r.error}`).toBeTruthy()
}

async function teamEncryptionActivate(page: Page, teamId: string): Promise<{ ok: boolean; recoveryCode?: string; error?: string }> {
  return page.evaluate((tid) =>
    (window as unknown as { memory: { teamEncryptionActivate(t: string): Promise<{ ok: boolean; recoveryCode?: string; error?: string }> } })
      .memory.teamEncryptionActivate(tid), teamId)
}

interface EstadoDeEquipo {
  activated: boolean; hasMaster: boolean; estadoRemotoLeido: boolean
  pendingDevices: Array<{ deviceId: string; name: string; publicKey: string }>
  /** La huella del par de ESTE device: lo que el compañero le dicta al leader por fuera. */
  huellaPropia: string | null
  /** La huella de cada device pendiente, calculada del lado del leader. */
  huellasPorDevice: Record<string, string>
}

async function teamEncryptionStatus(page: Page, teamId: string): Promise<EstadoDeEquipo> {
  return page.evaluate((tid) =>
    (window as unknown as { memory: { teamEncryptionStatus(t: string): Promise<EstadoDeEquipo> } })
      .memory.teamEncryptionStatus(tid), teamId)
}

async function teamEncryptionRecrypt(page: Page, teamId: string): Promise<{ total: number; applied: number; rejected: number; error?: string }> {
  return page.evaluate((tid) =>
    (window as unknown as { memory: { teamEncryptionRecrypt(t: string): Promise<{ total: number; applied: number; rejected: number; error?: string }> } })
      .memory.teamEncryptionRecrypt(tid), teamId)
}

async function teamEncryptionAuthorize(page: Page, teamId: string, deviceId: string): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate(({ tid, dev }) =>
    (window as unknown as { memory: { teamEncryptionAuthorize(t: string, d: string): Promise<{ ok: boolean; error?: string }> } })
      .memory.teamEncryptionAuthorize(tid, dev), { tid: teamId, dev: deviceId })
}

/**
 * El escenario entero. B NUNCA comparte su copia del proyecto: ése es el caso normal (el de
 * e2e/13), y lee la memoria de equipo porque el servidor manda el `team_id` en cada fila de
 * equipo del pull y el cliente elige la clave por ése (Task 14), no por su `projects.team_id`
 * local, que sólo existe en la máquina que compartió.
 *
 * Y nadie llama `teamEncryptionAdopt` a mano en los relanzamientos: la readopción de arranque
 * (Task 14) la hace sola. El chequeo de §9.4 es una memoria de equipo escrita APENAS arranca
 * la app del leader, que tiene que llegar cifrada al servicio.
 */
async function escenario(): Promise<void> {
  const marca = `ce${Date.now()}`
  const teamId = randomUUID()
  const cA = cuentaNueva(marca, 'leader')
  const cB = cuentaNueva(marca, 'companero')
  hacerMiembroConRol(cA, teamId, 'leader')
  hacerMiembroConRol(cB, teamId, 'member')

  let h: Harness | null = null
  let homeDirA = ''
  let homeDirB = ''
  const posArranque = `Decision post-arranque ${marca}`
  try {
    // ── A (leader): guarda, comparte, promueve — TODO en claro, antes de activar nada ──
    h = await launchHarness()
    apuntarAlRemoto(h.repoDir, marca)
    await conectar(h.page, cA)
    await activarCifradoPersonal(h.page)
    const a = await autorComparteYPromueve(h, teamId, marca)
    expect(filaEnElServicio(a.syncIdEquipo)?.title).toBe(a.deEquipo) // todavía en claro

    // Reconectar fuerza un ciclo status→pull→push nuevo. El primer `conectar()` corrió ANTES
    // de que este proyecto existiera en el servicio, así que su roster no lo traía; éste sí.
    await conectar(h.page, cA)

    // ── Activar el cifrado de EQUIPO (IPC real) ──────────────────────────────────
    const act = await teamEncryptionActivate(h.page, teamId)
    expect(act.ok, `teamEncryptionActivate: ${act.error}`).toBe(true)
    expect(act.recoveryCode).toBeTruthy()

    // ── Migrar lo que ya estaba (IPC real, sobre la ruta HTTP real) ──────────────
    // `projects.team_id` local llega solo: el roster de `/v1/sync/status` trae el team_id de
    // cada proyecto propio y `doStatus` lo copia (Task 14). Antes había que repetir el share a
    // mano. La migración lo necesita (`localTeamRowsForTeam` filtra por él) y el drain de
    // `conectar` corre en segundo plano, así que se reintenta. Un intento con 0 filas no pega
    // al servidor (`runTeamRecrypt` no hace request sin filas).
    const paginaA = h.page
    let migr: Awaited<ReturnType<typeof teamEncryptionRecrypt>> = { total: 0, applied: 0, rejected: 0 }
    await expect.poll(async () => { migr = await teamEncryptionRecrypt(paginaA, teamId); return migr.applied }, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1)
    expect(migr.error, JSON.stringify(migr)).toBeUndefined()

    // En el SERVICIO, la fila de equipo ahora tiene que estar cifrada de verdad, y el texto
    // no puede quedar legible en ningún lado de la tabla.
    expect(filaEnElServicio(a.syncIdEquipo)!.title).toMatch(/^nmc1:/)
    expect(sql(`select count(*) from observations where title like '%${a.deEquipo}%' or content like '%${a.deEquipo}%'`)).toBe('0')

    await h.page.screenshot({ path: join(SHOTS, '01-leader-migro.png') })
    homeDirA = h.homeDir
    await teardown(h, { keepHomeDir: true }); h = null

    // ── B (member) se conecta: todavía no está autorizado ────────────────────────
    h = await launchHarness()
    apuntarAlRemoto(h.repoDir, marca)
    await conectar(h.page, cB)
    // El cifrado personal de B, requisito para que B pueda ADOPTAR la clave de equipo más
    // adelante (mismo gate que para A) — y de paso publica la clave pública de SU device,
    // que es la precondición para que A la vea en `pendingDevices`.
    await activarCifradoPersonal(h.page)
    await guardar(h.page, h.repoDir, `Nota propia del companero ${marca}`)
    await todoSubido(h.page)

    const estadoAntes = await teamEncryptionStatus(h.page, teamId)
    expect(estadoAntes.estadoRemotoLeido).toBe(true)
    expect(estadoAntes.activated).toBe(true)
    expect(estadoAntes.hasMaster).toBe(false)
    // Lo que B le dictaría al leader por un canal aparte.
    const huellaQueDictaB = estadoAntes.huellaPropia
    expect(huellaQueDictaB).toBeTruthy()
    // Y sin la clave, la fila de equipo no puede aparecer en claro en B.
    expect((await loQueTiene(h.page, marca)).map((m) => m.title)).not.toContain(a.deEquipo)
    await h.page.screenshot({ path: join(SHOTS, '02-companero-sin-autorizar.png') })
    homeDirB = h.homeDir
    await teardown(h, { keepHomeDir: true }); h = null

    // ── A (leader) vuelve: recupera su clave de equipo y autoriza a B ────────────
    // §9.4: una memoria de equipo que ya está en la cola cuando la app arranca, sin abrir la
    // tarjeta ni llamar `teamEncryptionAdopt`. Antes de Task 14 subía EN CLARO (la clave de
    // equipo vive sólo en memoria y nadie la readoptaba hasta que se montaba la tarjeta).
    // Se escribe con la app CERRADA (ver `escribirDeEquipoConLaAppCerrada`): cae en la ventana de
    // arranque por construcción, no por timing.
    const syncIdPosArranque = escribirDeEquipoConLaAppCerrada(homeDirA, a.projectKey, posArranque)
    expect(syncIdPosArranque).toBeTruthy()

    h = await launchHarness({ homeDir: homeDirA })
    apuntarAlRemoto(h.repoDir, marca) // mismo remoto → mismo project_key que antes
    await conectar(h.page, cA)

    // Que no quedó guardada no prueba que no SALIÓ: un push en claro a un equipo que cifra el
    // servidor lo rechaza sin guardarlo (`team_encryption_required`), y lo único que queda es el
    // registro del rechazo. Por eso el poll también lo mira: un envío en claro se ve como
    // 'rechazada', no como un timeout sin explicación.
    const rechazosPosArranque = (): number => Number(sql(`select count(*) from rejected_pushes where sync_id = '${syncIdPosArranque}'`))
    await expect.poll(() => (rechazosPosArranque() > 0 ? 'rechazada' : filaEnElServicio(syncIdPosArranque)?.scope), { timeout: 60_000 }).toBe('team')
    expect(filaEnElServicio(syncIdPosArranque)!.title).toMatch(/^nmc1:/)
    expect(sql(`select count(*) from observations where title like '%${posArranque}%' or content like '%${posArranque}%'`)).toBe('0')
    expect(rechazosPosArranque(), 'la fila pos-arranque viajó en claro y el servidor la rechazó').toBe(0)

    const paginaA2 = h.page
    await expect.poll(async () => (await teamEncryptionStatus(paginaA2, teamId)).hasMaster, { timeout: 30_000 }).toBe(true)

    const estadoDeB = await teamEncryptionStatus(h.page, teamId)
    const deviceDeB = estadoDeB.pendingDevices.find((d) => d.deviceId === cB.deviceId)
    expect(deviceDeB, `B no aparece en pendingDevices: ${JSON.stringify(estadoDeB.pendingDevices)}`).toBeTruthy()
    // La verificación de huella: el leader sólo autoriza si lo que ve coincide con lo que B
    // le dictó. Es lo que impide que una clave pública inyectada se lleve la maestra.
    expect(estadoDeB.huellasPorDevice[cB.deviceId], 'la huella que ve el leader no es la que dicta B').toBe(huellaQueDictaB)

    const auth = await teamEncryptionAuthorize(h.page, teamId, deviceDeB!.deviceId)
    expect(auth.ok, `teamEncryptionAuthorize: ${auth.error}`).toBe(true)
    await h.page.screenshot({ path: join(SHOTS, '03-leader-autorizo.png') })
    await teardown(h); h = null

    // ── B vuelve: adopta la clave y lee la memoria de equipo EN CLARO en pantalla ─
    h = await launchHarness({ homeDir: homeDirB })
    apuntarAlRemoto(h.repoDir, marca)
    await conectar(h.page, cB)
    const paginaB = h.page
    // Sin `teamEncryptionAdopt`: el status de arranque dice `has_wrap: true` y main.ts la readopta.
    await expect.poll(async () => (await teamEncryptionStatus(paginaB, teamId)).hasMaster, { timeout: 30_000 }).toBe(true)
    expect(await hastaQueTenga(h.page, cB, marca, a.deEquipo, 30_000), 'la memoria de equipo nunca llegó en claro al compañero').toBe(true)
    expect(await hastaQueTenga(h.page, cB, marca, posArranque, 30_000), 'la memoria pos-arranque tampoco').toBe(true)
    const enB = await loQueTiene(h.page, marca)
    expect(enB.find((m) => m.title === a.deEquipo)?.scope).toBe('team')
    expect(enB.map((m) => m.title)).not.toContain(a.personal)

    await abrirMemories(h.page)
    await expect(h.page.getByText(a.deEquipo).first()).toBeVisible({ timeout: 20_000 })
    await h.page.screenshot({ path: join(SHOTS, '04-companero-lee-en-claro.png') })

    // Y la nube, al final de todo, sigue sin el texto legible.
    expect(filaEnElServicio(a.syncIdEquipo)!.title).toMatch(/^nmc1:/)
    expect(sql(`select count(*) from observations where title like '%${a.deEquipo}%' or content like '%${a.deEquipo}%'`)).toBe('0')
  } finally {
    if (h) await h.page.screenshot({ path: join(SHOTS, 'zz-final.png') }).catch(() => {})
    if (h) await teardown(h)
    // Los homeDir que se conservaron entre lanzamientos: nadie más los va a reusar.
    for (const d of [homeDirA, homeDirB]) {
      if (d) try { rmSync(d, { recursive: true, force: true }) } catch {}
    }
  }
}

test('cifrado de equipo: migra lo viejo, el compañero lee en claro SIN compartir su copia, y nada sale en claro al arrancar', async () => {
  await escenario()
})
