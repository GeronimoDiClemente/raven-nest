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
//   # dos devices de la MISMA cuenta, con `server/scripts/mint-device-token.mjs`:
//   #   --out <dir>/a.txt y --out <dir>/b.txt, y sus device_id en <dir>/a.id y <dir>/b.id
//   npm run build
//   NEST_E2E_SYNC_URL=http://127.0.0.1:8099 NEST_E2E_TOKENS_DIR=<dir> \
//     NEST_E2E_PG_DOCKER=nest-memory-pg npx playwright test e2e/12-cifrado-dos-maquinas.spec.ts
//
// Lo único que NO pasa por la app es emitir el token: el camino de producto lo pide con el
// login de Supabase, y eso no existe contra un servicio local. Todo lo demás —apuntar al
// servicio, conectar, activar, autorizar, adoptar, bajar— es la app.
import { test, expect, type Page } from '@playwright/test'
import { launchHarness, teardown, type Harness } from './helpers/harness'
import { execFileSync } from 'child_process'
import { mkdirSync, readFileSync } from 'fs'
import { join } from 'path'

const SYNC_URL = process.env.NEST_E2E_SYNC_URL
const TOKENS = process.env.NEST_E2E_TOKENS_DIR
const PG_DOCKER = process.env.NEST_E2E_PG_DOCKER

const SHOTS = join(__dirname, '..', 'test-results', 'cifrado-dos-maquinas')
mkdirSync(SHOTS, { recursive: true })

test.skip(!SYNC_URL || !TOKENS, 'necesita NEST_E2E_SYNC_URL y NEST_E2E_TOKENS_DIR (ver el encabezado)')
test.setTimeout(240_000)

const leer = (archivo: string): string => readFileSync(join(TOKENS!, archivo), 'utf8').trim()

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

/** Con el Back del overlay: Escape no lo cierra (el foco puede estar en cualquier lado). */
async function cerrarMemories(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Back/ }).first().click()
  await expect(page.locator('.memories-workspace')).toHaveCount(0)
}

async function estado(page: Page): Promise<{ pendingCount: number; daemonStatus: string; daemonStatusDetail?: string }> {
  return page.evaluate(() =>
    (window as unknown as { memory: { status(): Promise<{ pendingCount: number; daemonStatus: string; daemonStatusDetail?: string }> } })
      .memory.status())
}

test('dos máquinas: A activa el cifrado, B no lee hasta que A la autoriza, y después lee en claro', async () => {
  const marca = `e2e-${Date.now()}`
  const secreto = `La contraseña del bunker es rosebud (${marca})`
  let a: Harness | null = null
  let b: Harness | null = null
  try {
    // ── Máquina A ──────────────────────────────────────────────────────────────
    a = await launchHarness({ withRepo: false })
    await conectar(a.page, leer('a.txt'), leer('a.id'))
    await abrirMemories(a.page)

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
    await conectar(b.page, leer('b.txt'), leer('b.id'))
    await abrirMemories(b.page)
    await expect(b.page.getByText('This machine is not authorised yet')).toBeVisible({ timeout: 60_000 })
    const huellaB = (await b.page.locator('p.select-all').first().innerText()).trim()
    expect(huellaB).not.toBe('')
    await b.page.screenshot({ path: join(SHOTS, '03-b-sin-autorizar.png') })
    // Sin la clave, B no puede tener el secreto en claro en ningún lado de la pantalla.
    await expect(b.page.getByText(marca)).toHaveCount(0)

    // ── A autoriza a B, comparando la huella como pide la tarjeta ─────────────
    await cerrarMemories(a.page)
    await abrirMemories(a.page)
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
