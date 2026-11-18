// Fase 1 (tokens y piezas base), C4. La preview de src/components/ui-preview/UiPreview.tsx sólo
// existe con NEST_UI_PREVIEW=1. Contrato que este archivo le exige a la implementación:
//
//   - La raíz de la preview lleva `data-testid="ui-preview"`.
//   - Una sección por pieza, con estos `data-testid`: ui-preview-list, ui-preview-status-badge,
//     ui-preview-callout, ui-preview-empty-state, ui-preview-segmented, ui-preview-nav-row,
//     ui-preview-kbd. Cada sección está DENTRO de la raíz y muestra todas las variantes de su pieza.
//   - Las piezas llevan los atributos del spec (data-tone, data-selected, role, aria-*).
import { test, expect } from '@playwright/test'
import { launchHarness, teardown } from './helpers/harness'
import { medirContraste, UMBRAL } from './helpers/contraste'

const RAIZ = '[data-testid="ui-preview"]'
const seccion = (nombre: string) => `${RAIZ} [data-testid="ui-preview-${nombre}"]`

test('con NEST_UI_PREVIEW=1 la preview muestra las siete piezas y pasa el guard de 3:1', async () => {
  const h = await launchHarness({ withRepo: false, env: { NEST_UI_PREVIEW: '1' } })
  const { page } = h
  try {
    await expect(page.locator(RAIZ)).toBeVisible({ timeout: 15_000 })

    // List / ListRow: una fila seleccionada, una botón (clicable) y una div (sin onClick).
    const lista = page.locator(seccion('list'))
    await expect(lista.locator('[data-selected="true"]').first()).toBeVisible()
    await expect(lista.locator('button[type="button"]').first()).toBeVisible()

    // StatusBadge: los cinco tonos.
    for (const tono of ['ok', 'warn', 'destructive', 'info', 'muted']) {
      await expect(page.locator(seccion('status-badge')).locator(`[data-tone="${tono}"]`).first()).toBeVisible()
    }

    // Callout: los tres tonos, con role=status.
    for (const tono of ['warn', 'destructive', 'info']) {
      await expect(page.locator(seccion('callout')).locator(`[role="status"][data-tone="${tono}"]`).first()).toBeVisible()
    }

    // EmptyState: caja punteada.
    await expect(page.locator(seccion('empty-state')).locator('.border-dashed').first()).toBeVisible()

    // Segmented: un grupo con nombre, una opción apretada y al menos otra sin apretar.
    const grupo = page.locator(seccion('segmented')).getByRole('group').first()
    await expect(grupo).toBeVisible()
    await expect(grupo.locator('button[aria-pressed="true"]')).toHaveCount(1)
    expect(await grupo.locator('button[aria-pressed="false"]').count()).toBeGreaterThan(0)

    // NavRow: una seleccionada (aria-current) y otras que no.
    const nav = page.locator(seccion('nav-row'))
    await expect(nav.locator('button[aria-current="true"]').first()).toBeVisible()
    expect(await nav.locator('button:not([aria-current="true"])').count()).toBeGreaterThan(0)

    // Kbd.
    await expect(page.locator(seccion('kbd')).locator('kbd').first()).toBeVisible()

    // global.css tiene `kbd { font-family: inherit; border-radius: 4px }` sin capa: le gana a las
    // utilidades (que van en @layer). Se compara el estilo COMPUTADO contra los tokens, no las clases.
    const kbd = await page.locator(seccion('kbd')).locator('kbd').first().evaluate((el) => {
      const raiz = getComputedStyle(document.documentElement)
      const probe = document.createElement('div')
      probe.style.fontFamily = raiz.getPropertyValue('--font-mono').trim()
      // rounded-sm en tailwind.css: calc(var(--radius) - 2px).
      probe.style.borderRadius = `calc(${raiz.getPropertyValue('--radius').trim()} - 2px)`
      document.body.appendChild(probe)
      const esperado = { fontFamily: getComputedStyle(probe).fontFamily, borderRadius: getComputedStyle(probe).borderRadius }
      probe.remove()
      const s = getComputedStyle(el)
      return { fontFamily: s.fontFamily, borderRadius: s.borderRadius, esperado }
    })
    expect(kbd.esperado.fontFamily).toContain('Mono')
    expect(kbd.fontFamily).toBe(kbd.esperado.fontFamily)
    expect(kbd.borderRadius).toBe(kbd.esperado.borderRadius)
    expect(kbd.esperado.borderRadius).toBe('6px')

    // Mismo guard que e2e/04-contraste.spec.ts, sólo sobre la preview.
    const malos = await medirContraste(page, RAIZ)
    if (malos.length) {
      console.log('\nTEXTO ILEGIBLE (preview de piezas):')
      for (const o of malos) {
        console.log(`  ${o.ratio}:1  ${o.selector}  "${o.texto}"  ${o.color} sobre ${o.fondo}`)
      }
    }
    expect(malos, `${malos.length} elementos por debajo de ${UMBRAL}:1`).toEqual([])
  } finally {
    await teardown(h)
  }
})

test('sin NEST_UI_PREVIEW la preview no aparece y la app arranca normal', async () => {
  // '0' y no ausente: el harness hereda process.env, y un shell con la variable en 1 haría
  // flaky este test. Sólo el valor '1' activa la preview.
  const h = await launchHarness({ withRepo: false, env: { NEST_UI_PREVIEW: '0' } })
  const { page } = h
  try {
    await expect(page.locator('.app')).toBeVisible()
    await page.waitForTimeout(1000)
    await expect(page.locator(RAIZ)).toHaveCount(0)
  } finally {
    await teardown(h)
  }
})
