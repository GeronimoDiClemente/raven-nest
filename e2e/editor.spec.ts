import { test } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { launchHarness, teardown, expect } from './helpers/harness'

test('abrir un archivo desde el Explorer, editarlo y guardarlo actualiza el disco', async () => {
  const h = await launchHarness({ withRepo: true })

  // Vincular el repo del harness como repo activo de la tab, sin pasar por el
  // diálogo nativo de selección de carpeta (window.dialog.openFolder abre un
  // diálogo del SO que no es automatizable con Playwright). __e2e_linkRepo es
  // un hook instalado por App.tsx solo cuando window.appFlags.e2eBypass está
  // activo (RAVEN_E2E=1, seteado por el harness).
  await h.page.evaluate((repoDir) => {
    ;(window as unknown as { __e2e_linkRepo?: (p: string) => void }).__e2e_linkRepo?.(repoDir)
  }, h.repoDir)

  // El Explorer vive dentro del sidebar, que arranca colapsado.
  await h.page.locator('.sidebar-toggle').click()

  await expect(h.page.locator('.explorer-panel')).toBeVisible({ timeout: 10_000 })
  await h.page.locator('.explorer-entry-name', { hasText: 'README.md' }).click()

  // No clickear '.monaco-editor textarea': en Chromium moderno Monaco usa la
  // Native EditContext API para el input, y ese selector matchea el
  // '.ime-text-area' (readonly, solo posiciona el candidate window de IME),
  // no una superficie interactiva. Clickear '.view-lines' focá y posiciona
  // el cursor igual, sin depender del mecanismo de input interno de Monaco.
  const editorContent = h.page.locator('.monaco-editor .view-lines')
  await expect(editorContent).toBeVisible({ timeout: 10_000 })
  await editorContent.click()
  await h.page.keyboard.press('Control+A')
  await h.page.keyboard.type('# edited by e2e\n')

  const isMac = process.platform === 'darwin'
  await h.page.keyboard.press(isMac ? 'Meta+S' : 'Control+S')

  await expect(async () => {
    const content = readFileSync(join(h.repoDir, 'README.md'), 'utf8')
    expect(content).toBe('# edited by e2e\n')
  }).toPass({ timeout: 5000 })

  await teardown(h)
})
