# Workspace shell — que las tres pantallas grandes dejen de parecer provisionales

**Problema que resuelve:** Personal, Teams y Memories son las tres superficies más
grandes de Nest y las tres se sienten básicas. No es una impresión: comparten una cáscara
que aparece de golpe, con una nav de lista plana, sin estado visible por fila y sin rastro
de que Nest es multi-IA.

**Alcance:** la cáscara compartida y su nav. No migra el contenido de ninguna de las tres
pantallas (eso viene después, pantalla por pantalla).

**Referencia visual:** Orca (onorca.dev). Capturas provistas por el usuario el 2026-09-10.
Lo que se toma prestado está justificado abajo, caso por caso.

---

## Contexto: qué hay hoy

Las tres montan la misma cáscara. `.teams-workspace` (`global.css:5193`):

```css
.teams-workspace {
  position: fixed; inset: 0;
  z-index: var(--z-overlay-base);
  background: var(--bg-app);
  display: flex; flex-direction: column; overflow: hidden;
}
```

Memories le suma `.memories-workspace { z-index: var(--z-overlay-top) }` (11920) y nada
más. Personal usa la misma cáscara.

Estructura interna: `-header` (con `padding-left: 86px` para los traffic lights de Mac)
→ `-body` (flex) → `-nav` (200px) │ `-content` │ `-presence` (220px) → `-terminal`
(36px, 120px expandido).

Navs:
- **Personal:** `activity`, `repos`, `issues`, `standup`, `pendings` (`PersonalWorkspace.tsx:50`)
- **Teams:** `chat`, `members`, `stats`, `snippets`, `workspaces`, `mcp` (`teamSections.ts`)
- **Memories:** ninguna — monta `TeamThreadPanel` directo

## Restricciones que manda el proyecto

Copiadas de `CLAUDE.md` y de la spec del rediseño; toda tarea las hereda.

- Tailwind SIN preflight. Nunca importar `"tailwindcss"` entero.
- Los tokens viven en `global.css`; `@theme inline` los expone. Una sola fuente de verdad.
- **El acento es acromático. El color es estado (`--ok`/`--warn`/`--destructive`), nunca
  marca.** La allow-list justificada cubre marca de terceros — los logos de IA entran ahí.
- Un componente nuevo se escribe con shadcn + utilidades, nunca con clases nuevas en
  `global.css`.
- Todo cambio de UI pasa `e2e/04-contraste.spec.ts`.
- Los estilos inline y el CSS sin capa le ganan a cualquier utilidad de Tailwind.

---

## Solución

### 1. La entrada deja de ser un corte

Hoy el overlay aparece y desaparece instantáneamente. La app **ya tiene** un lenguaje de
movimiento: 21 `@keyframes`, y en particular `zoomIn` + `backdropIn` con
`cubic-bezier(0.32, 0.72, 0, 1)` a 0.3s (`global.css:2287`, `2309`), usados por los
diálogos. Las tres pantallas más grandes son las únicas que no lo usan.

- **Entrada:** `zoomIn` + fade, 0.3s, con esa curva. La misma que los diálogos, para que
  la app se sienta una sola cosa.
- **Salida:** la inversa, 0.2s. Más rápida que la entrada — salir nunca debe hacerse
  esperar.
- **`prefers-reduced-motion: reduce`:** las animaciones se reducen a un fade de 0.1s. No
  se eliminan del todo: un corte seco a pantalla completa desorienta más que un fade
  corto.

**No se agrega ninguna librería de animación.** El proyecto no tiene ninguna (sólo
`tw-animate-css`, que es CSS) y no la necesita para esto.

### 2. La nav pasa de lista plana a filas con estado

Cada fila lleva, de izquierda a derecha: ícono, label, y a la derecha un **contador** y/o
un **dot de estado**.

- El **dot** usa los tokens de estado que ya existen: `--ok` (algo corriendo), `--warn`
  (algo requiere atención), `--destructive` (algo falló). Sin dot = nada que mirar.
- El **contador** es texto mono con `tabular-nums`, en `--muted-foreground`.

**Regla que evita que esto se vuelva un problema de datos:** *un contador se muestra sólo
si el dato ya está disponible sin un fetch nuevo.* No se agrega ninguna llamada de red
para pintar un número en la nav. Secciones cuyo dato requiere red y todavía no se visitó
sencillamente no muestran contador — no muestran cero, que sería mentira.

