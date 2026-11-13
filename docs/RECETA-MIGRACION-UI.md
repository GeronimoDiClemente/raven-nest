# Receta de migración a Tailwind v4 + shadcn/ui

Este documento es lo que hace que migrar los ~100 componentes que quedan
no necesite 100 tareas más. Se extrajo de las Tasks 5–8 del plan
`2026-09-09-migracion-tailwind-shadcn` (los commits que migraron `TabBar`,
`ResourceBar`, `Sidebar` y el overlay `Memories`), y de las tres formas en
que esa migración falló en silencio antes de que alguien lo notara.

Si estás por migrar el componente 37 de 102, seguí los ocho pasos en
orden. Si algo no anda como acá dice, leé primero la sección **Las tres
trampas** — es casi seguro que ya pasó antes.

## Los ocho pasos

1. **Fotografiar el antes.**

   ```bash
   npm run build && npx playwright test e2e/03-memories-in-app.spec.ts
   cp -r test-results/memories-in-app /tmp/antes-<componente>
   ```

   Las capturas del antes son la única forma de discutir si el después
   quedó mejor o distinto. Guardalas antes de tocar nada.

2. **Listar los tests que dependen del markup actual.**

   ```bash
   grep -rln "<clase-vieja>" src/__tests__/
   ```

   **Esto no alcanza.** Corré además:

   ```bash
   grep -rln "<clase-vieja>" e2e/
   ```

   La constraint original de este plan (Task 7) sólo nombraba *un*
   archivo de e2e en vez de mandar este grep, y se actualizó ese uno
   dejando tres afuera sin que nadie lo viera hasta que corrió la suite
   completa (`e2e/editor.spec.ts`, `e2e/editor-themes.spec.ts`,
   `e2e/team-stats.spec.ts` — los tres por `.sidebar-toggle` y
   `.sidebar-item-team[title="Team"]`, que la migración de `Sidebar` dejó
   de emitir). Ver **Trampa 3** más abajo antes de dar por completo este
   paso.

3. **Escribir el test de tokens del componente**, sin literales de color
   ni `fontSize` numérico. El molde es
   `src/__tests__/components/TabBar-tokens.test.tsx`:

   ```tsx
   it('no tiene literales de color', () => {
     expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
     expect(src).not.toMatch(/rgba?\(\s*\d/)
   })
   ```

   Correlo antes de migrar: tiene que fallar (el componente viejo sí
   tiene literales). Si pasa de entrada, el test no está probando nada.

4. **Migrar** con la tabla de equivalencias (más abajo). Antes de
   convertir un literal de color cromático que aparezca en el camino, leé
   **Trampa 1** y la nota sobre literales al final de este documento.

5. **Actualizar los tests que consultaban clases**, hacia rol y nombre
   accesible — nunca hacia la clase nueva:

   ```tsx
   screen.getByRole('button', { name: /close/i })
   ```

   Es mejor test que el anterior: sobrevive al próximo cambio de clases.
   Antes de dar el paso por terminado, revisá si tu `className` mezcla
   `cn(...)` con `text-fs-*` — **Trampa 2**.

6. **Borrar las clases muertas de `global.css`** — sólo las que no usa
   nadie más:

   ```bash
   grep -rn "nombre-de-la-clase" src/ --include="*.tsx" --include="*.ts"
   ```

   Si la usa otro componente, se deja (spec §4.2: convivencia, nunca big
   bang). Anotá en el commit cuántas líneas se fueron.

7. **Verificar.**

   ```bash
   npx vitest run src/__tests__/components/<componente>-tokens.test.tsx
   npm test
   npm run build && npx playwright test e2e/04-contraste.spec.ts e2e/03-memories-in-app.spec.ts
   ```

   Corré además `npx vitest run src/__tests__/e2e/dead-selectors.test.ts`
   — es el guard que cierra la Trampa 3, y te avisa si tu migración mató
   una clase que algún spec de `e2e/` todavía busca por selector.

