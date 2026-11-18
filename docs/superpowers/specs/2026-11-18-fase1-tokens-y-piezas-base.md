# Fase 1 · Tokens y piezas base — spec

Fecha: 2026-11-18. Rama: `feat/ui-fase1-piezas` (sale de `feat/memories-settings`).
Referencia visual aprobada por Gero ("así se ve Nest", 18-nov): la maqueta
https://claude.ai/artifact/EQo535fMbsDhT9anbWqd1B. Orden de fases aprobado: 0 dirección
visual → **1 tokens y piezas base** → 2 vista visual A1 → 3 submenús → 4 sidebar → 5 A2 → 6 resto.

## Alcance

Tokens nuevos, radio a 8px, siete piezas nuevas en `src/components/ui`, una página de preview
y un check de CI. **No se migra ninguna pantalla**: las piezas se usan sólo en la preview.

Reglas del repo que aplican (CLAUDE.md): Tailwind sin preflight; los tokens viven en
`global.css` y `@theme inline` los expone; ninguna clase nueva en `global.css`; UI en inglés.

## Criterios de aceptación

### C1 · Tokens nuevos

En `:root` de `src/styles/global.css` (junto a los existentes, sin tocar los demás):

| Token | Valor |
|---|---|
| `--sidebar` | `#0f0f0f` |
| `--sidebar-row-hover` | `rgb(255 255 255 / 0.05)` |
| `--sidebar-row-active` | `rgb(255 255 255 / 0.08)` |
| `--sidebar-row-selected` | `#262626` |
| `--sidebar-inset` | `8px` |
| `--ok-surface` | `rgb(74 222 128 / 0.10)` |
| `--warn-surface` | `rgb(227 179 65 / 0.10)` |
| `--destructive-surface` | `rgb(255 101 104 / 0.10)` |
| `--info` | `#8fb8ff` |
| `--info-surface` | `rgb(143 184 255 / 0.10)` |

Si alguno ya existe con otro nombre o valor, el implementador lo reporta en vez de duplicarlo.

`@theme inline` en `src/styles/tailwind.css` expone los colores: `--color-sidebar`,
`--color-sidebar-row-hover`, `--color-sidebar-row-active`, `--color-sidebar-row-selected`,
`--color-ok-surface`, `--color-warn-surface`, `--color-destructive-surface`, `--color-info`,
`--color-info-surface`; y `--spacing-sidebar-inset: var(--sidebar-inset)`.

**Chequeo:** `e2e/05-tailwind-vivo.spec.ts` suma un test que pinta un elemento con
`bg-sidebar-row-selected`, `bg-ok-surface` y `text-info` y compara lo pintado con el valor del
token (mismo método que el test existente). Las clases tienen que aparecer en un archivo de
`src/` que Tailwind escanee (las piezas de C3 las usan), no sólo en el `.spec.ts`.

### C2 · Radio a 8px en toda la app

`--radius` pasa de `0.375rem` a `0.5rem` (8px). `rounded-md` pinta 8px.

**Chequeo:** el test existente de `05` ya compara `rounded-md` con `--radius`; se le suma que
`--radius` resuelve a `8px`. Antes del cambio tiene que fallar.

### C3 · Siete piezas en `src/components/ui`

Cada una en su archivo, exportada con este nombre y estas props. Todas aceptan `className`
(mezclada con `cn` de `@/lib/utils`) y pasan el resto de props al elemento raíz.

1. **`list.tsx` → `List`, `ListRow`.** `List` es un contenedor con borde `border-border`,
   `rounded-md`, fondo `bg-card` y filas separadas por borde. `ListRow` props:
   `selected?: boolean`, `onClick?`. Con `onClick` renderiza `<button type="button">`; sin él,
   `<div>`. Pone `data-selected="true"` cuando `selected`. Seleccionada usa
   `bg-sidebar-row-active`; hover en la variante botón usa `bg-sidebar-row-hover`.
