// El cifrado de Memories en la APP REAL, con dos máquinas y un servicio de verdad.
//
// `scripts/smoke-cifrado-e2e.mjs` prueba el cable entre las piezas (store, daemon, cliente de
// claves) armándolas a mano. Esto prueba lo que ese smoke no ve: que la app de Electron, con su
// main.ts, su preload y la tarjeta de cifrado del overlay Memories, hace el mismo recorrido
// cuando lo maneja una persona. Dos instancias, cada una con su `RAVEN_HOME` y su `userData`
// —dos máquinas para todo lo que importa acá: base, llavero, par de dispositivo y candado—.
//
// Se saltea si no le pasan un servicio. Para correrlo (ver `server/README.md`):
//
//   docker start nest-memory-pg
//   (cd server && PORT=8099 npx tsx src/index.ts)
//   npm run build
//   NEST_E2E_SYNC_URL=http://127.0.0.1:8099 NEST_E2E_PG_DOCKER=nest-memory-pg \
//     npx playwright test e2e/12-cifrado-dos-maquinas.spec.ts
//
// Review final de rama, H: hasta acá ESTE archivo pedía `NEST_E2E_TOKENS_DIR` con dos
// devices YA minteados a mano, de una cuenta fija. El cifrado que activa es un cambio DE UN
// SOLO SENTIDO del lado del servidor (una vez `active` para esa cuenta, se queda así) — así
// que un segundo run contra la MISMA cuenta encontraba la tarjeta ya en «Encryption on», sin
// el botón «Turn on encryption» que el test busca primero, y se caía en rojo sin que hubiera
// ninguna regresión real. Ahora mintea una cuenta NUEVA por corrida (igual que
// `e2e/16-cifrado-de-equipo.spec.ts`'s `cuentaNueva`, mismo script) — dos devices (`a`, `b`)
// del MISMO email nuevo, así que siguen siendo la MISMA cuenta vista desde dos máquinas, que
// es lo que el test necesita, pero una cuenta que nadie usó todavía.
import { test, expect, type Page } from '@playwright/test'
import { launchHarness, teardown, type Harness } from './helpers/harness'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'

const SYNC_URL = process.env.NEST_E2E_SYNC_URL
const PG_DOCKER = process.env.NEST_E2E_PG_DOCKER
const DATABASE_URL = process.env.NEST_E2E_DATABASE_URL ?? 'postgres://postgres:nestmem@127.0.0.1:55432/nest_memory'

const REPO = join(__dirname, '..')
const SHOTS = join(REPO, 'test-results', 'cifrado-dos-maquinas')
mkdirSync(SHOTS, { recursive: true })

test.skip(!SYNC_URL, 'necesita NEST_E2E_SYNC_URL (ver el encabezado)')
test.setTimeout(240_000)

interface Device { deviceId: string; token: string }

/** Un device nuevo para `email` — llamado dos veces con el MISMO email (y `--device`
 *  distinto) da dos devices de UNA cuenta, que es lo que A/B necesitan acá. Copiado del
 *  patrón de `cuentaNueva` en e2e/16-cifrado-de-equipo.spec.ts (mismo script, mint-device-
 *  token.mjs resuelve por email: existente → reusa el user_id, no crea una cuenta nueva). */
function device(email: string, quien: string): Device {
  const dir = mkdtempSync(join(tmpdir(), 'nest-e2e-cifrado-'))
  const out = join(dir, 'token.txt')
  const salida = execFileSync(process.execPath, [
    join(REPO, 'server', 'scripts', 'mint-device-token.mjs'),
    '--email', email, '--device', `e2e-${quien}`, '--plan', 'pro', '--out', out,
  ], { encoding: 'utf8', env: { ...process.env, DATABASE_URL }, cwd: join(REPO, 'server') })
  const campo = (k: string): string => salida.match(new RegExp(`^${k}=(.+)$`, 'm'))![1].trim()
  return { deviceId: campo('device_id'), token: readFileSync(out, 'utf8').trim() }
}