8. **Mirar las capturas contra el antes.** Esto no es un trámite: **la
   captura es evidencia y el diff no alcanza**. Casi todos los hallazgos
   serios de esta migración salieron de mirar una imagen, no de leer un
   diff — texto blanco sobre fondo blanco que ningún test de tokens
   detecta (el test sólo regexea el *source*, no lo que quedó pintado), un
   punto de estado que se dibujaba en la esquina de la pantalla en vez de
   la esquina del elemento, un centrado que sólo funcionaba en el ancho
   del harness de test. Compará `test-results/` contra el `/tmp/antes-*`
   del paso 1: tiene que quedar igual o mejor, nunca distinto por
   accidente.

## Tabla de equivalencias

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
| un botón con estilos propios | `<Button variant="ghost" size="sm">` (u otra variante shadcn) |
| un literal de color cromático | **decidir** — ver la nota abajo, no convertir automático |

**Sobre el radio: hay un solo escalón.** `--radius-xs/sm/md/lg/xl/2xl/3xl/4xl` están
todos puenteados a `--radius` en `src/styles/tailwind.css`, y de `lg` en adelante
resuelven **al mismo valor** (8px). Eso es deliberado: Nest es una app compacta y tener
un solo lenguaje de radio es lo que hace que tocar `--radius` re-skinee todo. La
consecuencia es que **hoy no hay ningún escalón de Tailwind al que agarrarse para un
radio grande de verdad** (un modal, un hero). Si alguna vez hace falta uno, **no lo
resuelvas con un arbitrario `rounded-[16px]`** —eso es exactamente el agujero que la
Trampa 2 describe para los tamaños, en otra propiedad—: agregá el escalón al puente,
con su token, y decidí ahí qué significa.


## Las tres trampas

Las tres tienen la misma forma: no rompen el build, no rompen `npm test`
a simple vista, y nadie las nota hasta que alguien mira la app real o
corre la suite completa. Cada una tiene su detección.

### Trampa 1 — CSS sin capa le gana a cualquier utilidad de Tailwind

**Síntoma:** migrás un componente a `px-4`, `py-2`, `mb-3`... y en la app
no cambia nada. El elemento sigue pegado al borde como si la utilidad no
existiera.

**Causa:** `global.css` tenía `* { margin: 0; padding: 0 }` como regla
**sin capa** (fuera de cualquier `@layer`). El CSS sin capa le gana a
cualquier `@layer` sin importar la especificidad — es una regla de
*cascada por origen*, no de especificidad: los estilos de autor le ganan
al user-agent por origen, y las `@layer` sólo ordenan *dentro* del origen
de autor. Ese reset universal mataba **todo** `px-*`/`py-*`/`m*-*` de los
componentes ya migrados, y pasó semanas sin que nadie lo notara porque los
primeros usos migrados eran íconos de tamaño fijo, donde el padding no se
nota.

**Fix aplicado:** mover el reset adentro de `@layer base`
(`src/styles/global.css:180-185`, commit `7f7834f`). Ojo con la variante
inicial de ese fix (excluir `[data-slot]` del selector): cambiaba la
especificidad de `*` y empezaba a comerse selectores de un solo elemento
como `kbd` en toda la app — el fix bueno es mover la regla de capa, no
tocar el selector.

**Cómo se detecta:** si una utilidad de Tailwind "no hace nada" en la
app, buscá en `global.css` una regla **sin capa** que declare la misma
propiedad CSS. `grep -n "^@layer" src/styles/global.css` te muestra dónde
empiezan las capas — todo lo que quedó afuera de una gana por origen. Y un
dato que no se arregla solo: mover el reset a una capa **no devuelve** el
margen/padding por defecto del navegador (el user-agent stylesheet sigue
perdiendo contra cualquier regla de autor, tenga capa o no) — si algo
necesita ese margen de vuelta, hay que declararlo a mano.

### Trampa 2 — `cn()` puede comerse una clase en silencio

**Síntoma:** un componente migrado pierde su tamaño de fuente (o su
color) sin ningún error, sin ningún test rojo. Se ve mal en la app y en la
captura, pero el test de tokens pasa.