2. **`status-badge.tsx` → `StatusBadge`.** Props: `tone: 'ok' | 'warn' | 'destructive' |
   'info' | 'muted'`, `children`. Píldora con texto del tono sobre su `*-surface`
   (`muted`: `text-muted-foreground` sobre `bg-sidebar-row-active`). Pone `data-tone`.
3. **`callout.tsx` → `Callout`.** Props: `tone: 'warn' | 'destructive' | 'info'`,
   `title: ReactNode`, `children?` (descripción), `action?: ReactNode`. Fondo `*-surface` del
   tono, título en `font-medium`, descripción en `text-muted-foreground`, la acción a la derecha.
   `role="status"`. Pone `data-tone`.
4. **`empty-state.tsx` → `EmptyState`.** Props: `title: ReactNode`, `description?`,
   `action?`. Caja con borde punteado `border-dashed`, centrada.
5. **`segmented.tsx` → `Segmented`.** Props: `options: { value: string; label: ReactNode }[]`,
   `value: string`, `onValueChange: (v: string) => void`, `aria-label: string`. Un `<button
   type="button">` por opción dentro de un contenedor `role="group"` con ese `aria-label`; la
   elegida lleva `aria-pressed="true"` y `bg-sidebar-row-selected`; las otras
   `aria-pressed="false"`. Clic en una opción llama `onValueChange(value)`.
6. **`nav-row.tsx` → `NavRow`.** Props: `selected?`, `icon?: ReactNode`, `count?: ReactNode`,
   `countTone?: 'default' | 'warn'`, `children`, `onClick?`. Siempre `<button type="button">`.
   Estados: hover `bg-sidebar-row-hover`, activo `bg-sidebar-row-active`, `selected`
   `bg-sidebar-row-selected` + `text-foreground` + `aria-current="true"`. El `count` va a la
   derecha con `tabular-nums`; con `countTone="warn"` en `text-warn`.
7. **`kbd.tsx` → `Kbd`.** Renderiza `<kbd>` con fuente mono, borde y `rounded-sm`.

Ninguna pieza usa literales de color: sólo tokens vía utilidades.

**Chequeo:** tests de vitest + Testing Library en `src/__tests__/components/ui-*.test.tsx`
(uno por pieza) que verifican el contrato de arriba (elemento renderizado, atributos `data-*`,
`aria-*`, callbacks, clases de token). Los escribe el agente `autor-de-tests` desde este spec,
antes de la implementación, y tienen que fallar antes.

### C4 · Página de preview

Un componente `src/components/ui-preview/UiPreview.tsx` muestra todas las piezas de C3 en todas
sus variantes, con datos de ejemplo de la maqueta (en inglés), sobre `bg-background`.

Se ve sólo si el proceso arranca con la variable de entorno `NEST_UI_PREVIEW=1`; sin ella, la
app arranca igual que hoy. El mecanismo (cómo main le avisa al renderer) lo elige el
implementador, sin abrir una vía nueva para que una página web externa lo active.

**Chequeo:** un e2e nuevo `e2e/21-piezas-base.spec.ts` lanza la app con
`NEST_UI_PREVIEW=1` (usando `e2e/helpers/harness`) y: (a) encuentra las siete piezas por su
rol o `data-*`; (b) corre sobre la preview el mismo chequeo de contraste que
`e2e/04-contraste.spec.ts` (reusando su lógica, sin copiarla si se puede extraer a
`e2e/helpers`). Un segundo test lanza sin la variable y verifica que la preview NO aparece.

### C5 · Check de CI contra clases y literales nuevos

Un script `scripts/check-ui-tokens.mjs` que falla (exit 1, con archivo y línea) si, en el diff
contra la rama base:

- `src/styles/global.css` suma una línea que no sea vacía, comentario, o declaración de
  custom property (`--nombre: valor;`);
- un archivo `.tsx`/`.ts`/`.css` nuevo o tocado bajo `src/components/ui/` o
  `src/components/ui-preview/` contiene un literal de color (`#rgb`, `#rrggbb`, `#rrggbbaa`,
  `rgb(`, `rgba(`, `hsl(`, `hsla(`).

