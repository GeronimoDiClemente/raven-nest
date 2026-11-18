// La Task 2 verificó la CONFIGURACIÓN leyendo archivos. Esto verifica lo único
// que de verdad importa: que el navegador aplique una utilidad de Tailwind y
// que resuelva al MISMO color que el token de global.css.
//
// Un `@theme` sin `inline` copiaría el valor en vez de referenciarlo, y los dos
// se desincronizarían el día que alguien toque el token. Acá se compara lo
// pintado, así que ese error no puede pasar sin que esto falle.
import { test, expect } from '@playwright/test'
import { launchHarness, teardown } from './helpers/harness'

test('una utilidad de Tailwind resuelve al mismo color que el token', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    const medido = await page.evaluate(() => {
      const el = document.createElement('div')
      // `bg-background` y `text-foreground` a proposito, no `bg-card`: esas dos
      // ya estan en src/App.tsx desde la Task 1, asi que Tailwind las genera
      // seguro. Una clase que solo existiera en este .spec.ts podria no
      // generarse — el motor emite utilidades escaneando el fuente — y el test
      // fallaria por como Tailwind descubre archivos, no por lo que quiere
      // probar, que es que la utilidad resuelva al MISMO color que el token.
      el.className = 'bg-background text-foreground rounded-md'
      document.body.appendChild(el)
      const s = getComputedStyle(el)
      const raiz = getComputedStyle(document.documentElement)
      const resolver = (v: string) => {
        const probe = document.createElement('div')
        probe.style.color = v
        document.body.appendChild(probe)
        const out = getComputedStyle(probe).color
        probe.remove()
        return out
      }
      const radiusResolver = (v: string) => {
        const probe = document.createElement('div')
        probe.style.borderRadius = v
        document.body.appendChild(probe)
        const out = getComputedStyle(probe).borderRadius
        probe.remove()
        return out
      }
      const out = {
        bg: s.backgroundColor,
        fg: s.color,
        radio: s.borderRadius,
        tokenBg: resolver(raiz.getPropertyValue('--background').trim()),
        tokenFg: resolver(raiz.getPropertyValue('--foreground').trim()),
        tokenRadius: radiusResolver(raiz.getPropertyValue('--radius').trim()),
      }
      el.remove()
      return out
    })

    expect(medido.bg).toBe(medido.tokenBg)
    expect(medido.fg).toBe(medido.tokenFg)
    expect(medido.radio).toBe(medido.tokenRadius)
    // C2: el radio base es 8px (0.5rem), y rounded-md lo pinta.
    expect(medido.tokenRadius).toBe('8px')
    expect(medido.radio).toBe('8px')
  } finally {
    await teardown(h)
  }
})

// Fase 1, C1: los tokens nuevos existen con el valor del spec y las utilidades que los
// exponen (`@theme inline`) pintan ese mismo valor. Las clases tienen que existir en un
// archivo de src/ que Tailwind escanee (las piezas de src/components/ui las usan): si sólo
// estuvieran en este .spec.ts el motor no las generaría.
test('los tokens nuevos de la fase 1 se pintan con el valor del token', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    const medido = await page.evaluate(() => {
      const resolverColor = (v: string) => {
        const probe = document.createElement('div')
        probe.style.color = v
        document.body.appendChild(probe)
        const out = getComputedStyle(probe).color
        probe.remove()
        return out
      }
      const raiz = getComputedStyle(document.documentElement)
      const token = (n: string) => raiz.getPropertyValue(n).trim()
      const pintar = (clase: string, prop: 'backgroundColor' | 'color') => {
        const el = document.createElement('div')
        el.className = clase
        document.body.appendChild(el)
        const out = getComputedStyle(el)[prop]
        el.remove()
        return out
      }
      const tokens = [
        '--sidebar', '--sidebar-row-hover', '--sidebar-row-active', '--sidebar-row-selected',
        '--sidebar-inset', '--ok-surface', '--warn-surface', '--destructive-surface',
        '--info', '--info-surface',
      ]
      return {
        crudos: Object.fromEntries(tokens.map((n) => [n, token(n)])),
        resueltos: Object.fromEntries(tokens.filter((n) => n !== '--sidebar-inset').map((n) => [n, resolverColor(token(n))])),
        selectedBg: pintar('bg-sidebar-row-selected', 'backgroundColor'),
        okSurfaceBg: pintar('bg-ok-surface', 'backgroundColor'),
        infoFg: pintar('text-info', 'color'),
      }
    })

    // Valores del spec (resueltos por el navegador, así que da igual cómo estén escritos).
    expect(medido.crudos['--sidebar-inset']).toBe('8px')
    expect(medido.resueltos['--sidebar']).toBe('rgb(15, 15, 15)')
    expect(medido.resueltos['--sidebar-row-selected']).toBe('rgb(38, 38, 38)')
    expect(medido.resueltos['--sidebar-row-hover']).toBe('rgba(255, 255, 255, 0.05)')
    expect(medido.resueltos['--sidebar-row-active']).toBe('rgba(255, 255, 255, 0.08)')
    expect(medido.resueltos['--ok-surface']).toBe('rgba(74, 222, 128, 0.1)')
    expect(medido.resueltos['--warn-surface']).toBe('rgba(227, 179, 65, 0.1)')
    expect(medido.resueltos['--destructive-surface']).toBe('rgba(255, 101, 104, 0.1)')
    expect(medido.resueltos['--info']).toBe('rgb(143, 184, 255)')
    expect(medido.resueltos['--info-surface']).toBe('rgba(143, 184, 255, 0.1)')

    // Lo pintado por la utilidad == el token.
    expect(medido.selectedBg).toBe(medido.resueltos['--sidebar-row-selected'])
    expect(medido.okSurfaceBg).toBe(medido.resueltos['--ok-surface'])
    expect(medido.infoFg).toBe(medido.resueltos['--info'])
  } finally {
    await teardown(h)
  }
})