**Causa:** `tailwind-merge` (que usa `cn()` para resolver conflictos de
clases) clasificaba `text-fs-*` —la escala tipográfica propia del
rediseño— como **color**, no como *font-size*, porque comparte el prefijo
`text-` con un color de texto. Cualquier `cn(...)` que mezclara
`text-fs-sm` con `text-muted-foreground` (u otro color) perdía una de las
dos, porque `tailwind-merge` las trataba como dos "colores" en conflicto y
se quedaba con la última. Había **tres** casos vivos en componentes ya
aprobados: `TabBar.tsx:85` perdía `text-fs-sm`, `Sidebar.tsx:377` perdía
`text-fs`, y `ResourceBar.tsx:62` perdía `text-fs-sm`.

**Fix aplicado:** `extendTailwindMerge` en `src/lib/utils.ts` registra los
siete escalones de `--fs-*` en el grupo real `font-size` de
tailwind-merge (commit `b8db063`). El test que lo prueba en las dos
direcciones es `src/__tests__/lib/cn-escala.test.ts`.

**Cómo se detecta:** la regla general es **una utilidad con prefijo
propio que colisiona con un grupo de Tailwind hay que registrarla** en
`extendTailwindMerge`, no confiar en que tailwind-merge la adivine. Un
dato que importa para no perseguir fantasmas: los `className` de **string
plano** (sin pasar por `cn()`) no sufren esto — el problema es específico
de mezclar clases *dentro* de una llamada a `cn(...)`.

### Trampa 3 — migrar un componente rompe e2e que nadie listó

**Síntoma:** el componente migrado pasa todos sus tests, `npm test` da
verde, pero la primera vez que alguien corre la suite completa de
Playwright aparecen specs rotos que nadie tocó a propósito.

**Causa:** el paso "actualizar los tests que dependen del markup" se hizo
mirando una lista de archivos nombrados a mano en vez de un grep. Migrar
`Sidebar` cambió `.sidebar-toggle` y `.sidebar-item-team[title="Team"]`,
y sólo se actualizó el spec de e2e que estaba explícitamente nombrado en
el plan — quedaron **tres** rotos (`e2e/editor.spec.ts`,
`e2e/editor-themes.spec.ts`, `e2e/team-stats.spec.ts`) que nadie vio hasta
que corrió la suite entera.

**Cómo se detecta:** el paso 2 de esta receta — `grep -rln
"<clase-vieja>" e2e/` **además de** `src/__tests__/` — y el guard
`src/__tests__/e2e/dead-selectors.test.ts`, que extrae cada selector de
clase que un spec de `e2e/` usa en `.locator(...)` y falla si ningún
`.tsx`/`.ts` de `src/` lo sigue emitiendo (con una allow-list justificada
para DOM de terceros como Monaco, clases compuestas en runtime, y asserts
de ausencia). Un detalle que importa: **buscar la clase contra `src/`
entero da falsos negativos**, porque `global.css` mantiene vivo el
selector aunque ningún componente lo pinte más (`.sidebar-toggle` no
aparecía como rota hasta acotar la búsqueda a `.tsx`/`.ts`). Buscá
siempre contra los `.tsx`/`.ts`, nunca contra el árbol de estilos.

## El orden de los que faltan

Por retorno visible: los que se ven en todo momento primero, los overlays
enteros después, el resto por tamaño ascendente.

1. `PaneHeader` (313 líneas), `TerminalPane` (490) — se ven en cada pane,
   en todo momento.
2. `NewPaneDialog` (789 líneas) — el selector «Choose AI», que hoy es la
   pantalla más linda de la app y hay que no arruinarla.
3. `SettingsPanel` (722), `PersonalWorkspace` (996), `TeamsWorkspace`
   (914) — overlays enteros, autocontenidos.
4. `EditorPane` (797), `PRReview` (605), `BrowserCell` (551),
   `ResourceBarPopover` (652).
5. El resto de `src/components/*.tsx` (93 archivos más — ver el conteo
   abajo), por tamaño ascendente.

Fuera de alcance a propósito: xterm y Monaco (spec §4.4), la TUI del
plugin, y `src/components/ui/` (los primitivos que ya escupe shadcn).

