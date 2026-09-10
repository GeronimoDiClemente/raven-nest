import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, extname } from 'node:path'

// Task 8c, Parte 2. La migracion Tailwind/shadcn borro clases que los e2e
// seguian asserteando por selector de clase (.sidebar-toggle,
// .sidebar-item-team[title="Team"]...) y nadie lo vio hasta la primera
// corrida completa de la suite. Este test cierra esa ventana: extrae cada
// selector de clase que un spec de e2e/ realmente usa y verifica que algun
// .tsx/.ts de src/ TODAVIA lo emita.
//
// Ojo metodologico (el que motivo este test): NO se busca contra src/ entero.
// global.css mantiene vivo el nombre de una clase mucho despues de que el
// ultimo componente que la pintaba se borro o se migro — `.sidebar-toggle`
// no aparecia como rota hasta acotar la busqueda a .tsx/.ts. La busqueda de
// abajo es explicitamente solo `.tsx`/`.ts`, y ademas excluye `__tests__/`:
// un mock de una suite de componentes puede escribir cualquier className de
// utileria sin que eso signifique que la app real la renderiza.
//
// Tambien ojo con la extraccion misma: un grep ingenuo de "cualquier punto
// seguido de letras" sobre el texto entero de un spec agarra falsos
// positivos que no son selectores en absoluto — por ejemplo
// `join(h.homeDir, '.vscode', 'extensions', 'acme.e2e-theme-1.0.0')` en
// editor-themes.spec.ts parece traer una clase `.e2e-theme-1`, pero es un
// fragmento de un nombre de carpeta fixture, nunca un argumento de
// `.locator(...)`. Por eso la extraccion de abajo solo mira DENTRO del
// primer argumento string de una llamada a `.locator(`, que es como Playwright
// realmente consume selectores CSS en esta suite (confirmado: ningun spec usa
// page.click/page.fill con selector de string suelto, ni waitForSelector) —
// y de yapa recorta el contenido de `[...]` antes de tokenizar, para no leer
// `.md` adentro de `[data-testid="dirty-README.md"]` como si fuera una clase.

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '..', '..', '..')
const E2E_DIR = resolve(REPO_ROOT, 'e2e')
const SRC_DIR = resolve(REPO_ROOT, 'src')

function listFilesRecursive(dir: string, predicate: (p: string) => boolean, skipDirNames: string[] = []): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (skipDirNames.includes(entry)) continue
      out.push(...listFilesRecursive(p, predicate, skipDirNames))
    } else if (predicate(p)) {
      out.push(p)
    }
  }
  return out
}

const e2eSpecFiles = listFilesRecursive(E2E_DIR, (p) => p.endsWith('.spec.ts'), ['helpers'])

// class -> spec files that reference it, para poder senalar donde arreglar.
const classUsage = new Map<string, Set<string>>()

const LOCATOR_CALL_RE = /\.locator\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g
const CLASS_TOKEN_RE = /\.[a-zA-Z_][\w-]*/g

for (const file of e2eSpecFiles) {
  const text = readFileSync(file, 'utf8')
  let m: RegExpExecArray | null
  LOCATOR_CALL_RE.lastIndex = 0
  while ((m = LOCATOR_CALL_RE.exec(text))) {
    // Recortar [...] (selectores de atributo) para que un valor entre comillas
    // como [data-testid="dirty-README.md"] no aporte una clase ".md" fantasma.
    const selector = m[2].replace(/\[[^\]]*\]/g, '')
    const classes = selector.match(CLASS_TOKEN_RE) ?? []
    for (const cls of classes) {
      const name = cls.slice(1) // sin el punto
      if (!classUsage.has(name)) classUsage.set(name, new Set())
      classUsage.get(name)!.add(file.slice(REPO_ROOT.length + 1))
    }
  }
}

// Corpus: todo .tsx/.ts de src/, salvo __tests__ (mocks/fixtures de test no
// cuentan como "la app lo renderiza").
const srcFiles = listFilesRecursive(
  SRC_DIR,
  (p) => ['.tsx', '.ts'].includes(extname(p)),
  ['__tests__'],
)
const srcCorpus = srcFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

