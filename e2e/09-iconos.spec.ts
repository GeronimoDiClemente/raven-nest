// La evidencia visual de la migración de íconos a lucide.
//
// El contrato vive en `src/lib/icons.ts`: una escala de tres tamaños y UN grosor de trazo,
// declarado una sola vez en el `LucideProvider` de `main.tsx`. Antes había **28 grosores
// efectivos distintos** repartidos en 148 SVG dibujados a mano, y 13 de 27 archivos
// mezclaban varios adentro del mismo archivo.
//
// Que los íconos "queden todos iguales" no se puede afirmar con un assert: se mira. Este
// spec existe para dejar las capturas donde se puedan revisar y comparar entre pasadas. Lo
// que SÍ se puede afirmar automáticamente —que nadie vuelva a dibujar uno a mano— lo
// chequea `src/__tests__/lib/iconos-ratchet.test.ts`.
import { test, expect } from '@playwright/test'
import { launchHarness, teardown } from './helpers/harness'
import { mkdirSync } from 'fs'
import { join } from 'path'

const SHOTS = join(__dirname, '..', '.superpowers', 'sdd', 'shots', 'iconos')
mkdirSync(SHOTS, { recursive: true })

test('los iconos de la sidebar y de Personal, para mirar', async () => {
  const h = await launchHarness({ withRepo: true })
  const { page } = h
  try {
    const toggle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })
    await expect(toggle).toBeVisible({ timeout: 15_000 })
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    }

    // Las tres pestañas del menú del repo, que son los íconos que más se ven.
    await expect(page.getByRole('tab', { name: 'Worktrees' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Explorer' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Tools' })).toBeVisible()

    // Esperar a que asiente cualquier animación antes de capturar: medir o fotografiar
    // durante el zoomIn de la cáscara da tamaños escalados (ver 07-repo-row-escala).
    await page.waitForTimeout(2500)
    await page.screenshot({ path: join(SHOTS, '01-sidebar.png') })

    await page.getByTitle(/^Personal/).first().click()
    await expect(page.getByText('Repos', { exact: true })).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: join(SHOTS, '02-personal.png') })
  } finally {
    await teardown(h)
  }
})
