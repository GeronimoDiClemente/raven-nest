import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { launchHarness, teardown, expect } from './helpers/harness'

// Abre README.md del repo del harness en un EditorPane real (mismo camino que
// e2e/editor.spec.ts: link del repo vía __e2e_linkRepo + Explorer del sidebar).
async function openReadmeInEditor(h: Awaited<ReturnType<typeof launchHarness>>) {
  await h.page.evaluate((repoDir) => {
    ;(window as unknown as { __e2e_linkRepo?: (p: string) => void }).__e2e_linkRepo?.(repoDir)
  }, h.repoDir)
  await h.page.locator('.sidebar-toggle').click()
  await expect(h.page.locator('.explorer-panel')).toBeVisible({ timeout: 10_000 })
  await h.page.locator('.explorer-entry-name', { hasText: 'README.md' }).click()
  await expect(h.page.locator('.monaco-editor .view-lines')).toBeVisible({ timeout: 10_000 })
}

test('seleccionar un tema bundled pinta el editor con los colores del tema', async () => {
  const h = await launchHarness({ withRepo: true })
  try {
    await openReadmeInEditor(h)

    // Settings vive en el sidebar; el trigger real es un <button
    // className="titlebar-btn"> superpuesto sobre toda la fila
    // .sidebar-item-settings (ver e2e/editor-config-import.spec.ts).
    await h.page.locator('.sidebar-item-settings').click()
    await h.page.locator('.sp-tab', { hasText: 'Editor' }).click()

    const select = h.page.locator('[data-testid="theme-select"]')
    await expect(select).toBeVisible({ timeout: 10_000 })
    await select.selectOption('dracula')

    // Cerrar el modal para dejar el editor a la vista.
    await h.page.keyboard.press('Escape')

    // applyTheme es async (chunk del tema + WASM de shiki): se pollea hasta
    // que el background del editor sea el de Dracula (#282a36).
    await expect(async () => {
      const bg = await h.page.locator('.monaco-editor').first().evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      )
      expect(bg).toBe('rgb(40, 42, 54)')
    }).toPass({ timeout: 15_000 })

    // El editor sigue funcional con el tema aplicado (fallback nunca lo rompe).
    const editorContent = h.page.locator('.monaco-editor .view-lines')
    await editorContent.click()
    await h.page.keyboard.type('x')
    await expect(h.page.locator('[data-testid="dirty-README.md"]')).toBeVisible({ timeout: 5_000 })

    // Nota: la persistencia del nombre elegido viaja por Supabase
    // (ui_settings.editorTheme) y el harness E2E no tiene sesión real
    // (RAVEN_E2E bypassea auth) — la persistencia cross-restart no es
    // verificable acá, igual que en editor-config-import.spec.ts.
  } finally {
    await teardown(h)
  }
})

test('importa un tema desde una instalación fake de VS Code y lo lista como Installed', async () => {
  const h = await launchHarness({ withRepo: true })
  try {
    // themes:scanVSCode lee RAVEN_IDE_CONFIG_HOME/.vscode/extensions (el
    // harness apunta RAVEN_IDE_CONFIG_HOME a homeDir) — fixture fake acá.
    const extDir = join(h.homeDir, '.vscode', 'extensions', 'acme.e2e-theme-1.0.0')
    mkdirSync(join(extDir, 'themes'), { recursive: true })
    writeFileSync(join(extDir, 'package.json'), JSON.stringify({
      name: 'e2e-theme',
      contributes: {
        themes: [{ label: 'Acme E2E Dark', uiTheme: 'vs-dark', path: './themes/acme-dark.json' }],
      },
    }))
    writeFileSync(join(extDir, 'themes', 'acme-dark.json'), JSON.stringify({
      name: 'Acme E2E Dark',
      type: 'dark',
      colors: { 'editor.background': '#123456' },
      tokenColors: [],
    }))

    await h.page.locator('.sidebar-item-settings').click()
    await h.page.locator('.sp-tab', { hasText: 'Editor' }).click()

    await h.page.locator('.sp-action-btn', { hasText: 'Import themes from VS Code' }).click()
    const scanned = h.page.locator('[data-testid="scanned-themes"]')
    await expect(scanned).toBeVisible({ timeout: 10_000 })
    await expect(scanned).toContainText('Acme E2E Dark')

    await scanned.locator('.sp-action-btn', { hasText: 'Install' }).click()

    // El tema instalado aparece en el selector (grupo Installed) — las
    // <option> no son "visibles" para Playwright, se asserta por count.
    await expect(
      h.page.locator('[data-testid="theme-select"] option', { hasText: 'Acme E2E Dark' }),
    ).toHaveCount(1, { timeout: 10_000 })
  } finally {
    await teardown(h)
  }
})
