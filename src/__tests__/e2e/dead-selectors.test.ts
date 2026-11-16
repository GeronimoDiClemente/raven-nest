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
// Ojo metodologico #1 (el que motivo este test): NO se busca contra src/
// entero. global.css mantiene vivo el nombre de una clase mucho despues de
// que el ultimo componente que la pintaba se borro o se migro —
// `.sidebar-toggle` no aparecia como rota hasta acotar la busqueda a
// .tsx/.ts. La busqueda de abajo es explicitamente solo `.tsx`/`.ts`, y
// ademas excluye `__tests__/`: un mock de una suite de componentes puede
// escribir cualquier className de utileria sin que eso signifique que la
// app real la renderiza.
//
// Ojo metodologico #2 (extraccion del lado de los specs): un grep ingenuo de
// "cualquier punto seguido de letras" sobre el texto entero de un spec
// agarra falsos positivos que no son selectores en absoluto — por ejemplo
// `join(h.homeDir, '.vscode', 'extensions', 'acme.e2e-theme-1.0.0')` en
// editor-themes.spec.ts parece traer una clase `.e2e-theme-1`, pero es un
// fragmento de un nombre de carpeta fixture, nunca un argumento de
// `.locator(...)`. Por eso la extraccion de abajo solo mira DENTRO del
// primer argumento string de una llamada a `.locator(`, que es como Playwright
// realmente consume selectores CSS en esta suite (confirmado: ningun spec usa
// page.click/page.fill con selector de string suelto, ni waitForSelector) —
// y de yapa recorta el contenido de `[...]` antes de tokenizar, para no leer
// `.md` adentro de `[data-testid="dirty-README.md"]` como si fuera una clase.
//
// Ojo metodologico #3 (extraccion del lado de src/ — el que la review de
// este mismo test destapo): NO alcanza con un substring ciego sobre TODO el
// texto de un .tsx/.ts. Eso es el mismo punto ciego que el #1 de arriba,
// mudado de global.css a los componentes: un nombre de clase mencionado en
// un COMENTARIO, o en una cadena que no es el valor de className/class,
// "vive" para un substring ciego sin que React lo emita nunca al DOM. La
// review lo probo agregando `.totally-fake-ghost-class` a un locator y
// mencionando esa misma clase en un comentario de ErrorBoundary.tsx — el
// guard viejo daba verde. `extractClassAttributeText` de abajo por eso NO
// lee el archivo entero: solo el contenido de cada atributo
// `className=`/`class=`, sea un literal ("...") o una expresion completa
// ({...} — cn(...), template strings, ternarios, arrays/objetos de estilo),
// escaneando llaves balanceadas y sin contar un `}` que este adentro de un
// string/template literal como si cerrara la expresion.

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

// Selectores de atributo de clase completos (`[class*="foo"]`, `[class~="foo"]`,
// etc.) NO se parsean — se descartan enteros junto con el resto de `[...]`
// (ver el recorte mas abajo). Hoy ningun spec de esta suite usa uno (el
// unico `[...]` real es `[title="..."]`), pero si alguien agrega uno se
// volveria invisible para este guard SIN avisar. Esta sanity check es el
// aviso: si aparece un selector de atributo de clase, falla acá con un
// mensaje explicito en vez de dejarlo pasar en silencio. Extender el
// extractor para parsear `[class*=...]` de verdad es follow-up, no bloquea
// esta tarea porque el caso no existe todavia.
const CLASS_ATTRIBUTE_SELECTOR_RE = /\[\s*class(?:Name)?\s*[~*^$|]?=/

for (const file of e2eSpecFiles) {
  const text = readFileSync(file, 'utf8')
  let m: RegExpExecArray | null
  LOCATOR_CALL_RE.lastIndex = 0
  while ((m = LOCATOR_CALL_RE.exec(text))) {
    const rawSelector = m[2]
    if (CLASS_ATTRIBUTE_SELECTOR_RE.test(rawSelector)) {
      throw new Error(
        `${file.slice(REPO_ROOT.length + 1)} tiene un selector de atributo de clase ` +
        `(${JSON.stringify(rawSelector)}) que este guard no sabe parsear — hoy los ` +
        `descarta enteros junto con el resto de [...], asi que quedaria invisible en ` +
        `silencio. Extende CLASS_ATTRIBUTE_SELECTOR_RE / el parser de arriba antes de ` +
        `usar un selector asi, o cambialo por rol/nombre accesible.`,
      )
    }
    // Recortar [...] (selectores de atributo comunes, ej [title="..."]) para
    // que un valor entre comillas como [data-testid="dirty-README.md"] no
    // aporte una clase ".md" fantasma.
    const selector = rawSelector.replace(/\[[^\]]*\]/g, '')
    const classes = selector.match(CLASS_TOKEN_RE) ?? []
    for (const cls of classes) {
      const name = cls.slice(1) // sin el punto
      if (!classUsage.has(name)) classUsage.set(name, new Set())
      classUsage.get(name)!.add(file.slice(REPO_ROOT.length + 1))
    }
  }
}

