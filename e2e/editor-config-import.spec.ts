import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { launchHarness, teardown, expect } from './helpers/harness'

test('importa fontSize/tabSize desde un settings.json fake de VS Code', async () => {
  const h = await launchHarness({ withRepo: true })

  // resolveVSCodeSettingsPath (electron/ide-config-bridge.ts) branches by
  // platform: win32 -> AppData/Roaming/Code/User, darwin -> Library/Application
  // Support/Code/User, else -> .config/Code/User. The plan's brief used the
  // Linux path unconditionally; this fixture must match the platform this
  // suite actually runs on.
  const userDir = process.platform === 'win32'
    ? join(h.homeDir, 'AppData', 'Roaming', 'Code', 'User')
    : process.platform === 'darwin'
      ? join(h.homeDir, 'Library', 'Application Support', 'Code', 'User')
      : join(h.homeDir, '.config', 'Code', 'User')
  mkdirSync(userDir, { recursive: true })
  writeFileSync(join(userDir, 'settings.json'), JSON.stringify({ 'editor.fontSize': 22, 'editor.tabSize': 8 }))

  // Settings vive en el sidebar; el trigger real es un <button className="titlebar-btn">
  // superpuesto (inset:0) sobre toda la fila .sidebar-item-settings (global.css:594-598),
  // así que clickear el contenedor de la fila alcanza sin necesitar expandir el sidebar.
  await h.page.locator('.sidebar-item-settings').click()
  await h.page.locator('.sp-tab', { hasText: 'Editor' }).click()
  await h.page.locator('.sp-action-btn', { hasText: 'Import from VS Code' }).click()

  const preview = h.page.locator('[data-testid="ide-config-preview"]')
  await expect(preview).toBeVisible({ timeout: 10_000 })
  await expect(preview).toContainText('22')
  await expect(preview).toContainText('8')

  // Aplicar el preview importado. La persistencia real pasa por Supabase
  // (useUserPreferences.setEditorOptions), que en el harness E2E no tiene un
  // usuario autenticado real (RAVEN_E2E bypassea auth sin sesión de Supabase,
  // ver main.tsx:96), por lo que el upsert no tiene efecto observable acá.
  // Lo que sí es verificable end-to-end sin mockear Supabase es que "Apply"
  // confirma el preview y lo cierra sin error.
  await h.page.locator('.sp-action-btn', { hasText: 'Apply' }).click()
  await expect(preview).not.toBeVisible({ timeout: 10_000 })

  await teardown(h)
})