**Estado al 2026-09-10:** de los 102 componentes en `src/components/*.tsx`
(sin contar `ui/` ni el subdirectorio `IntegrationPanel/`), 5 ya están
migrados — `TabBar.tsx`, `ResourceBar.tsx`, `Sidebar.tsx` (el chrome) y
`MemoriesWorkspace.tsx` + `MemoriesStatusRow.tsx` (el overlay Memories).
Quedan **97**. Medido con:

```bash
find src/components -maxdepth 1 -name "*.tsx" | wc -l                    # 102
grep -rl "from '@/lib/utils'\|from '@/components/ui/" src/components \
  --include="*.tsx" | grep -v "/ui/"                                     # los 5 migrados
```

## Un literal de color cromático no se convierte automáticamente

Se decide, uno por uno: si codifica un **estado** → token semántico
(`--ok`, `--warn`, `--destructive`); si es una **leyenda categórica** (no
un estado binario) → se puede dejar como literal con un comentario que
explique la categoría — es el caso de `.pr-badge.closed` / `.feed-type-badge.pr`
en `global.css:2673` y `:3334`, donde violeta y azul distinguen *tipo* de
evento (PR vs push vs issue), no severidad; si es **marca de un
tercero** → se deja, con un comentario que diga de quién es — el
`#0052CC` de Atlassian en `src/lib/plugins/builtinCatalog.ts:42` y el
`#24292e`/`#444c56` del botón de GitHub en `global.css:4119-4171` son
así. La primera pasada automática por regex del 2026-09-09 se llevó
puesto justamente ese azul de Atlassian y hubo que revertirla — no
asumas, mirá el selector de cada literal antes de tocarlo.

Medido hoy (2026-09-10), con un script que clasifica cada literal
`#RRGGBB` de `src/styles/global.css` por tono (195°–300°, la franja
azul-violeta) y saturación (≥30%, para no contar grises con un tinte
apenas azulado como `#6b7280` o `#cbd5e1`), y descarta comentarios que
sólo documentan un color ya retirado: quedan **44 ocurrencias de 24
variantes** esperando esa decisión — no las 54/27 que el plan original
estimó antes de que la Task 6b convirtiera 68 literales del acento viejo
y dejara 11 a propósito. La concentración más grande hoy es el bloque
`.ip-*` del panel de Integrations (`global.css:9991-10048`, 18
ocurrencias de 11 variantes) — un mini-tema azulado que no pasó por
ninguna task de esta migración todavía.

## La trampa del `asChild` — React 18 contra primitivos escritos para React 19

**El proyecto usa React 18.3.1, y los primitivos que escupe el CLI de shadcn hoy están
escritos para React 19: ninguno de los 8 de `src/components/ui/` usa `forwardRef`.**

En React 19 `ref` es una prop normal y no hace falta. En React 18 no: `asChild` de Radix
clona su hijo y le pasa un `ref`, y si el hijo no lo reenvía, **Radix nunca obtiene el nodo
que necesita para posicionar**.

Cómo se manifiesta, que es lo peor del asunto:

```tsx
<PopoverTrigger asChild>
  <Button>…</Button>       {/* Button no hace forwardRef */}
</PopoverTrigger>
```

El popover **monta**, el contenido **existe en el DOM**, y `expect(...).toBeVisible()` da
**verde** — pero se pinta con `position: static` **fuera de la pantalla**. Un test no lo
caza. Se descubrió mirando una captura.

**Qué hacer cuando combines `asChild` con un primitivo propio:**

1. La salida barata es no usar `asChild`: aplicar `buttonVariants()` directamente sobre el
   trigger de Radix, que sí reenvía su ref. Es lo que se hizo en
   `MemoriesStatusRow.tsx`.
2. La salida de fondo es agregarle `forwardRef` al primitivo — **pero entonces hay que
   hacerlo en los 8**, o el próximo que lo combine vuelve a caer.

Y la regla general que deja este caso: **si un elemento monta pero no se ve, mirá dónde
quedó posicionado antes de pelear con el color o la especificidad.** Las dos veces que pasó
en esta rama fue eso — una por `z-index` contra la escala de overlays, otra por un `ref`
perdido.
