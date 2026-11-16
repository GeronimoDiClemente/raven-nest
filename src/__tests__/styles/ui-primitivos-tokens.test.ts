import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

// I2 de la review final (2026-09-09): `ui/button.tsx:31` traía un
// `text-[0.8rem]` — un font-size ARBITRARIO que ningún token puede alcanzar
// nunca, porque no referencia ninguno. La regla del proyecto es que los
// archivos stock de `src/components/ui/` no se editan y el look sale de los
// tokens; un arbitrario ahí adentro rompe esa regla en el momento en que se
// escribe, no cuando alguien lo nota. Se corrigió a `text-fs-sm`, y ESTE
// test es lo que hace que la corrección dure: si alguien vuelve a correr
// `npx shadcn@latest add` y el CLI pisa el archivo con su arbitrario de
// nuevo, esto tiene que fallar en el momento, no en la próxima review.
//
// OJO con lo que este guard NO cubre (documentado para no perseguir
// fantasmas, ver review-final.md I2): la forma JSX `fontSize={9}` que usa
// `TeamThreadGraph.tsx:238,241` es consistente con la spec §4.4 — el grafo
// está fuera de alcance de la migración — así que este guard sólo mira
// `src/components/ui/`, nunca el resto de `src/`. No hay que "arreglar" esa
// forma acá.
const here = dirname(fileURLToPath(import.meta.url))
const uiDir = resolve(here, '../../components/ui')

const uiFiles = readdirSync(uiDir).filter((f) => f.endsWith('.tsx'))

describe('primitivos stock de ui/ — sin font-size arbitrario', () => {
  it('hay archivos para revisar (si esto falla, cambió la carpeta y el guard quedó ciego)', () => {
    expect(uiFiles.length).toBeGreaterThan(0)
  })

  it.each(uiFiles)('%s no usa un tamaño arbitrario tipo text-[Npx/rem/em]', (file) => {
    const src = readFileSync(join(uiDir, file), 'utf8')
    // `text-[...]` con un número + unidad de longitud es inequívocamente un
    // font-size (a diferencia de `text-[#fff]` o `text-[oklch(...)]`, que
    // son color y no nos interesan acá). Cualquier match es un escalón que
    // ningún --text-fs-* ni --fs-* puede alcanzar: tiene que salir de la
    // escala, no inventarse.
    expect(src).not.toMatch(/text-\[[\d.]+(?:px|rem|em)\]/)
  })
})
