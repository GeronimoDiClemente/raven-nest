// Cierra un pendiente que estaba documentado como "excepcion" en el CSS.
//
// `global.css` decia, junto a `.repo-action-btn`, que el boton se quedaba en 26px —
// fuera de la escala 24/28/32 — "porque entra en una fila de 26px", y admitia que no
// se habia podido ver esa fila renderizada: My Repos exige una cuenta GitHub conectada
// de verdad. Una excepcion documentada sobre una premisa que nadie pudo mirar.
//
// La premisa es falsa y este archivo lo prueba midiendo: la fila es `.snippet-item`
// con `flexDirection: column` inline y SIN height — crece con su contenido, que son dos
// lineas de texto (nombre a 13px + path a 10px). El boton nunca fue el que manda.
//
// Se verifica moviendo el boton por la escala EN VIVO y comprobando que el alto de la
// fila no se mueve. Si algun dia la fila si pasa a depender del boton, esto se pone rojo.
import { test, expect } from '@playwright/test'
import { launchHarness, teardown } from './helpers/harness'
import { mkdirSync } from 'fs'
import { join } from 'path'

const SHOTS = join(__dirname, '..', '.superpowers', 'sdd', 'shots', 'repo-row-escala')
mkdirSync(SHOTS, { recursive: true })

// Dos repos: uno con carpeta local (muestra el path y el boton Terminal) y otro sin
// ella (muestra el aviso ambar y el boton Clone). Son los dos estados de la fila.
const SEED = JSON.stringify([
  {
    id: 'e2e-repo-1',
    user_id: 'e2e-user',
    repo_full_name: 'GeronimoDiClemente/raven-nest',
    repo_url: 'https://github.com/GeronimoDiClemente/raven-nest',
    added_at: '2026-09-01T10:00:00.000Z',
    local_path: '/Users/e2e/Projects/raven-nest',
    provider: 'github',
  },
  {
    id: 'e2e-repo-2',
    user_id: 'e2e-user',
    repo_full_name: 'GeronimoDiClemente/sin-carpeta',
    repo_url: 'https://github.com/GeronimoDiClemente/sin-carpeta',
    added_at: '2026-08-20T10:00:00.000Z',
    local_path: null,
    provider: 'github',
  },
])

test('el .repo-action-btn no esta atado al alto de su fila: la excepcion de 26px sobraba', async () => {
  const h = await launchHarness({ withRepo: false, env: { RAVEN_E2E_REPOS: SEED } })
  const { page } = h
  try {
    // El seed simula una cuenta de GitHub conectada con un token centinela. Sin cortar
    // la red, la fila dispara fetches reales a api.github.com (el badge de CI, los
    // permisos del repo) que responderian 401 y harian este test dependiente de
    // internet. Es una prueba de layout: no sale a la red.
    await page.route('https://api.github.com/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

    const toggle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })
    await expect(toggle).toBeVisible({ timeout: 15_000 })
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    }

    await page.getByTitle(/^Personal/).first().click()

    // Personal abre en la seccion `repos` (PersonalWorkspace.tsx: initialSection ?? 'repos').
    const boton = page.locator('.repo-action-btn.subtle-accent').first()
    await expect(boton).toBeVisible({ timeout: 15_000 })
    // La prueba de que el seed llego: la fila muestra el repo sembrado.
    await expect(page.getByText('GeronimoDiClemente/raven-nest')).toBeVisible()

    const fila = page.locator('.snippet-item').filter({ hasText: 'raven-nest' }).first()

    // Esperar a que la animacion de entrada termine ANTES de medir. La cascara aplica
    // `zoomIn` (workspace-shell-design §1), que escala el overlay: medido a mitad de la
    // animacion, este boton de 26px daba 25. Cualquier medicion de layout en estas tres
    // pantallas tiene que esperar a que el transform asiente.
    const altoEstable = async () => {
      let previo = -1
      for (let i = 0; i < 40; i++) {
        const h = (await boton.boundingBox())!.height
        if (h === previo) return h
        previo = h
        await page.waitForTimeout(50)
      }
      return previo
    }
    const altoBoton = await altoEstable()
    const altoFilaAntes = (await fila.boundingBox())!.height
    await page.screenshot({ path: join(SHOTS, '01-en-escala-28px.png') })

    // Ya dentro de la escala 24/28/32.
    expect(Math.round(altoBoton)).toBe(28)

    // La fila NO mide 26: la mandan las dos lineas de texto de la izquierda, no el boton.
    expect(altoFilaAntes).toBeGreaterThan(30)

    // El experimento: mover el boton por toda la escala no debe mover la fila.
    await page.addStyleTag({ content: '.repo-action-btn { height: 24px !important; }' })
    await expect.poll(async () => Math.round((await boton.boundingBox())!.height)).toBe(24)

    const altoFilaDespues = (await fila.boundingBox())!.height
    await page.screenshot({ path: join(SHOTS, '02-perturbado-24px.png') })

    // El veredicto: la fila no se movio ni un pixel.
    expect(altoFilaDespues).toBe(altoFilaAntes)
  } finally {
    await teardown(h)
  }
})