/** Lo que ve el servicio, mirado en su base: es lo único que prueba que no viaja nada legible. */
function sql(q: string): string {
  return execFileSync('docker', ['exec', '-i', PG_DOCKER!, 'psql', '-U', 'postgres', '-d', 'nest_memory', '-t', '-A', '-c', q], {
    encoding: 'utf8',
  }).trim()
}

async function conectar(page: Page, token: string, deviceId: string): Promise<void> {
  const r = await page.evaluate(async ({ url, token, deviceId }) => {
    const m = (window as unknown as { memory: Record<string, (...a: unknown[]) => Promise<unknown>> }).memory
    const svc = await m.setSyncService(url)
    const con = await m.connect(token, deviceId)
    return { svc, con }
  }, { url: SYNC_URL!, token, deviceId })
  expect((r.svc as { ok: boolean }).ok, JSON.stringify(r.svc)).toBe(true)
  expect((r.con as { ok?: boolean }).ok ?? true, JSON.stringify(r.con)).toBe(true)
}

/** Abre el overlay Memories desde la fila de la sidebar, como una persona. */
async function abrirMemories(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await page.getByTitle(/^Memories/).first().click()
}

/** La tarjeta de cifrado ya no vive en la vista principal del overlay: se mudó a Memory
 *  settings → Encryption (Task 5). Cada apertura nueva del overlay arranca en la vista
 *  principal, así que hay que navegar de nuevo aunque sea la segunda vez que se abre. */
async function abrirEncryption(page: Page): Promise<void> {
  await abrirMemories(page)
  await page.getByRole('button', { name: 'Memory settings' }).click()
  await page.getByRole('button', { name: /Encryption/ }).click()
}

/** Con el Back del overlay: Escape no lo cierra (el foco puede estar en cualquier lado).
 *  Si quedó en la vista de settings, primero hay que volver a la principal — ahí el mismo
 *  botón se llama "Memories", no "Back". */
async function cerrarMemories(page: Page): Promise<void> {
  // Anclado a `.memories-workspace`: sin esto "Memories" también matchea la fila de la
  // sidebar (su title es "Memories · N items · ..."), que Playwright lee como nombre
  // accesible por substring. `exact: true` además separa el Back de "How Memories works".
  const overlay = page.locator('.memories-workspace')
  const backDeSettings = overlay.getByRole('button', { name: 'Memories', exact: true })
  if (await backDeSettings.count()) await backDeSettings.click()
  await overlay.getByRole('button', { name: /Back/ }).first().click()
  await expect(overlay).toHaveCount(0)
}

async function estado(page: Page): Promise<{ pendingCount: number; daemonStatus: string; daemonStatusDetail?: string }> {
  return page.evaluate(() =>
    (window as unknown as { memory: { status(): Promise<{ pendingCount: number; daemonStatus: string; daemonStatusDetail?: string }> } })
      .memory.status())
}

