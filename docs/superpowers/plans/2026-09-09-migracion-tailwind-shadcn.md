# Migración a Tailwind v4 + shadcn/ui — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Nest deje de estilarse a mano y pase a un sistema de componentes — Tailwind v4 + shadcn/ui + Radix, el mismo que usan Orca y Superset — conviviendo con las 12.104 líneas de `global.css` sin romper nada en el camino.

**Architecture:** Tailwind se instala **sin preflight**, así que no toca ni un estilo existente: sólo agrega utilidades. Los tokens que ya existen en `:root` (dirección «Nest Terminal», commits `c9d481f` y `d439f74`) se exponen al motor de Tailwind con `@theme inline`, de modo que `bg-card` y `text-muted-foreground` resuelvan a los MISMOS valores que usa el CSS viejo. Un componente migrado deja de usar sus clases viejas; las clases viejas se borran cuando ya no las usa nadie. Nunca hay un estado donde la app esté a medio migrar y rota.

**Tech Stack:** Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui (CLI 4.21+), Radix UI, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`. Electron 33 (Chromium 130). Vitest (jsdom) + Playwright.

**Spec:** `docs/superpowers/specs/2026-09-09-nest-terminal-ui-design.md`

## Alcance de este plan

La spec autoriza migrar los **107 componentes**. Enumerarlos como 107 tareas daría un documento que nadie puede ejecutar ni revisar. Este plan cubre:

1. **La fundación** (Tasks 1–5): que Tailwind y shadcn convivan con lo que hay, sin romperlo.
2. **El chrome** (Tasks 6–7): titlebar/tabs y sidebar — lo que se ve en todas las pantallas.
3. **Una pantalla entera** (Tasks 8–9): el overlay Memories y su grafo animado.
4. **La receta repetible** (Task 10): el procedimiento documentado para los ~100 que quedan, más el orden.

Los componentes restantes se migran aplicando la receta de la Task 10, en lotes, cada uno con su propio commit. No necesitan plan nuevo: necesitan la receta y el guard de contraste.

## Global Constraints

- **Convivencia, nunca big bang** (spec §4.2). Tailwind se suma; `global.css` se borra por partes, sólo cuando una clase deja de usarse.
- **Sin preflight.** El reset de Tailwind pisaría los estilos base de las 12k líneas. Se importan sólo las capas `theme` y `utilities`.
- **Los tokens no se redefinen.** `@theme inline` los *lee* de `:root`; la fuente de verdad sigue siendo el bloque de tokens de `global.css`.
- **El shell declara `bg-background text-foreground`** (spec §2.4). Sin eso, todo componente shadcn que no fija color propio queda ilegible — pasó en el spike.
- **Todo componente migrado pasa el guard de contraste** `e2e/04-contraste.spec.ts` (≥ 3:1) antes de commitear.
- **Escala tipográfica**: `--fs-2xs: 10px`, `--fs-xs: 11px`, `--fs-sm: 12px`, `--fs: 13px`, `--fs-lg: 15px`, `--fs-xl: 17px`, `--fs-2xl: 21px`. Pesos: `400 / 500 / 600`. Todo `font-size` nuevo sale de ahí.
- **El color es estado, nunca marca.** `--primary` es acromático (`#e8e8e8`). Verde/ámbar/rojo sólo para estado.
- **No se migran** (spec §4.4): xterm, Monaco, el grafo de nodos del board, y los colores de marca de terceros (`builtinCatalog.ts` tiene el azul de Atlassian).
- **Los tests son parte de la tarea.** 63 tests de jsdom consultan clases y estructura del DOM: migrar un componente le cambia el markup, así que arrastra sus tests. Un componente migrado con sus tests rotos no está migrado.

## File Structure

**Nuevos:**

| Archivo | Responsabilidad |
|---|---|
| `src/styles/tailwind.css` | Las capas de Tailwind y el `@theme inline` que expone los tokens de Nest al motor. Separado de `global.css` a propósito: es la capa nueva, y `global.css` es la que se va a ir borrando. |
| `src/lib/utils.ts` | `cn()` — el `clsx` + `tailwind-merge` que shadcn requiere. |
| `src/components/ui/*.tsx` | Los componentes shadcn, tal cual los escupe el CLI. **No se editan** (spec §2.4: el look sale de los tokens). |
| `components.json` | Config del CLI de shadcn. |

**Modificados:**

| Archivo | Qué cambia |
|---|---|
| `src/index.html` | Sacar el `<link>` a Google Fonts (Task 1). |
| `src/App.tsx:1759` | El shell declara `bg-background text-foreground`. |
| `electron.vite.config.ts` | El plugin de Tailwind y el alias `@/` en `renderer`. |
| `tsconfig.web.json` | `paths` para `@/`. |
| `vitest.config.ts` | El mismo alias, o los tests no resuelven `@/components/ui/*`. |
| `src/styles/global.css` | Importar `tailwind.css`; después, ir borrando clases muertas. |

---

### Task 1: Sacar la dependencia de red, y el contrato del shell

Dos cambios chicos que no dependen de Tailwind y que conviene tener antes: la app deja de pedirle fuentes a Google en cada arranque, y el shell declara el contrato que shadcn asume.

**Files:**
- Modify: `src/index.html`
- Modify: `src/App.tsx:1759`
- Test: `e2e/04-contraste.spec.ts` (ya existe, se usa como verificación)

**Interfaces:**
- Consumes: los tokens de `global.css` (`--background`, `--foreground`).
- Produces: el shell con color declarado, precondición de toda la migración.

- [ ] **Step 1: Sacar el `<link>` a Google Fonts**

