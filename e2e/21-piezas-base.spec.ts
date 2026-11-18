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

// C8: valores computados de cada pieza contra la tabla del spec. Se compara lo PINTADO
// (getComputedStyle), con los colores resueltos desde los tokens por un elemento de prueba.
test.describe('C8: cada pieza se pinta como el lienzo', () => {
  let h: Awaited<ReturnType<typeof launchHarness>>

  test.beforeAll(async () => {
    h = await launchHarness({ withRepo: false, env: { NEST_UI_PREVIEW: '1' } })
    await expect(h.page.locator(RAIZ)).toBeVisible({ timeout: 15_000 })
  })
  test.afterAll(async () => {
    if (h) await teardown(h)
  })

  type Props = Record<string, string>

  // Estilo computado de un elemento, para las propiedades pedidas.
  const leer = (sel: string, props: string[], nth = 0): Promise<Props> =>
    h.page.locator(sel).nth(nth).evaluate((el, ps) => {
      const s = getComputedStyle(el)
      return Object.fromEntries(ps.map((p) => [p, (s as unknown as Record<string, string>)[p]]))
    }, props)

  // Resuelve un token de color del :root a lo que pinta el navegador. Vacío si el token no existe.
  const color = (token: string): Promise<string> =>
    h.page.evaluate((t) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(t).trim()
      if (!v) return `TOKEN ${t} NO EXISTE`
      const probe = document.createElement('div')
      probe.style.color = v
      document.body.appendChild(probe)
      const out = getComputedStyle(probe).color
      probe.remove()
      return out
    }, token)

  // Lo que mide `rounded-sm` (radius - 2px) y la fuente mono, resueltos desde la raíz.
  const deRaiz = () =>
    h.page.evaluate(() => {
      const raiz = getComputedStyle(document.documentElement)
      const probe = document.createElement('div')
      probe.style.fontFamily = raiz.getPropertyValue('--font-mono').trim()
      probe.style.borderRadius = `calc(${raiz.getPropertyValue('--radius').trim()} - 2px)`
      document.body.appendChild(probe)
      const out = { mono: getComputedStyle(probe).fontFamily, radioSm: getComputedStyle(probe).borderRadius }
      probe.remove()
      return out
    })

  // Alpha explícito sobre un color resuelto: rgb(r, g, b) -> [r, g, b, a] y lo mismo para
  // rgba(...) o color(srgb ...), que es como puede devolver el navegador un color-mix.
  const canales = (c: string): number[] | null => {
    const m = c.match(/^rgba?\(([^)]+)\)$/)
    if (m) {
      const n = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
      return [n[0], n[1], n[2], n[3] ?? 1]
    }
    const s = c.match(/^color\(srgb ([^)]+)\)$/)
    if (s) {
      const n = s[1].split(/[ /]+/).filter(Boolean).map(Number)
      return [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1]
    }
    return null
  }
  const mismoColor = (a: string, b: string) => {
    const x = canales(a)
    const y = canales(b)
    if (!x || !y) return a === b
    return [0, 1, 2].every((i) => Math.abs(x[i] - y[i]) <= 1) && Math.abs(x[3] - y[3]) <= 0.01
  }

  // Compara y acumula las diferencias para verlas todas juntas, no sólo la primera.
  const comparar = (donde: string, real: Props, esperado: Props, malos: string[]) => {
    for (const [k, v] of Object.entries(esperado)) {
      const ok = k.toLowerCase().includes('color') ? mismoColor(real[k], v) : real[k] === v
      if (!ok) malos.push(`${donde}.${k}: pinta "${real[k]}", la tabla pide "${v}"`)
    }
  }

  const caja = (pad: [string, string, string, string]) => ({
    paddingTop: pad[0], paddingRight: pad[1], paddingBottom: pad[2], paddingLeft: pad[3],
  })
  const borde = (ancho: string, estilo: string, col: string) => ({
    borderTopWidth: ancho, borderRightWidth: ancho, borderBottomWidth: ancho, borderLeftWidth: ancho,
    borderTopStyle: estilo, borderRightStyle: estilo, borderBottomStyle: estilo, borderLeftStyle: estilo,
    borderTopColor: col, borderRightColor: col, borderBottomColor: col, borderLeftColor: col,
  })
  const radio = (r: string) => ({
    borderTopLeftRadius: r, borderTopRightRadius: r, borderBottomLeftRadius: r, borderBottomRightRadius: r,
  })
  const sinBorde = {
    borderTopStyle: 'none', borderRightStyle: 'none', borderBottomStyle: 'none', borderLeftStyle: 'none',
  }
  const TRANSPARENTE = 'rgba(0, 0, 0, 0)'

  test('los tokens --border-strong y --subtle existen con el valor del spec', async () => {
    expect(await color('--border-strong')).toBe('rgba(255, 255, 255, 0.15)')
    expect(await color('--subtle')).toBe('rgb(122, 122, 122)')
  })

  test('la raíz de la preview computa 13px y line-height 18.85px (1.45 x 13)', async () => {
    const r = await leer(RAIZ, ['fontSize', 'lineHeight'])
    expect(r).toEqual({ fontSize: '13px', lineHeight: '18.85px' })
  })

  test('todo <button> de una pieza: sin borde 3D, fondo transparente, fuente heredada, sin subrayado', async () => {
    const heredada = (await leer(RAIZ, ['fontFamily'])).fontFamily
    const malos: string[] = []
    // Excluye los botones de acción (Resume, New session): llevan borde por la tabla.
    const botones = h.page.locator(
      `${seccion('list')} button, ${seccion('segmented')} button, ${seccion('nav-row')} button`,
    )
    const n = await botones.count()
    expect(n).toBeGreaterThan(0)
    for (let i = 0; i < n; i++) {
      const b = botones.nth(i)
      const sel = (await b.getAttribute('aria-pressed')) === 'true' || (await b.getAttribute('aria-current')) === 'true' ||
        (await b.getAttribute('data-selected')) === 'true'
      const s = await b.evaluate((el) => {
        const c = getComputedStyle(el)
        return {
          borderTopStyle: c.borderTopStyle, borderRightStyle: c.borderRightStyle,
          borderBottomStyle: c.borderBottomStyle, borderLeftStyle: c.borderLeftStyle,
          backgroundColor: c.backgroundColor, fontFamily: c.fontFamily, textDecorationLine: c.textDecorationLine,
        }
      })
      const donde = `button#${i} "${(await b.innerText()).replace(/\s+/g, ' ').slice(0, 24)}"`
      // El borde superior de ListRow es el separador; el resto no tiene borde propio.
      const estilos = [s.borderRightStyle, s.borderBottomStyle, s.borderLeftStyle]
      if (estilos.some((e) => e !== 'none')) malos.push(`${donde}.border-style: pinta "${estilos.join('/')}" (right/bottom/left), la tabla pide "none"`)
      if (!sel && s.backgroundColor !== TRANSPARENTE) malos.push(`${donde}.backgroundColor: pinta "${s.backgroundColor}", la tabla pide transparente`)
      if (s.fontFamily !== heredada) malos.push(`${donde}.fontFamily: pinta "${s.fontFamily}", la tabla pide la heredada "${heredada}"`)
      if (s.textDecorationLine !== 'none') malos.push(`${donde}.textDecorationLine: pinta "${s.textDecorationLine}", la tabla pide none`)
    }
    for (const nombre of ['Resume', 'New session']) {
      const s = await h.page.getByRole('button', { name: nombre }).evaluate((el) => {
        const c = getComputedStyle(el)
        return { fontFamily: c.fontFamily, textDecorationLine: c.textDecorationLine }
      })
      if (s.fontFamily !== heredada) malos.push(`boton "${nombre}".fontFamily: pinta "${s.fontFamily}", la tabla pide la heredada "${heredada}"`)
      if (s.textDecorationLine !== 'none') malos.push(`boton "${nombre}".textDecorationLine: pinta "${s.textDecorationLine}", la tabla pide none`)
    }
    expect(malos).toEqual([])
  })

  test('NavRow: 30px de alto mínimo, padding 6px 8px, radio 6px, 13px, colores de los tokens y count 11px subtle/warn', async () => {
    const malos: string[] = []
    const muted = await color('--muted-foreground')
    const fg = await color('--foreground')
    const seleccionada = await color('--sidebar-row-selected')
    const subtle = await color('--subtle')
    const warn = await color('--warn')
    const { radioSm } = await deRaiz()
    const base = { minHeight: '30px', ...caja(['6px', '8px', '6px', '8px']), ...radio(radioSm), fontSize: '13px' }
    const filas = seccion('nav-row') + ' button'
    const props = Object.keys({ ...base, color: '', backgroundColor: '' })

    comparar('NavRow seleccionada', await leer(filas, props, 0), { ...base, color: fg, backgroundColor: seleccionada }, malos)
    comparar('NavRow normal', await leer(filas, props, 1), { ...base, color: muted, backgroundColor: TRANSPARENTE }, malos)
    comparar('NavRow sin count', await leer(filas, props, 2), { ...base, color: muted }, malos)
    expect(radioSm).toBe('6px')

    const count = (nth: number) => leer(`${filas} span:last-child`, ['fontSize', 'color'], nth)
    comparar('NavRow count (default)', await count(0), { fontSize: '11px', color: subtle }, malos)
    comparar('NavRow count (warn)', await count(1), { fontSize: '11px', color: warn }, malos)
    expect(malos).toEqual([])
  })

  test('Segmented: contenedor con borde 1px border-strong, radio 6px, sin separación; opciones 11.5px, padding 4px 10px, 26px, sin borde', async () => {
    const malos: string[] = []
    const fuerte = await color('--border-strong')
    const { radioSm } = await deRaiz()
    const grupo = `${seccion('segmented')} [role="group"]`
    comparar(
      'Segmented contenedor',
      await leer(grupo, [...Object.keys(borde('', '', '')), ...Object.keys(radio('')), 'columnGap', 'overflowX', 'overflowY']),
      { ...borde('1px', 'solid', fuerte), ...radio(radioSm), columnGap: '0px', overflowX: 'hidden', overflowY: 'hidden' },
      malos,
    )
    const opcion = { fontSize: '11.5px', ...caja(['4px', '10px', '4px', '10px']), minHeight: '26px', ...sinBorde }
    const n = await h.page.locator(`${grupo} button`).count()
    expect(n).toBe(3)
    for (let i = 0; i < n; i++) {
      comparar(`Segmented opción ${i}`, await leer(`${grupo} button`, Object.keys(opcion), i), opcion, malos)
    }
    expect(malos).toEqual([])
  })

  test('ListRow: 46px de alto mínimo, padding 10px 14px y separador border-top 1px border salvo la primera', async () => {
    const malos: string[] = []
    const sep = await color('--border')
    // Las tres filas en orden de documento: dos botones y un div.
    const todas = h.page.locator(`${seccion('list')} > div > *`)
    const n = await todas.count()
    expect(n).toBe(3)
    const base = { minHeight: '46px', ...caja(['10px', '14px', '10px', '14px']) }
    for (let i = 0; i < n; i++) {
      const props = [...Object.keys(base), 'borderTopWidth', 'borderTopStyle', 'borderTopColor']
      const s = await todas.nth(i).evaluate((el, ps) => {
        const c = getComputedStyle(el)
        return Object.fromEntries(ps.map((p) => [p, (c as unknown as Record<string, string>)[p]]))
      }, props)
      if (i === 0) {
        comparar(`ListRow ${i}`, s, base, malos)
        if (s.borderTopWidth !== '0px') malos.push(`ListRow 0.borderTopWidth: pinta "${s.borderTopWidth}", la primera no lleva separador (0px)`)
      } else {
        comparar(`ListRow ${i}`, s, { ...base, borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: sep }, malos)
      }
    }
    expect(malos).toEqual([])
  })

  test('StatusBadge: 11.5px, padding 2px 8px, radio pill', async () => {
    const malos: string[] = []
    const n = await h.page.locator(`${seccion('status-badge')} [data-tone]`).count()
    expect(n).toBe(5)
    for (let i = 0; i < n; i++) {
      const s = await leer(`${seccion('status-badge')} [data-tone]`, ['fontSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopLeftRadius'], i)
      comparar(`StatusBadge ${i}`, s, { fontSize: '11.5px', ...caja(['2px', '8px', '2px', '8px']) }, malos)
      // pill: el radio es tan grande como para redondear del todo (rounded-full = infinito).
      if (!(parseFloat(s.borderTopLeftRadius) >= 100)) malos.push(`StatusBadge ${i}.borderRadius: pinta "${s.borderTopLeftRadius}", la tabla pide pill`)
    }
    expect(malos).toEqual([])
  })

  test('Callout: padding 12px 14px, radio 8px, borde 1px del color del tono al 35%', async () => {
    const malos: string[] = []
    for (const [tono, token] of [['warn', '--warn'], ['destructive', '--destructive'], ['info', '--info']] as const) {
      const c = canales(await color(token))!
      const al35 = `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.35)`
      const sel = `${seccion('callout')} [role="status"][data-tone="${tono}"]`
      comparar(
        `Callout ${tono}`,
        await leer(sel, [...Object.keys(caja(['', '', '', ''])), ...Object.keys(radio('')), ...Object.keys(borde('', '', ''))]),
        { ...caja(['12px', '14px', '12px', '14px']), ...radio('8px'), ...borde('1px', 'solid', al35) },
        malos,
      )
    }
    expect(malos).toEqual([])
  })

  test('EmptyState: borde 1px dashed border-strong, radio 8px, padding 40px 24px', async () => {
    const malos: string[] = []
    const fuerte = await color('--border-strong')
    const sel = `${seccion('empty-state')} .border-dashed`
    comparar(
      'EmptyState',
      await leer(sel, [...Object.keys(caja(['', '', '', ''])), ...Object.keys(radio('')), ...Object.keys(borde('', '', ''))]),
      { ...caja(['40px', '24px', '40px', '24px']), ...radio('8px'), ...borde('1px', 'dashed', fuerte) },
      malos,
    )
    expect(malos).toEqual([])
  })

  test('Kbd: mono, 10.5px, borde 1px border-strong, radio 6px (rounded-sm, como pide C3), padding 0 5px', async () => {
    const malos: string[] = []
    const fuerte = await color('--border-strong')
    const { mono, radioSm } = await deRaiz()
    const sel = `${seccion('kbd')} kbd`
    const n = await h.page.locator(sel).count()
    expect(n).toBe(2)
    for (let i = 0; i < n; i++) {
      comparar(
        `Kbd ${i}`,
        await leer(sel, ['fontFamily', 'fontSize', ...Object.keys(caja(['', '', '', ''])), ...Object.keys(radio('')), ...Object.keys(borde('', '', ''))], i),
        { fontFamily: mono, fontSize: '10.5px', ...caja(['0px', '5px', '0px', '5px']), ...radio(radioSm), ...borde('1px', 'solid', fuerte) },
        malos,
      )
    }
    expect(malos).toEqual([])
  })

  test('botones de acción de la preview (Resume, New session): 11.5px, padding 3px 9px, 26px, borde 1px border-strong, radio 6px', async () => {
    const malos: string[] = []
    const fuerte = await color('--border-strong')
    const { radioSm } = await deRaiz()
    const esperado = {
      fontSize: '11.5px', ...caja(['3px', '9px', '3px', '9px']), minHeight: '26px',
      ...borde('1px', 'solid', fuerte), ...radio(radioSm),
    }
    for (const nombre of ['Resume', 'New session']) {
      const s = await h.page.getByRole('button', { name: nombre }).evaluate((el, ps) => {
        const c = getComputedStyle(el)
        return Object.fromEntries(ps.map((p) => [p, (c as unknown as Record<string, string>)[p]]))
      }, Object.keys(esperado))
      comparar(`boton "${nombre}"`, s, esperado, malos)
    }
    expect(malos).toEqual([])
  })
})
