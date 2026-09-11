// El ritmo de la barra lateral: que las filas sean todas la misma fila.
//
// Que "se vea parejo" no es una opinión: son tres números —alto, radio del resaltado y
// espacio entre filas— y los tres se pueden medir. Este spec existe porque los tres
// estaban desalineados a la vez y ninguno se notaba leyendo el código:
//
//   - `.user-menu-trigger` medía 40px donde las otras ocho medían 32, y era la única con
//     margen vertical.
//   - Convivían TRES radios: 6px en `.sidebar-item` y en los <Button size="sm">, 8px en
//     los <Button size="default">, 10px en el menú de usuario. Como el hover dibuja ese
//     radio, la misma columna mostraba esquinas distintas de una fila a la siguiente.
//   - El botón de colapsar llevaba un `mb-1` que ninguna otra fila tenía.
import { test, expect } from '@playwright/test'
import { launchHarness, teardown } from './helpers/harness'

interface Fila { txt: string; h: number; y: number; radio: string; mt: string; mb: string }

async function filasDeLaBarra(page: import('@playwright/test').Page): Promise<Fila[]> {
  return page.evaluate(() => {
    const sb = document.querySelector('.sidebar')
    if (!sb) return []
    const out: Fila[] = []
    sb.querySelectorAll('.sidebar-item, button').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      // Las pestañas del repo (Worktrees/Explorer/Tools) son una barra de pestañas, no
      // filas de la lista: tienen su propia altura y su propio ritmo.
      if (el.closest('.sidebar-tabbar')) return
      // Un control DENTRO de una fila (el botón de unlink, el de GitHub, el "Link repo" de
      // la fila del repo) no es una fila: mide lo que mide su contenido.
      const padre = el.parentElement?.closest('.sidebar-item, button')
      if (padre) return
      const cs = getComputedStyle(el as HTMLElement)
      out.push({
        txt: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24),
        h: +r.height.toFixed(1), y: +r.y.toFixed(1),
        radio: cs.borderRadius, mt: cs.marginTop, mb: cs.marginBottom,
      })
    })
    return out.sort((a, b) => a.y - b.y)
  })
}

test('todas las filas de la barra tienen el mismo alto, el mismo radio y ningún margen propio', async () => {
  const h = await launchHarness({ withRepo: true })
  const { page } = h
  try {
    const toggle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })
    await expect(toggle).toBeVisible({ timeout: 15_000 })
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
    // La cáscara entra con un zoom: medir durante la animación da tamaños escalados.
    await page.waitForTimeout(2500)

    for (const modo of ['expandida', 'colapsada'] as const) {
      if (modo === 'colapsada') {
        await toggle.click()
        await page.waitForTimeout(1500)
      }
      const filas = await filasDeLaBarra(page)
      expect(filas.length, `${modo}: no se encontró ninguna fila`).toBeGreaterThan(3)

      const alturas = [...new Set(filas.map((f) => f.h))]
      expect(alturas, `${modo}: alturas distintas — ${JSON.stringify(filas.map((f) => [f.txt, f.h]))}`)
        .toEqual([32])

      const radios = [...new Set(filas.map((f) => f.radio))]
      expect(radios, `${modo}: radios distintos — ${JSON.stringify(filas.map((f) => [f.txt, f.radio]))}`)
        .toHaveLength(1)

      // Ningún margen vertical propio: el espacio entre filas lo decide el contenedor, o
      // un separador visible. Una fila que se aparta sola rompe el ritmo de todas.
      const conMargen = filas.filter((f) => f.mt !== '0px' || f.mb !== '0px')
      expect(conMargen.map((f) => f.txt), `${modo}: filas con margen propio`).toEqual([])
    }
  } finally {
    await teardown(h)
  }
})

// Un separador que no dibuja su línea pero sí deja su margen se lee como un hueco
// arbitrario en el ritmo. Pasó de verdad: el primitivo usaba el shorthand
// `data-horizontal:` de Tailwind v4, que genera `[data-horizontal]` —un atributo llamado
// así— mientras Radix emite `data-orientation="horizontal"`. Ninguna de las cuatro clases
// aplicaba y el separador quedaba en 0×0.
test('un separador de la barra dibuja su línea, no sólo su margen', async () => {
  const h = await launchHarness({ withRepo: true })
  const { page } = h
  try {
    const toggle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })
    await expect(toggle).toBeVisible({ timeout: 15_000 })
    if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click()
    await page.waitForTimeout(2000)

    const seps = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.sidebar [data-slot="separator"]')).map((el) => {
        const r = el.getBoundingClientRect()
        return { alto: +r.height.toFixed(1), ancho: +r.width.toFixed(1) }
      })
    )
    expect(seps.length, 'no hay separadores en la barra').toBeGreaterThan(0)
    for (const s of seps) {
      expect(s.alto, `un separador con alto ${s.alto}`).toBeGreaterThan(0)
      expect(s.ancho, `un separador con ancho ${s.ancho}`).toBeGreaterThan(0)
    }
  } finally {
    await teardown(h)
  }
})
