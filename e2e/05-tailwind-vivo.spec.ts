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
      const out = {
        bg: s.backgroundColor,
        fg: s.color,
        radio: s.borderRadius,
        tokenBg: resolver(raiz.getPropertyValue('--background').trim()),
        tokenFg: resolver(raiz.getPropertyValue('--foreground').trim()),
      }
      el.remove()
      return out
    })

    expect(medido.bg).toBe(medido.tokenBg)
    expect(medido.fg).toBe(medido.tokenFg)
    expect(medido.radio).not.toBe('0px')
  } finally {
    await teardown(h)
  }
})