test('dos máquinas: A activa el cifrado, B no lee hasta que A la autoriza, y después lee en claro', async () => {
  // `randomUUID` además de `Date.now()`: dos runs arrancados en el mismo milisegundo (CI en
  // paralelo) no pueden terminar compartiendo el email y, con él, una cuenta a medio activar
  // que el otro run ya tocó.
  const marca = `e2e-${Date.now()}-${randomUUID().slice(0, 8)}`
  const secreto = `La contraseña del bunker es rosebud (${marca})`
  const email = `${marca}@e2e.test`
  const deviceA = device(email, 'a')
  const deviceB = device(email, 'b')
  let a: Harness | null = null
  let b: Harness | null = null
  try {
    // ── Máquina A ──────────────────────────────────────────────────────────────
    a = await launchHarness({ withRepo: false })
    await conectar(a.page, deviceA.token, deviceA.deviceId)
    await abrirEncryption(a.page)

    const tarjeta = a.page.getByText('Turn on encryption')
    await expect(tarjeta).toBeVisible({ timeout: 20_000 })
    await a.page.screenshot({ path: join(SHOTS, '01-a-antes-de-activar.png') })
    await tarjeta.click()

    await expect(a.page.getByText('Save this code')).toBeVisible({ timeout: 20_000 })
    await a.page.screenshot({ path: join(SHOTS, '02-a-codigo-de-recuperacion.png') })
    await a.page.getByLabel('I have saved it somewhere safe').check()
    await a.page.getByRole('button', { name: 'Done' }).click()
    await expect(a.page.getByText('Encryption on')).toBeVisible({ timeout: 20_000 })
    const huellaA = await a.page.getByText(/This account key:/).innerText()

    // A escribe, y lo escrito tiene que llegar al servicio CIFRADO.
    const guardado = await a.page.evaluate(async ({ title, content }) =>
      (window as unknown as { memory: { saveFromUi(i: unknown): Promise<{ ok: boolean; error?: string }> } })
        .memory.saveFromUi({ title, content, type: 'decision' }), { title: secreto, content: `Contenido secreto ${marca}` })
    expect(guardado.ok, guardado.error).toBe(true)

    await expect.poll(async () => (await estado(a!.page)).pendingCount, { timeout: 60_000 }).toBe(0)
    if (PG_DOCKER) {
      expect(sql(`select count(*) from observations where title like 'nmc1:%' and server_created_at > now() - interval '5 minutes'`))
        .not.toBe('0')
      // Ni una palabra del secreto en la base del servicio.
      expect(sql(`select count(*) from observations where title like '%${marca}%' or content like '%${marca}%'`)).toBe('0')
    }

    // ── Máquina B, sin autorizar ───────────────────────────────────────────────
    b = await launchHarness({ withRepo: false })
    await conectar(b.page, deviceB.token, deviceB.deviceId)
    await abrirEncryption(b.page)
    await expect(b.page.getByText('This machine is not authorised yet')).toBeVisible({ timeout: 60_000 })
    const huellaB = (await b.page.locator('p.select-all').first().innerText()).trim()
    expect(huellaB).not.toBe('')
    await b.page.screenshot({ path: join(SHOTS, '03-b-sin-autorizar.png') })
    // Sin la clave, B no puede tener el secreto en claro en ningún lado de la pantalla.
    await expect(b.page.getByText(marca)).toHaveCount(0)

    // ── A autoriza a B, comparando la huella como pide la tarjeta ─────────────
    await cerrarMemories(a.page)
    await abrirEncryption(a.page)
    await expect(a.page.getByText('Machines waiting for authorisation:')).toBeVisible({ timeout: 60_000 })
    await expect(a.page.getByText(huellaB, { exact: true })).toBeVisible()
    await a.page.screenshot({ path: join(SHOTS, '04-a-ve-a-b-esperando.png') })
    await a.page.getByRole('button', { name: 'They match — authorise' }).click()
    await expect(a.page.getByText('Machines waiting for authorisation:')).toHaveCount(0, { timeout: 30_000 })

    // ── B adopta y lee ─────────────────────────────────────────────────────────
    await b.page.getByRole('button', { name: "I've been authorised" }).click()
    await expect(b.page.getByText('Encryption on')).toBeVisible({ timeout: 30_000 })
    // Las dos máquinas tienen que mostrar la MISMA clave de cuenta.
    expect(await b.page.getByText(/This account key:/).innerText()).toBe(huellaA)

    // Y lo que A escribió aparece en B, en claro.
    await expect.poll(async () => {
      await cerrarMemories(b!.page)
      await abrirMemories(b!.page)
      return b!.page.getByText(secreto).count()
    }, { timeout: 90_000, intervals: [3_000] }).toBeGreaterThan(0)
    await b.page.screenshot({ path: join(SHOTS, '05-b-lee-en-claro.png') })
  } finally {
    if (a) await a.page.screenshot({ path: join(SHOTS, 'zz-a-final.png') }).catch(() => {})
    if (b) await b.page.screenshot({ path: join(SHOTS, 'zz-b-final.png') }).catch(() => {})
    if (b) await teardown(b)
    if (a) await teardown(a)
  }
})