Hoy califica al menos `pendings` de Personal: el conteo de invitaciones ya se calcula y se
reporta hacia arriba vía `onPendingInvitesChange` (`PersonalWorkspace.tsx`). Las demás
secciones se evalúan una por una durante la implementación, contra esa regla.

**La sección activa se despega como card**: fondo `--accent`, borde `--input`, en vez del
gris apenas distinto de hoy. Es el tratamiento del ítem seleccionado en Orca, y coincide
con el tratamiento B de botones que ya se está aplicando (jerarquía por forma).

### 3. Los logos de IA entran en las filas

Es lo que más va a hacer visible que Nest es multi-IA, y **no necesita datos nuevos**:
`SessionPane` (`types.ts`) ya tiene `aiType` y `repoPath`. Agrupando los panes abiertos
por `repoPath` sale, para cada repo o worktree, el conjunto de IAs corriendo ahí.

- En las filas de **repos** y **worktrees**: los logos de las IAs que tienen un pane
  abierto en ese path. Máximo 3 visibles, y si hay más, un `+N`.
- Si no hay ningún pane en ese path, no se muestra nada. Un slot vacío no se rellena con
  un ícono gris.

`AILogos.tsx` ya tiene los 15 SVG y hoy sólo se usan en el picker, el header del pane, el
Hub y el popover de recursos.

**El color de marca de cada logo se respeta** — es la excepción explícita de la
constraint acromática (marca de un tercero), la misma que ya se aplicó en el picker.

### 4. Densidad

Orca mete el triple de información en el mismo alto y respira mejor. Lo que lo logra:

- **Mono para lo que es identificador** (rutas, nombres de rama, comandos), sans para
  labels y prosa. Nest ya tiene `--font-mono` puenteado.
- **Jerarquía por peso y color, no por tamaño.** El label en `--foreground` a 500, el
  metadato debajo en `--muted-foreground` un escalón más chico.
- **Padding de fila más ajustado**, dentro de la escala de tamaños que la migración de
  botones está fijando (24 / 28 / 32px). La nav no inventa una escala propia.

### 5. Los estados vacíos

Son lo que más "básico" se ve, y son la primera pantalla de cualquiera que recién entra.
Cada estado vacío de las tres pantallas pasa a tener: un título que dice qué falta, una
línea que dice por qué importa, y **una acción primaria** — el botón sólido del
tratamiento B. No un párrafo gris centrado.

---

## Flujo de datos

Nada de esto introduce una fuente de datos nueva.

- **Contadores:** los provee cada pantalla a la cáscara, ya calculados. La cáscara no
  consulta nada; recibe `{ section, count?, status? }` por sección y pinta.
- **Logos por fila:** derivados de los `SessionPane` abiertos, que el renderer ya tiene en
  memoria. Agrupación por `repoPath`, en un selector puro y testeable.
- **Animación:** puramente CSS. Sin estado en React, sin timers.

## Manejo de errores

- Un contador que no se puede calcular **no se pinta** (no se pinta cero ni un guión).
- Un `aiType` sin logo conocido **no renderiza nada**: `AILogo`
  (`AILogos.tsx:218`) hace `return Logo ? <Logo .../> : null` — no hay ícono genérico de
  respaldo. Una fila con un agente desconocido simplemente no muestra logo, que es
  preferible a inventar un placeholder gris.
- Si `prefers-reduced-motion` está activo, se toma el camino corto de fade. Nunca se
  bloquea la apertura esperando una animación.

## Testing

- `e2e/04-contraste.spec.ts` **es el gate**: la cáscara la comparten las tres pantallas,
  así que una regresión de contraste aparece en las tres a la vez.
- Capturas antes/después de las **tres** pantallas, guardadas fuera de `test-results/`
  (que está gitignoreado — ya se perdió evidencia por eso).
- Test unitario del selector que agrupa panes por `repoPath` → conjunto de `aiType`,
  incluyendo el caso de más de 3 IAs (el `+N`) y el de ninguna.
- Test de que un contador ausente no renderiza un cero.

## Fuera de alcance

- **Migrar el contenido** de Teams (914 líneas), Personal o Memories. Sólo la cáscara.
- **Eliminar los overlays.** Orca no los usa: todo vive en un shell persistente de tres
  columnas y nada tapa nada. Es probablemente la diferencia de fondo, y es una
  reestructuración de la app entera — se anota acá para que quede registrada, no se hace.
- La barra de cuotas por proveedor (es A1–A5 de `INTEGRATIONS_ORCA_BACKLOG.md`).
- El catálogo ampliado de agentes CLI.
- El grafo de Memories.