En `src/index.html`, borrar la línea:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
```

Motivo, para que nadie la reponga: pide **Inter y JetBrains Mono, que el CSS no usa** — `--font-ui` ya apunta a Geist empaquetada y `--font-mono` a Geist Mono. Es una request de red en cada arranque de una app de escritorio, que en offline demora el primer pintado y que le avisa a Google cada vez que alguien abre Nest.

- [ ] **Step 2: Verificar que no quedó ninguna referencia a esas familias**

Run: `grep -rn "Inter\b\|JetBrains" src/index.html src/styles/global.css`
Expected: sin resultados. Si aparece alguno, esa regla hay que apuntarla a `var(--font-ui)` o `var(--font-mono)` antes de seguir.

- [ ] **Step 3: El contrato del shell**

En `src/App.tsx`, el div raíz (línea ~1759):

```tsx
    <div className="app bg-background text-foreground" style={{ '--tab-accent': activeTab.accentColor ?? 'var(--raven-blue)' } as React.CSSProperties}>
```

> Las clases todavía no hacen nada — Tailwind se instala en la Task 2. Se ponen ahora para que el diff de la Task 2 sea sólo configuración, y porque `.app` ya define `background` y `color`: cuando Tailwind entre, las utilidades ganan por orden de capa y el resultado es idéntico.

- [ ] **Step 4: Correr el guard de contraste**

Run: `npm run build && npx playwright test e2e/04-contraste.spec.ts`
Expected: PASS. Es la línea de base: de acá en adelante, cualquier tarea que lo rompa lo rompió ella.

- [ ] **Step 5: Commit**

```bash
git add src/index.html src/App.tsx
git commit -m "chore(ui): sacar el link a Google Fonts y declarar el contrato del shell"
```

---

### Task 2: Tailwind v4, sin tocar un estilo existente

El paso que da miedo y que hay que hacer con red. Tailwind v4 trae un reset (`preflight`) que normaliza márgenes, bordes y tipografía de todos los elementos — sobre 12.104 líneas de CSS escritas contra el default del navegador, eso rompe la app entera. Se importan **sólo las capas que suman**.

**Files:**
- Create: `src/styles/tailwind.css`
- Modify: `electron.vite.config.ts`
- Modify: `tsconfig.web.json`
- Modify: `vitest.config.ts`
- Modify: `src/styles/global.css` (una línea de import)
- Test: `src/__tests__/styles/tailwind-coexistencia.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: las utilidades de Tailwind disponibles en todo el renderer, y el alias `@/` resolviendo en build y en tests.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/styles/tailwind-coexistencia.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const raiz = resolve(here, '../../..')
const tw = readFileSync(resolve(raiz, 'src/styles/tailwind.css'), 'utf8')
const global = readFileSync(resolve(raiz, 'src/styles/global.css'), 'utf8')