// Extrae SOLO el contenido de los atributos className=/class= de un archivo
// fuente — ni comentarios, ni imports, ni el resto del cuerpo del
// componente. Cubre className="literal", className={cn(...)}, template
// strings, ternarios y arrays/objetos de estilo porque todos esos casos
// terminan siendo texto DENTRO de la expresion {...} que sigue a
// className= — no hace falta parsear JS de verdad, alcanza con encontrar
// donde termina esa expresion contando llaves balanceadas y saltando por
// encima de cualquier string/template literal (para no confundir un '}'
// que este adentro de un literal con el cierre real de la expresion).
function extractClassAttributeText(fileText: string): string {
  const chunks: string[] = []
  const ATTR_RE = /\bclass(?:Name)?\s*=\s*/g
  let m: RegExpExecArray | null
  while ((m = ATTR_RE.exec(fileText))) {
    const start = m.index + m[0].length
    const opener = fileText[start]
    if (opener === '"' || opener === "'") {
      let j = start + 1
      while (j < fileText.length && fileText[j] !== opener) {
        if (fileText[j] === '\\') j++
        j++
      }
      chunks.push(fileText.slice(start + 1, j))
      ATTR_RE.lastIndex = j + 1
    } else if (opener === '{') {
      let depth = 0
      let inString: string | null = null
      let j = start
      for (; j < fileText.length; j++) {
        const ch = fileText[j]
        if (inString) {
          if (ch === '\\') { j++; continue }
          if (ch === inString) inString = null
          continue
        }
        if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue }
        if (ch === '{') depth++
        else if (ch === '}') { depth--; if (depth === 0) break }
      }
      chunks.push(fileText.slice(start + 1, j))
      ATTR_RE.lastIndex = j + 1
    }
    // Ni comilla ni '{' despues de className=: forma rara que no reconocemos
    // (no vista en este repo) — se ignora esa ocurrencia puntual.
  }
  return chunks.join('\n')
}

// Corpus: SOLO lo que aparece dentro de un atributo className=/class= de
// algun .tsx/.ts de src/, salvo __tests__ (mocks/fixtures de test no cuentan
// como "la app lo renderiza"). Nada de comentarios, nada de codigo que
// simplemente MENCIONE el nombre de una clase sin asignarla.
const srcFiles = listFilesRecursive(
  SRC_DIR,
  (p) => ['.tsx', '.ts'].includes(extname(p)),
  ['__tests__'],
)
const srcCorpus = srcFiles.map((f) => extractClassAttributeText(readFileSync(f, 'utf8'))).join('\n')

function isEmittedBySomeComponent(className: string): boolean {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`)
  return re.test(srcCorpus)
}

// ── Allow-list: cada entrada es una clase que la extraccion de arriba
// encuentra en un .locator() de algun spec, y que HOY no aparece en ningun
// atributo className=/class= de ningun .tsx/.ts de src/ (fuera de
// __tests__) — pero que es una ausencia legitima, no un gate roto. Igual
// que la allowlist de acento-unico.test.ts: sumar una entrada nueva sin
// poder escribir una razon como las de abajo (DOM de terceros / clase
// compuesta en runtime / assert de ausencia explicito) no es una excepcion
// valida, es el bug que este test existe para agarrar.
const ALLOWLIST: Record<string, string> = {
  // DOM de terceros (Monaco): ninguno de los dos lo escribe nuestro codigo
  // via className, porque no es nuestro DOM.
  //   - '.view-lines' es la superficie de contenido editable que Monaco
  //     arma internamente — ver e2e/editor.spec.ts, que la usa en vez de la
  //     textarea interna de Monaco a proposito (comentario ahi mismo).
  //   - '.monaco-editor' es el contenedor raiz que Monaco crea solo; nuestro
  //     unico uso del nombre es CONSUMIRLO, no emitirlo — src/lib/editor-owns-shortcut.ts:11
  //     hace `target.closest('.monaco-editor')`. Con el guard viejo (substring
  //     ciego sobre el archivo entero) esta clase pasaba por casualidad,
  //     porque ese .closest(...) tambien contiene la palabra "monaco-editor"
  //     — no porque algun componente la pintara. Con la extraccion acotada a
  //     className=/class= (la que esta review pidio) ya no cuela por
  //     casualidad: entra a la allowlist con la razon real.
  'view-lines': 'DOM de Monaco (@monaco-editor/react), no lo emite ningun .tsx propio.',
  'monaco-editor': 'DOM de Monaco (@monaco-editor/react); nuestro codigo lo consume (.closest()) pero no lo emite.',

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
  it('cada clase que un spec usa en .locator(...) la emite algun .tsx/.ts en su className/class (o esta en la allowlist justificada)', () => {
    const dead = [...classUsage.keys()]
      .filter((name) => !isEmittedBySomeComponent(name))
      .filter((name) => !(name in ALLOWLIST))
      .sort()

    if (dead.length > 0) {
      const detail = dead
        .map((name) => `  .${name}  (usada en: ${[...classUsage.get(name)!].join(', ')})`)
        .join('\n')
      throw new Error(
        `Selector(es) de clase muerto(s) en e2e/ — ningun className/class de src/ los emite ` +
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

  // Sanity check del extractor del lado de src/: prueba en vivo, dentro de
  // la propia suite, el caso exacto que la review reprodujo (una clase que
  // solo aparece en un comentario no puede colar como "emitida").
  it('una clase mencionada solo en un comentario no cuenta como emitida (el caso de la review)', () => {
    const fakeSource = [
      'export function Fake() {',
      '  // .totally-fake-ghost-class no es un className, es solo texto',
      '  return <div className="real-class-de-mentira">hola</div>',
      '}',
    ].join('\n')
    const corpus = extractClassAttributeText(fakeSource)
    expect(new RegExp('(?<![\\w-])totally-fake-ghost-class(?![\\w-])').test(corpus)).toBe(false)
    expect(new RegExp('(?<![\\w-])real-class-de-mentira(?![\\w-])').test(corpus)).toBe(true)
  })
})