La lógica va en funciones puras exportadas (`addedLinesViolations(path, lines)`,
`findColorLiterals(source)`) para poder testearlas sin git. Se suma como step del job `test` de
`.github/workflows/ci.yml`, con la base `origin/${{ github.base_ref }}` en PRs y
`origin/main` en push.

**Chequeo:** tests de vitest para las dos funciones puras con casos que pasan y que fallan
(incluido un `#fff` dentro de un comentario: cuenta, porque se mira cada literal). Correr el
script sobre esta rama da exit 0.

### C6 · Ninguna pantalla cambia salvo por el radio

**Chequeo:** capturas antes/después de la app con un repo abierto, Settings y Memories. Las
diferencias aceptables son sólo esquinas. Se hace a mano y se dice si no se pudo.

### C7 · Verde de punta a punta

- `npx tsc -p tsconfig.node.json --noEmit --composite false` y
  `npx tsc -p tsconfig.web.json --noEmit --composite false`: exit 0, cero errores.
- `npm test` en verde.
- `npm run build` y después `npx playwright test e2e/04-contraste.spec.ts
  e2e/05-tailwind-vivo.spec.ts e2e/21-piezas-base.spec.ts` en verde.
- `node scripts/check-ui-tokens.mjs` exit 0.

### C8 · Cada pieza se pinta como el lienzo

Agregado el 18-nov después de ver la preview: las clases eran las correctas pero se pintaba el
botón del navegador (borde 3D) y otros tamaños. La referencia es el CSS de
`Main.dc.html` de la maqueta EQo535fMbsDhT9anbWqd1B.

Tokens nuevos en `:root` (expuestos como `--color-*`): `--border-strong: rgb(255 255 255 / 0.15)`
y `--subtle: #7a7a7a`. El `--radius-row` de la maqueta (6px) es `rounded-sm` (radius − 2px):
no se crea token.

Valores computados que tiene que dar cada pieza en la preview (la preview hereda 13px y
line-height 1.45 en su raíz, como `.app` de la maqueta):

| Pieza | Valores |
|---|---|
| Todo `<button>` de una pieza | `border-style` none salvo donde la tabla pida borde; fondo transparente salvo estado; `font-family` heredada; sin subrayado |
| `NavRow` | `min-height` 30px, `padding` 6px 8px, radio 6px, 13px, color `muted-foreground`; seleccionada fondo `sidebar-row-selected` y color `foreground`; `count` 11px, color `subtle` (`warn` con `countTone="warn"`) |
| `Segmented` | contenedor con borde 1px `border-strong`, radio 6px, sin separación entre opciones (`overflow: hidden`); cada opción 11.5px, `padding` 4px 10px, `min-height` 26px, sin borde propio |
| `List` / `ListRow` | `ListRow` `min-height` 46px, `padding` 10px 14px, separador `border-top` 1px `border` salvo la primera |
| `StatusBadge` | 11.5px, `padding` 2px 8px, radio pill |
| `Callout` | `padding` 12px 14px, radio 8px, borde 1px del color del tono al 35% |
| `EmptyState` | borde 1px dashed `border-strong`, radio 8px, `padding` 40px 24px |
| `Kbd` | mono, 10.5px, borde 1px `border-strong`, radio 4px, `padding` 0 5px |
| Botones de acción de la preview (Resume, New session) | se ven como `.btn.sm` de la maqueta: 11.5px, `padding` 3px 9px, `min-height` 26px, borde 1px `border-strong`, radio 6px |

**Chequeo:** un e2e en `e2e/21-piezas-base.spec.ts` mide `getComputedStyle` de cada pieza en la
preview contra la tabla (colores resueltos desde los tokens, no hardcodeados) y falla antes del
arreglo. Además, captura de la preview junto a la maqueta para que Gero la vea.

## Fuera de alcance

Migrar pantallas, la sidebar nueva, la vista visual, tema claro, tocar `global.css` fuera de
`:root`.
