// I2 de la review final (2026-09-09): los tests `-tokens`
// (src/__tests__/components/*-tokens.test.tsx) sólo hacen
// `expect(src).not.toMatch(/fontSize:\s*\d/)` sobre el FUENTE del componente
// migrado. Eso no puede ver un tamaño que un primitivo stock de
// `src/components/ui/` inyecta desde OTRO archivo — que es exactamente cómo
// `buttonVariants` (ui/button.tsx) coló 14px (`text-sm` sin puentear a la
// escala) y 12.8px (`text-[0.8rem]`, un arbitrario) dentro de componentes que
// un test -tokens ya había dado por migrados y verdes.
//
// Este guard mide lo que el navegador REALMENTE pinta, igual que
// e2e/04-contraste.spec.ts (color) y e2e/05-tailwind-vivo.spec.ts (color y
// radio): aplica, en la app corriendo, las clases nativas de Tailwind que los
// primitivos stock usan por default cuando nadie les pisa el tamaño, y falla
// si el font-size computado cae fuera de la escala de Nest.
import { test, expect } from '@playwright/test'
import { launchHarness, teardown } from './helpers/harness'

// --fs-2xs … --fs-2xl. Cualquier tamaño fuera de este set no existe en el
// sistema (spec §2.2: "doce tamaños es lo mismo que ninguno").
const ESCALA_PX = [10, 11, 12, 13, 15, 17, 21]

// Las clases nativas de Tailwind que los primitivos stock inyectan hoy
// cuando nadie pisa su tamaño, y qué primitivo/variante las usa. Si se
// agrega un primitivo nuevo con un escalón nuevo (`text-lg`, `text-xl`...),
// súmalo acá — es la misma razón por la que este archivo existe.
const CLASES: Array<{ clase: string; origen: string }> = [
  { clase: 'text-sm', origen: 'buttonVariants base (ui/button.tsx) + Card/CardDescription default (ui/card.tsx)' },
  { clase: 'text-xs', origen: 'buttonVariants size="xs" (ui/button.tsx) + Badge (ui/badge.tsx) + Tooltip (ui/tooltip.tsx)' },
  { clase: 'text-fs-sm', origen: 'buttonVariants size="sm" (ui/button.tsx) — reemplazo de text-[0.8rem], Task 11 (I2b)' },
  { clase: 'text-base', origen: 'CardTitle default (ui/card.tsx)' },
]

test('las clases que los primitivos stock de ui/ inyectan por default resuelven a un tamaño de la escala', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    const medidos = await page.evaluate((clases: string[]) => {
      return clases.map((c) => {
        const el = document.createElement('div')
        el.className = c
        document.body.appendChild(el)
        const px = parseFloat(getComputedStyle(el).fontSize)
        el.remove()
        return { clase: c, px }
      })
    }, CLASES.map((c) => c.clase))

    for (const { clase, px } of medidos) {
      const origen = CLASES.find((c) => c.clase === clase)?.origen ?? ''
      expect(
        ESCALA_PX,
        `"${clase}" (${origen}) midió ${px}px en el DOM real — fuera de la escala [${ESCALA_PX.join('/')}]`
      ).toContain(px)
    }
  } finally {
    await teardown(h)
  }
})