describe('Tailwind convive con global.css', () => {
  // El chequeo central de toda la migración: preflight normaliza márgenes,
  // bordes y tipografía de TODOS los elementos, y las 12k líneas de global.css
  // están escritas contra el default del navegador. Importarlo rompe la app.
  it('NO importa preflight', () => {
    expect(tw).not.toMatch(/preflight/)
    expect(tw).not.toMatch(/@import\s+["']tailwindcss["']\s*;/)
  })

  it('importa sólo las capas theme y utilities', () => {
    expect(tw).toMatch(/@import\s+["']tailwindcss\/theme\.css["']\s+layer\(theme\)/)
    expect(tw).toMatch(/@import\s+["']tailwindcss\/utilities\.css["']\s+layer\(utilities\)/)
  })

  it('declara el orden de capas, con utilities al final', () => {
    const m = tw.match(/@layer\s+([^;]+);/)
    expect(m).not.toBeNull()
    const capas = m![1].split(',').map((c) => c.trim())
    expect(capas[capas.length - 1]).toBe('utilities')
  })

  // `@theme inline` LEE los tokens de :root en vez de redefinirlos. Si los
  // redefiniera habría dos fuentes de verdad para el mismo color y se
  // desincronizarían el día que alguien toque una sola.
  it('expone los tokens de Nest al motor sin redefinirlos', () => {
    expect(tw).toMatch(/@theme\s+inline\s*\{/)
    for (const t of ['background', 'foreground', 'card', 'popover', 'primary', 'border', 'muted-foreground']) {
      expect(tw).toContain(`--color-${t}: var(--${t});`)
    }
    // La fuente de verdad sigue siendo global.css.
    expect(global).toMatch(/--background:\s*#0a0a0a/)
  })

  it('global.css importa la capa nueva', () => {
    expect(global).toMatch(/@import\s+["']\.\/tailwind\.css["']/)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/__tests__/styles/tailwind-coexistencia.test.ts`
Expected: FAIL — `ENOENT` sobre `src/styles/tailwind.css`.

- [ ] **Step 3: Instalar**

```bash
npm install tailwindcss @tailwindcss/vite class-variance-authority clsx tailwind-merge lucide-react tw-animate-css
```

- [ ] **Step 4: Escribir `src/styles/tailwind.css`**

```css
/* La capa nueva del rediseño. Separada de global.css a propósito: esto es lo
   que se queda, y global.css es lo que se va a ir borrando componente por
   componente (spec §4.2).

   SIN PREFLIGHT, y no es una preferencia: preflight normaliza márgenes,
   bordes y tipografía de todos los elementos, y las 12.104 líneas de
   global.css están escritas contra el default del navegador. Importarlo
   rompe la app entera de una. Por eso se importan a mano sólo las dos capas
   que SUMAN — el tema y las utilidades — en vez del `@import "tailwindcss"`
   que las trae todas. */
@layer theme, base, components, utilities;

@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
@import "tw-animate-css";

/* `dark:` de shadcn. Nest no tiene tema claro: los tokens viven directo en
   `:root`. Pero los componentes que escupe el CLI usan `dark:` en algunos
   lugares, así que la variante tiene que existir y resolver — el shell lleva
   `class="dark"` (Task 4). */
@custom-variant dark (&:is(.dark *));

/* Los tokens de Nest, expuestos al motor de Tailwind.
   `inline` importa: hace que `--color-card` RESUELVA `var(--card)` en vez de
   copiar su valor. Así `bg-card` y el `background: var(--bg-surface)` del CSS
   viejo pintan literalmente el mismo color, y el día que se toque el token
   se mueven los dos. Sin `inline` habría dos fuentes de verdad. */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --radius-sm: calc(var(--radius) - 2px);
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) + 2px);

  --font-sans: var(--font-ui);
  --font-mono: var(--font-mono);

  /* La escala tipográfica del rediseño, disponible como `text-fs-sm` etc. */
  --text-fs-2xs: var(--fs-2xs);
  --text-fs-xs: var(--fs-xs);
  --text-fs-sm: var(--fs-sm);
  --text-fs: var(--fs);
  --text-fs-lg: var(--fs-lg);
  --text-fs-xl: var(--fs-xl);
  --text-fs-2xl: var(--fs-2xl);
}
```

- [ ] **Step 5: Importarla desde `global.css`**

Al principio de `src/styles/global.css`, antes del `:root`:

```css
/* La capa de Tailwind. Va PRIMERO para que las utilidades queden en su propia
   @layer: todo lo que está escrito abajo en este archivo es CSS sin capa, y el
   CSS sin capa le gana a cualquier @layer. O sea: mientras un componente siga
   usando sus clases viejas, esas clases mandan; en cuanto se le sacan, las
   utilidades de Tailwind toman el control. Es exactamente la convivencia que
   pide la spec §4.2, y sale del orden de capas, no de la especificidad. */
@import './tailwind.css';
```

- [ ] **Step 6: El plugin y el alias en `electron.vite.config.ts`**

Importar arriba:

```ts
import tailwindcss from '@tailwindcss/vite'
```

y en el bloque `renderer`:

```ts
  renderer: {
    root: 'src',
    resolve: {
      // shadcn genera imports con `@/`. Sin este alias, nada de components/ui resuelve.
      alias: { '@': resolve(__dirname, 'src') }
    },
    build: { /* … sin cambios … */ },
    plugins: [react(), tailwindcss()],
    optimizeDeps: {
      include: ['monaco-editor'],
    }
  }
```

- [ ] **Step 7: El alias en TypeScript y en Vitest**

En `tsconfig.web.json`, dentro de `compilerOptions`:

```json
    "paths": { "@/*": ["./src/*"] }
```

En `vitest.config.ts`, en el proyecto `jsdom` (y en el `node`, que también toca `src/`), al nivel del proyecto:

```ts
        resolve: {
          alias: { '@': resolve(__dirname, 'src') },
        },
```

con `import { resolve } from 'path'` arriba del archivo. Sin esto, los tests de cualquier componente migrado fallan con `Cannot find module '@/components/ui/button'` — y como los tests de componentes son 63, se rompe todo junto.

- [ ] **Step 8: Correr el test y verificar que pasa**

Run: `npx vitest run src/__tests__/styles/tailwind-coexistencia.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 9: Verificar que NO se rompió nada visualmente**

```bash
npm run build
npx playwright test e2e/04-contraste.spec.ts e2e/03-memories-in-app.spec.ts
npm test
```

Expected: los tres verdes. **Este es el step que importa de toda la tarea**: Tailwind entró y la app se ve exactamente igual. Si algo cambió, preflight se coló — revisar el Step 4.

- [ ] **Step 10: Commit**

```bash
git add src/styles/tailwind.css src/styles/global.css electron.vite.config.ts tsconfig.web.json vitest.config.ts src/__tests__/styles/tailwind-coexistencia.test.ts
git commit -m "feat(ui): Tailwind v4 conviviendo con global.css, sin preflight"
```

---

### Task 3: Que una utilidad de Tailwind pinte de verdad en la app

La Task 2 verificó la configuración leyendo archivos. Esto verifica lo único que importa: que el navegador aplique una clase de Tailwind con el valor de nuestro token. Es corta a propósito — es un gate, no una feature.

**Files:**
- Test: `e2e/05-tailwind-vivo.spec.ts`

**Interfaces:**
- Consumes: el `@theme inline` de la Task 2.
- Produces: la prueba de que `bg-card` y `var(--card)` son el mismo color.

- [ ] **Step 1: Escribir el test**

Crear `e2e/05-tailwind-vivo.spec.ts`:

```ts
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
      el.className = 'bg-card text-muted-foreground rounded-md'
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
        tokenBg: resolver(raiz.getPropertyValue('--card').trim()),
        tokenFg: resolver(raiz.getPropertyValue('--muted-foreground').trim()),
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
```

- [ ] **Step 2: Correr y verificar que pasa**

Run: `npm run build && npx playwright test e2e/05-tailwind-vivo.spec.ts`
Expected: PASS. Si `bg` vuelve `rgba(0, 0, 0, 0)`, Tailwind no está generando la utilidad — revisar que el plugin esté en `renderer.plugins`.

- [ ] **Step 3: Commit**

```bash
git add e2e/05-tailwind-vivo.spec.ts
git commit -m "test(ui): verificar que Tailwind pinta con los tokens de Nest"
```

---

### Task 4: shadcn — el CLI, `cn()`, y la clase `dark` en el shell

**Files:**
- Create: `components.json`, `src/lib/utils.ts`, `src/components/ui/button.tsx`
- Modify: `src/App.tsx:1759`
- Test: `src/__tests__/components/ui-button.test.tsx`

**Interfaces:**
- Consumes: el alias `@/` y el tema (Tasks 2–3).
- Produces: `cn(...inputs: ClassValue[]): string` desde `@/lib/utils`; `<Button variant size asChild>` desde `@/components/ui/button`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/components/ui-button.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

describe('shadcn en Nest', () => {
  it('cn() resuelve conflictos de Tailwind, no sólo concatena', () => {
    // Es la razón de existir de tailwind-merge: la última gana.
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-fs-sm', false && 'hidden', 'font-medium')).toBe('text-fs-sm font-medium')
  })

  it('el Button monta y respeta la variante', () => {
    render(<Button variant="secondary" size="sm">Guardar</Button>)
    const b = screen.getByRole('button', { name: 'Guardar' })
    expect(b).toBeInTheDocument()
    expect(b.className).toMatch(/bg-secondary/)
  })

  it('asChild delega en el hijo en vez de anidar botones', () => {
    render(<Button asChild><a href="#x">Ir</a></Button>)
    expect(screen.getByRole('link', { name: 'Ir' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/__tests__/components/ui-button.test.tsx`
Expected: FAIL — no resuelve `@/components/ui/button`.

- [ ] **Step 3: Inicializar shadcn**

```bash
npx shadcn@latest init -d -b radix --yes
```

> **Dos trampas verificadas el 2026-09-09, para que no se pierda media hora:**
> - En shadcn 4.21+ el flag `-b` **ya no es el color base**: es la base de primitives (`radix | base | aria`). Pasarle `neutral` falla con `Invalid enum value`.
> - El CLI reescribe `src/index.css` si lo encuentra. Acá el entrypoint de estilos es `src/styles/global.css`, así que hay que revisar el diff que deja: si tocó `global.css` agregando `@import "tailwindcss"` (con preflight), **hay que sacarlo** — rompe la Task 2.

- [ ] **Step 4: Traer el Button y verificar `cn`**

```bash
npx shadcn@latest add button --yes
```

Confirmar que `src/lib/utils.ts` quedó con:

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 5: La clase `dark` en el shell**

En `src/App.tsx` (línea ~1759):

```tsx
    <div className="app dark bg-background text-foreground" style={{ '--tab-accent': activeTab.accentColor ?? 'var(--raven-blue)' } as React.CSSProperties}>
```

> `dark` no cambia ningún color: los tokens de Nest viven en `:root` y no hay tema claro. Está para que las utilidades `dark:` que traen los componentes del CLI **resuelvan** en vez de quedar muertas. Sacarla hace que algunos estados (hover, disabled) pierdan su color sin ningún error visible.

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `npx vitest run src/__tests__/components/ui-button.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 7: Suite completa y guard**

```bash
npm test
npm run build && npx playwright test e2e/04-contraste.spec.ts
```

Expected: verdes. Traer un componente no cambia nada todavía — nadie lo usa.

- [ ] **Step 8: Commit**

```bash
git add components.json src/lib/utils.ts src/components/ui src/App.tsx src/__tests__/components/ui-button.test.tsx package.json package-lock.json
git commit -m "feat(ui): shadcn/ui instalado, con cn() y el Button de fabrica"
```

---

### Task 5: La primera migración de verdad — `TabBar`

El primer componente real, elegido por chico y por visible. Lo que salga de acá es **la receta** que van a seguir los otros cien, así que importa más el procedimiento que el resultado.

**Files:**
- Modify: `src/components/TabBar.tsx`
- Modify: `src/styles/global.css` (borrar las clases que dejen de usarse)
- Test: los que ya existan sobre TabBar, más `src/__tests__/components/TabBar-tokens.test.tsx`

**Interfaces:**
- Consumes: `cn`, `Button` (Task 4).
- Produces: la receta de la Task 10.

- [ ] **Step 1: Fotografiar el antes**

```bash
npm run build
npx playwright test e2e/03-memories-in-app.spec.ts
cp -r test-results/memories-in-app /tmp/antes-tabbar
```

Las capturas del antes son la única forma de discutir si el después quedó mejor o distinto.

- [ ] **Step 2: Ver qué tests dependen del markup actual**

Run: `grep -rln "TabBar\|tab-bar\|\.tab\b" src/__tests__/`
Expected: la lista de tests que hay que leer antes de tocar nada. Cada uno que consulte una clase que va a desaparecer se actualiza en el Step 5 — **no se borra**.

- [ ] **Step 3: Escribir el test de tokens**

Crear `src/__tests__/components/TabBar-tokens.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../../components/TabBar.tsx'), 'utf8')

describe('TabBar migrado', () => {
  it('no tiene literales de color', () => {
    // La regla que hace que la promesa "editá los tokens y se re-skinea toda la
    // app" sea cierta. Un componente migrado no decide colores: los consume.
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(src).not.toMatch(/rgba?\(\s*\d/)
  })

  it('no tiene tamaños de fuente sueltos', () => {
    // Todo font-size sale de la escala (--fs-*, o las utilidades text-fs-*).
    expect(src).not.toMatch(/fontSize:\s*\d/)
  })
})
```

- [ ] **Step 4: Correr el test para verificar que falla**

Run: `npx vitest run src/__tests__/components/TabBar-tokens.test.tsx`
Expected: FAIL — `TabBar.tsx` tiene literales hoy.

- [ ] **Step 5: Migrar el componente**

Reemplazar las clases de `global.css` por utilidades, siguiendo estas equivalencias (son las del tema, no inventadas):

| CSS viejo | Utilidad |
|---|---|
| `background: var(--bg-surface)` | `bg-card` |
| `background: var(--bg-elevated)` | `bg-popover` |
| `color: var(--text-primary)` | `text-foreground` |
| `color: var(--text-secondary)` | `text-muted-foreground` |
| `border: 1px solid var(--border)` | `border` |
| `border-radius: var(--radius)` | `rounded-md` |
| `font-size: 12px` | `text-fs-sm` |
| `font-size: 11px` | `text-fs-xs` |
| un literal de color cromático | **decidir**: si es estado → semántico; si es marca de un tercero → se deja y se anota por qué |

Los botones de la tab (cerrar, nuevo) pasan a `<Button variant="ghost" size="sm">`.

- [ ] **Step 6: Actualizar los tests que consultaban el markup viejo**

Los que salieron en el Step 2. Un test que buscaba `.tab-close-btn` ahora busca el rol y el nombre accesible:

```tsx
screen.getByRole('button', { name: /close/i })
```

Es mejor test que el anterior: sobrevive al próximo cambio de clases.

- [ ] **Step 7: Borrar las clases que quedaron muertas**

Para cada clase que TabBar dejó de usar:

```bash
grep -rn "nombre-de-la-clase" src/ --include="*.tsx" --include="*.ts"
```

Si no la usa nadie, se borra de `global.css`. **Si la usa otro componente, se deja** — es la regla de convivencia de la spec §4.2. Anotar en el commit cuántas líneas se fueron.

- [ ] **Step 8: Verificar**

```bash
npx vitest run src/__tests__/components/TabBar-tokens.test.tsx
npm test
npm run build && npx playwright test e2e/04-contraste.spec.ts e2e/03-memories-in-app.spec.ts
```

Expected: todo verde. Después comparar `test-results/memories-in-app` contra `/tmp/antes-tabbar` y **mirar las capturas**: el objetivo es que se vea igual o mejor, nunca distinto por accidente.

- [ ] **Step 9: Commit**

```bash
git add src/components/TabBar.tsx src/styles/global.css src/__tests__/
git commit -m "refactor(ui): TabBar a shadcn — la primera migracion, y la receta"
```

---

### Task 6: El titlebar y las tabs

Mismo procedimiento que la Task 5, sobre el chrome superior. Se separa de la Task 5 porque un reviewer puede aprobar la receta y rechazar esto, o al revés.

**Files:**
- Modify: `src/components/TitleBar.tsx` (o el que renderice el titlebar; confirmarlo con `grep -rn "titlebar-height" src/components/`)
- Modify: `src/styles/global.css`
- Test: los existentes, más un `-tokens` como el de la Task 5

- [ ] **Step 1: Identificar el componente y sus tests**

```bash
grep -rn "titlebar\|title-bar" src/components/*.tsx | head
grep -rln "titlebar" src/__tests__/
```

- [ ] **Step 2: Fotografiar el antes**

```bash
npm run build && npx playwright test e2e/03-memories-in-app.spec.ts
cp -r test-results/memories-in-app /tmp/antes-titlebar
```

- [ ] **Step 3: Escribir el test de tokens**

Igual que el de la Task 5 Step 3, apuntando al archivo del titlebar: sin literales de color, sin `fontSize` numérico.

- [ ] **Step 4: Migrar**

Con la tabla de equivalencias de la Task 5 Step 5. El pill de memoria (`389 MB`) pasa a `<Badge variant="outline" className="font-mono tabular-nums">` — traerlo con `npx shadcn@latest add badge --yes`.

- [ ] **Step 5: Actualizar tests, borrar clases muertas, verificar**

```bash
npm test
npm run build && npx playwright test e2e/04-contraste.spec.ts e2e/03-memories-in-app.spec.ts
```

Comparar capturas contra `/tmp/antes-titlebar`.

- [ ] **Step 6: Commit**

```bash
git add src/components src/styles/global.css src/__tests__/
git commit -m "refactor(ui): el titlebar a shadcn"
```

---

### Task 7: La sidebar

892 líneas, el componente más grande del chrome y el que se ve en todas las pantallas. Va sola porque es la que más riesgo tiene.

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/styles/global.css`
- Test: los existentes (`grep -rln "sidebar" src/__tests__/`), más `src/__tests__/components/Sidebar-tokens.test.tsx`

- [ ] **Step 1: Fotografiar el antes, expandida y colapsada**

El e2e `03-memories-in-app.spec.ts` ya cubre los dos estados. Correrlo y copiar las capturas a `/tmp/antes-sidebar`.

- [ ] **Step 2: Escribir el test de tokens**

Igual que la Task 5 Step 3, sobre `Sidebar.tsx`.

- [ ] **Step 3: Traer los componentes que hacen falta**

```bash
npx shadcn@latest add separator tooltip --yes
```

Las filas pasan a `<Button variant="ghost" size="sm" className="h-8 w-full justify-start gap-2.5 px-2.5 font-normal">`, y la activa a `variant="secondary"`. El tooltip es para el modo colapsado, donde hoy la etiqueta desaparece y no queda nada que la reemplace.

- [ ] **Step 4: Migrar por secciones, commiteando entre medio**

La sidebar tiene tres partes separables: las pestañas (Worktrees/Explorer/Tools), la lista, y el pie (New Terminal, Personal, Memories, usuario, Settings). Migrar una, verificar, commitear. Un rollback de 300 líneas es manejable; uno de 892 no.

- [ ] **Step 5: Verificar los dos estados**

```bash
npm test
npm run build && npx playwright test e2e/03-memories-in-app.spec.ts e2e/04-contraste.spec.ts
```

Expected: verde, incluidos los tests de orden de filas (`Personal → Memories → usuario → Settings`) y el del punto de estado en modo colapsado.

- [ ] **Step 6: Borrar las clases muertas y commitear**

```bash
git add src/components/Sidebar.tsx src/styles/global.css src/__tests__/
git commit -m "refactor(ui): la sidebar a shadcn, por secciones"
```

---

### Task 8: El overlay Memories

La primera pantalla entera. Es la que motivó todo esto («la pantalla de Memories se ve vacía»), así que además de migrarla hay que **resolver su estado vacío**, que es layout y no tokens.

**Files:**
- Modify: `src/components/MemoriesWorkspace.tsx`, `src/components/MemoriesStatusRow.tsx`
- Modify: `src/styles/global.css`
- Test: `src/__tests__/components/MemoriesWorkspace.test.tsx` (existe), más un `-tokens`

- [ ] **Step 1: Fotografiar el antes**

```bash
npm run build && npx playwright test e2e/03-memories-in-app.spec.ts
cp -r test-results/memories-in-app /tmp/antes-memories
```

- [ ] **Step 2: Escribir el test del estado vacío**

Agregar a `src/__tests__/components/MemoriesWorkspace.test.tsx`:

```tsx
it('sin repo abierto, la pantalla ofrece algo en vez de una frase suelta', () => {
  // El problema real medido en la captura del 2026-09-09: header, una tira de
  // estado, una frase y 80% de negro. El estado vacío tiene que dar una SALIDA,
  // no explicar por qué no hay nada.
  render(<MemoriesWorkspace onClose={() => {}} activeRepoPath={null} onOpenFile={() => {}} />)
  expect(screen.getByRole('button', { name: /vincular un repo|link a repo/i })).toBeInTheDocument()
  // Y lo que sí existe sin repo se muestra igual: la memoria global.
  expect(screen.getByText(/global/i)).toBeInTheDocument()
})
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `npx vitest run src/__tests__/components/MemoriesWorkspace.test.tsx`
Expected: FAIL — hoy sólo hay un `<p>` con la frase.

- [ ] **Step 4: Migrar la fila de estado**

Los micro-labels usan la clase `.microlabel` que ya existe (`global.css`, definida en el commit `d439f74`): mono, versalitas, tracking `.1em`. Los números en `font-mono tabular-nums`. Los chips de estado con `<Badge variant="outline">` y color semántico.

- [ ] **Step 5: Migrar el cuerpo y resolver el vacío**

Con repo: el panel del hilo. Sin repo: una `<Card>` con la memoria `__global__` (que siempre existe — ver `GLOBAL_PROJECT_KEY` en `electron/memory-project-key.ts`) y un botón que lleva a vincular un repo.

- [ ] **Step 6: Verificar**

```bash
npm test
npm run build && npx playwright test e2e/03-memories-in-app.spec.ts e2e/04-contraste.spec.ts
```

Comparar contra `/tmp/antes-memories` y mirar las capturas.

- [ ] **Step 7: Commit**

```bash
git add src/components src/styles/global.css src/__tests__/
git commit -m "refactor(ui): el overlay Memories a shadcn, y su estado vacio"
```

---

### Task 9: El grafo de Memories, con física

Spec §5.1. El grafo de hoy (`TeamThreadGraph.tsx`, 129 líneas) es SVG con posiciones precalculadas: no tiene física ni animación, y por eso no se siente como el de Obsidian.

**Files:**
- Create: `src/lib/force-layout.ts`
- Modify: `src/components/TeamThreadGraph.tsx`
- Test: `src/__tests__/lib/force-layout.test.ts`

**Interfaces:**
- Consumes: `buildThreadGraph` de `src/lib/team-thread-graph.ts` (ya existe).
- Produces:
  - `export interface ForceNode { id: string; x: number; y: number; vx: number; vy: number }`
  - `export interface ForceEdge { from: string; to: string }`
  - `export function stepForceLayout(nodes: ForceNode[], edges: ForceEdge[], opts?: { repulsion?: number; spring?: number; largo?: number; damping?: number }): void` — muta `nodes` un tick
  - `export function energiaTotal(nodes: ForceNode[]): number`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/lib/force-layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { stepForceLayout, energiaTotal, type ForceNode, type ForceEdge } from '../../lib/force-layout'

const nodos = (n: number): ForceNode[] =>
  Array.from({ length: n }, (_, i) => ({ id: `n${i}`, x: Math.cos(i) * 50, y: Math.sin(i) * 50, vx: 0, vy: 0 }))

const dist = (a: ForceNode, b: ForceNode) => Math.hypot(a.x - b.x, a.y - b.y)

describe('force-layout — Hooke + Coulomb, como Obsidian', () => {
  it('dos nodos sin arista se repelen', () => {
    const ns: ForceNode[] = [
      { id: 'a', x: -10, y: 0, vx: 0, vy: 0 },
      { id: 'b', x: 10, y: 0, vx: 0, vy: 0 },
    ]
    const antes = dist(ns[0], ns[1])
    for (let i = 0; i < 30; i++) stepForceLayout(ns, [])
    expect(dist(ns[0], ns[1])).toBeGreaterThan(antes)
  })

  it('dos nodos unidos por una arista se acercan al largo de reposo', () => {
    const ns: ForceNode[] = [
      { id: 'a', x: -300, y: 0, vx: 0, vy: 0 },
      { id: 'b', x: 300, y: 0, vx: 0, vy: 0 },
    ]
    const es: ForceEdge[] = [{ from: 'a', to: 'b' }]
    for (let i = 0; i < 400; i++) stepForceLayout(ns, es, { largo: 80 })
    expect(dist(ns[0], ns[1])).toBeLessThan(160)
  })

  // La propiedad que hace que el grafo "se acomode" en vez de vibrar para siempre.
  it('el sistema converge: la energía baja y se queda quieta', () => {
    const ns = nodos(12)
    const es: ForceEdge[] = [{ from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n0', to: 'n3' }]
    for (let i = 0; i < 50; i++) stepForceLayout(ns, es)
    const media = energiaTotal(ns)
    for (let i = 0; i < 600; i++) stepForceLayout(ns, es)
    const final = energiaTotal(ns)
    expect(final).toBeLessThan(media)
    expect(final).toBeLessThan(0.5)
  })

  it('lo denso queda más junto que lo aislado', () => {
    // El comportamiento visible de Obsidian: los clusters se agrupan al centro
    // y lo que no tiene aristas deriva al borde.
    const ns = nodos(6)
    const es: ForceEdge[] = [
      { from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n2', to: 'n0' },
    ]
    for (let i = 0; i < 800; i++) stepForceLayout(ns, es)
    const centro = (ids: string[]) => {
      const p = ns.filter((n) => ids.includes(n.id))
      return { x: p.reduce((s, n) => s + n.x, 0) / p.length, y: p.reduce((s, n) => s + n.y, 0) / p.length }
    }
    const c = centro(['n0', 'n1', 'n2'])
    const radio = (ids: string[]) =>
      Math.max(...ns.filter((n) => ids.includes(n.id)).map((n) => Math.hypot(n.x - c.x, n.y - c.y)))
    expect(radio(['n0', 'n1', 'n2'])).toBeLessThan(radio(['n3', 'n4', 'n5']))
  })

  it('nunca produce NaN, ni con dos nodos exactamente encima', () => {
    // Sin la distancia mínima, la repulsión divide por cero y todo el grafo
    // se vuelve NaN — y un SVG con NaN no dibuja nada, en silencio.
    const ns: ForceNode[] = [
      { id: 'a', x: 0, y: 0, vx: 0, vy: 0 },
      { id: 'b', x: 0, y: 0, vx: 0, vy: 0 },
    ]
    for (let i = 0; i < 20; i++) stepForceLayout(ns, [])
    for (const n of ns) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/__tests__/lib/force-layout.test.ts`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Escribir el módulo**

Crear `src/lib/force-layout.ts`:

```ts
// Layout force-directed, el mismo modelo que usa Obsidian (spec §5.1):
// repulsión tipo Coulomb entre TODOS los pares, atracción tipo Hooke en las
// aristas, y damping para que el sistema se frene en vez de vibrar.
//
// Puro y sin dependencias: un tick es una función que muta un array. Así la
// física se testea sin montar React ni pintar un SVG, que es donde este tipo
// de código se vuelve imposible de verificar.
//
// O(n²) por la repulsión de todos contra todos. Es lo correcto acá: el grafo
// del hilo se dibuja por proyecto y la spec de la fase 1 lo acota a ~200 nodos
// (40.000 pares por tick, nada para un requestAnimationFrame). Con más nodos
// habría que meter Barnes-Hut, y eso es otra tarea.

export interface ForceNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
}

export interface ForceEdge {
  from: string
  to: string
}

export interface ForceOpts {
  /** Fuerza de separación entre nodos. */
  repulsion?: number
  /** Rigidez del resorte de las aristas. */
  spring?: number
  /** Largo de reposo de una arista. */
  largo?: number
  /** Cuánta velocidad sobrevive a cada tick. <1 o no converge nunca. */
  damping?: number
}

/** Distancia mínima entre dos nodos para el cálculo de fuerzas.
 *  Sin esto, dos nodos exactamente encima dividen por cero y TODO el grafo se
 *  vuelve NaN — y un SVG con NaN no dibuja nada, sin ningún error. */
const MIN_DIST = 0.5

export function stepForceLayout(
  nodes: ForceNode[],
  edges: ForceEdge[],
  opts: ForceOpts = {}
): void {
  const repulsion = opts.repulsion ?? 3000
  const spring = opts.spring ?? 0.02
  const largo = opts.largo ?? 90
  const damping = opts.damping ?? 0.85

  const porId = new Map(nodes.map((n) => [n.id, n]))

  // Coulomb: todos contra todos, y simétrico (una pasada por par).
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      let d = Math.hypot(dx, dy)
      if (d < MIN_DIST) {
        // Superpuestos: se los separa en una dirección determinística en vez de
        // aleatoria, para que el layout sea reproducible entre corridas.
        dx = (i - j) || 1
        dy = 1
        d = Math.hypot(dx, dy)
      }
      const f = repulsion / (d * d)
      const ux = dx / d
      const uy = dy / d
      a.vx -= ux * f
      a.vy -= uy * f
      b.vx += ux * f
      b.vy += uy * f
    }
  }

  // Hooke: las aristas tiran hacia el largo de reposo.
  for (const e of edges) {
    const a = porId.get(e.from)
    const b = porId.get(e.to)
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.max(Math.hypot(dx, dy), MIN_DIST)
    const f = (d - largo) * spring
    const ux = dx / d
    const uy = dy / d
    a.vx += ux * f
    a.vy += uy * f
    b.vx -= ux * f
    b.vy -= uy * f
  }

  // Un empujón suave al origen: sin esto, un grafo sin aristas se expande para
  // siempre y se sale del viewBox.
  for (const n of nodes) {
    n.vx -= n.x * 0.0015
    n.vy -= n.y * 0.0015
    n.vx *= damping
    n.vy *= damping
    n.x += n.vx
    n.y += n.vy
  }
}

/** Energía cinética media. Sirve para saber cuándo parar de animar. */
export function energiaTotal(nodes: ForceNode[]): number {
  if (nodes.length === 0) return 0
  let e = 0
  for (const n of nodes) e += n.vx * n.vx + n.vy * n.vy
  return e / nodes.length
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/__tests__/lib/force-layout.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Cablearlo en el grafo**

En `src/components/TeamThreadGraph.tsx`, reemplazar las posiciones fijas por un `requestAnimationFrame` que llama a `stepForceLayout` y **se detiene solo** cuando `energiaTotal(nodes) < 0.05`. Dos reglas:

```tsx
  // Se frena solo: un rAF que corre para siempre mantiene la GPU despierta y le
  // come batería a una app que la gente deja abierta todo el día.
  if (energiaTotal(nodes) < 0.05) { cancelAnimationFrame(raf); return }
```

```tsx
  // Respetar prefers-reduced-motion: se corren los ticks de una y se pinta el
  // resultado, sin animar.
  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches
```

- [ ] **Step 6: Verificar en la app real**

```bash
npm run build && npx playwright test e2e/03-memories-in-app.spec.ts
```

Expected: PASS. Mirar la captura del overlay: el grafo tiene que estar dibujado y con los nodos separados, no amontonados en el centro.

- [ ] **Step 7: Commit**

```bash
git add src/lib/force-layout.ts src/components/TeamThreadGraph.tsx src/__tests__/lib/force-layout.test.ts
git commit -m "feat(ui): el grafo de Memories con fisica, como el de Obsidian"
```

---

### Task 10: La receta, y el orden de los cien que faltan

El entregable es un documento, y es lo que hace que este plan no necesite 107 tareas.

**Files:**
- Create: `docs/superpowers/RECETA-MIGRACION-UI.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Escribir la receta**

Crear `docs/superpowers/RECETA-MIGRACION-UI.md` con exactamente estos ocho pasos, que son los que se ejecutaron en las Tasks 5–8:

1. **Fotografiar el antes**: `npm run build && npx playwright test e2e/03-memories-in-app.spec.ts`, copiar `test-results/`.
2. **Listar los tests que dependen del markup**: `grep -rln "<clase>" src/__tests__/`.
3. **Escribir el test de tokens** del componente: sin literales de color, sin `fontSize` numérico.
4. **Migrar** con la tabla de equivalencias (§ abajo).
5. **Actualizar los tests** que consultaban clases, hacia rol y nombre accesible.
6. **Borrar las clases muertas** de `global.css` — sólo las que no usa nadie más (`grep`).
7. **Verificar**: `npm test`, y `npx playwright test e2e/04-contraste.spec.ts e2e/03-memories-in-app.spec.ts`.
8. **Mirar las capturas** contra el antes. Igual o mejor; nunca distinto por accidente.

Incluir la tabla de equivalencias de la Task 5 Step 5, y esta regla:

> **Un literal de color cromático que aparece al migrar no se convierte automáticamente.** Se decide: si es estado → semántico; si es marca de un tercero → se deja, con un comentario que diga de quién es. La primera pasada automática del 2026-09-09 se llevó puesto el azul de Atlassian en `builtinCatalog.ts` y hubo que revertirla. Quedan **54 ocurrencias** de 27 variantes de azul/violeta (`#a855f7`, `#3b82f6`, `#1a75ff`, `#4f9eff`…) esperando esa decisión, una por una.

- [ ] **Step 2: El orden de los que faltan**

En el mismo documento, la lista por frecuencia de uso, que es la que maximiza retorno visible por componente migrado:

1. `PaneHeader`, `TerminalPane` — se ven en cada pane, en todo momento.
2. `NewPaneDialog` (789 líneas) — el selector «Choose AI», que hoy es la pantalla más linda de la app y hay que no arruinarla.
3. `SettingsPanel` (720), `PersonalWorkspace` (996), `TeamsWorkspace` (914) — overlays enteros, autocontenidos.
4. `EditorPane` (797), `PRReview` (605), `BrowserCell` (551), `ResourceBarPopover` (652).
5. El resto, por tamaño ascendente.

- [ ] **Step 3: La nota en `CLAUDE.md`**

```markdown
## UI — Tailwind y shadcn conviven con global.css

La app está migrando a Tailwind v4 + shadcn/ui. Reglas que muerden:

- **Tailwind está SIN preflight** (`src/styles/tailwind.css`). No importes
  `"tailwindcss"` entero: trae el reset y rompe las 12k líneas de `global.css`.
- **Los tokens viven en `global.css`**, y `@theme inline` los expone al motor.
  No los redefinas en `tailwind.css`: habría dos fuentes de verdad.
- **Un componente nuevo se escribe con shadcn + utilidades**, nunca con clases
  nuevas en `global.css`.
- **Nada de literales de color.** El acento es acromático; el color es estado.
- **Todo cambio de UI pasa `e2e/04-contraste.spec.ts`** antes de commitear.
- La receta para migrar un componente: `docs/superpowers/RECETA-MIGRACION-UI.md`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/RECETA-MIGRACION-UI.md CLAUDE.md
git commit -m "docs(ui): la receta de migracion y el orden de los que faltan"
```

---

## Cobertura de la spec

| Sección | Dónde entra |
|---|---|
| §2.4 el contrato `bg-background text-foreground` | Task 1 Step 3 |
| §3.2 A2 tipografía | Hecho antes de este plan (`d439f74`); la escala se expone a Tailwind en la Task 2 |
| §3.2 A3 densidad y forma | Tasks 5–8, componente por componente |
| §4.1 Tailwind + shadcn + Radix | Tasks 2 y 4 |
| §4.2 convivencia, nunca big bang | Task 2 (sin preflight, orden de capas) y Task 5 Step 7 |
| §4.3.1 el shell | Task 1 |
| §4.3.2 el chrome | Tasks 5, 6, 7 |
| §4.3.3 los overlays | Task 8 (Memories), el resto por la receta |
| §4.4 lo que no se migra | Task 10 Step 1, como regla escrita |
| §4.5 los 63 tests que arrastran | Tasks 5–8, Step «actualizar los tests» |
| §5.1 Memories con onda Obsidian | Task 9 |
| §5.1 el plugin con onda engram | **Fuera** — es la fase 2 del plugin |
| §7.3 el estado vacío de Memories | Task 8 Steps 2 y 5 |
| §7.4 las 54 ocurrencias de azul | Task 10 Step 1, decididas una por una al migrar |

**Fuera de alcance a propósito:** los ~100 componentes que quedan (se hacen con la receta de la Task 10, en lotes); xterm y Monaco (spec §4.4); la TUI del plugin.

## Riesgos

1. **Preflight es el único cambio que puede romper todo de una.** Por eso la Task 2 tiene un test que verifica explícitamente que no se importa, y un step entero dedicado a comprobar que la app se ve igual después de instalar Tailwind.
2. **El CLI de shadcn reescribe archivos de estilos.** Busca `src/index.css`; acá el entrypoint es `src/styles/global.css`. Hay que leer el diff que deja después de `init` (Task 4 Step 3).
3. **Los 63 tests de jsdom.** El costo real no es migrar el componente, es actualizar sus tests. Un componente migrado con tests rotos no está migrado.
4. **La sidebar son 892 líneas.** Por eso la Task 7 la parte en tres y commitea entre medio: un rollback de 300 líneas es manejable.
5. **El rAF del grafo.** Un `requestAnimationFrame` que no se frena mantiene la GPU despierta en una app que la gente deja abierta todo el día. La Task 9 Step 5 lo corta por energía y respeta `prefers-reduced-motion`.