function isEmittedBySomeComponent(className: string): boolean {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`)
  return re.test(srcCorpus)
}

// ── Allow-list: cada entrada es una clase que la extraccion de arriba
// encuentra en un .locator() de algun spec, y que HOY no aparece en ningun
// .tsx/.ts de src/ (fuera de __tests__) — pero que es una ausencia legitima,
// no un gate roto. Igual que la allowlist de acento-unico.test.ts: sumar una
// entrada nueva sin poder escribir una razon como las de abajo (DOM de
// terceros / clase compuesta en runtime / assert de ausencia explicito) no
// es una excepcion valida, es el bug que este test existe para agarrar.
const ALLOWLIST: Record<string, string> = {
  // DOM de terceros (Monaco): '.view-lines' es la superficie de contenido
  // editable que Monaco arma internamente; ningun .tsx nuestro la escribe via
  // className porque no es nuestra — ver e2e/editor.spec.ts, que la usa en
  // vez de la textarea interna de Monaco a proposito (comentario ahi mismo).
  'view-lines': 'DOM de Monaco (@monaco-editor/react), no lo emite ningun .tsx propio.',

  // Clase que un spec verifica que NO esta (toHaveCount(0)): la Task 10 saco
  // las tarjetas de memoria de Settings a proposito. El spec
  // 'Settings ya no tiene las tarjetas de memoria — solo la puerta'
  // (e2e/03-memories-in-app.spec.ts) prueba precisamente que no vuelvan.
  'memory-status-card': "assert de ausencia (toHaveCount(0)) — Task 10 la saco de Settings a proposito.",
  'memory-vault-card': "assert de ausencia (toHaveCount(0)) — Task 10 la saco de Settings a proposito.",

  // Idem, pero la clase nunca existio en src/ (git log -S confirma cero
  // commits que la agreguen): '.error-boundary-fallback' en team-stats.spec.ts
  // es un assert .not.toBeVisible() especulativo — documenta la intencion
  // ("que no aparezca un overlay de crash"), pasa siempre porque ningun
  // ErrorBoundary usa esa clase (usan estilos inline, ver ErrorBoundary.tsx /
  // PaneErrorBoundary.tsx). No es dano de esta migracion: nunca tuvo dientes.
  'error-boundary-fallback': 'assert de ausencia (.not.toBeVisible()) sobre una clase que nunca existio en src/.',
}

describe('los selectores de clase de e2e/ siguen vivos en src/', () => {
  it('cada clase que un spec usa en .locator(...) la emite algun .tsx/.ts (o esta en la allowlist justificada)', () => {
    const dead = [...classUsage.keys()]
      .filter((name) => !isEmittedBySomeComponent(name))
      .filter((name) => !(name in ALLOWLIST))
      .sort()

    if (dead.length > 0) {
      const detail = dead
        .map((name) => `  .${name}  (usada en: ${[...classUsage.get(name)!].join(', ')})`)
        .join('\n')
      throw new Error(
        `Selector(es) de clase muerto(s) en e2e/ — ningun .tsx/.ts de src/ los emite ` +
        `y no estan en la allowlist justificada de este test:\n${detail}\n\n` +
        `Si la migracion/refactor que los mato fue intencional, actualiza el spec para ` +
        `usar rol y nombre accesible (no la clase nueva). Si la ausencia es legitima ` +
        `(DOM de terceros, clase compuesta en runtime, o un assert que verifica que la ` +
        `clase NO esta), agregala a ALLOWLIST en este archivo con la razon.`,
      )
    }
  })

  // Guardrail sobre el propio test: si esto da 0, la extraccion se rompio
  // (por ejemplo un refactor de los specs a otro estilo de locator) y el test
  // de arriba pasaria por no encontrar nada que revisar, no porque este todo
  // vivo. Ajustar el numero de abajo cuando la suite de e2e crezca o encoja
  // de verdad, no para silenciar esto.
  it('la extraccion realmente encontro selectores para revisar (sanity check)', () => {
    expect(classUsage.size).toBeGreaterThan(10)
  })
})
