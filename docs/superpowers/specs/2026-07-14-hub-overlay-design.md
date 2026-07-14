# Hub — vista compacta de terminales cross-workspace (overlay)

**Fecha:** 2026-07-14
**Estado:** propuesta — se implementa en `feat/hub-overlay` y queda como PR para review del equipo. No se mergea sin OK explícito.
**Autor:** Matías (diseño asistido)

## Problema

Cada workspace (tab) muestra solo sus propios panes. Con agentes corriendo en 2–3 workspaces a la vez, no hay forma de ver qué está pasando en los demás ni de responder un prompt de otro workspace sin cambiar de tab a ciegas y volver. El único indicio actual es el punto verde de actividad en la pestaña (`.tab-activity-dot`), que no dice qué pane ni qué necesita.

## Solución (v1)

Un overlay **"Hub"** que se abre con `Ctrl+Shift+O` (`Cmd+Shift+O` en Mac) por encima del workspace actual y muestra en grilla todas las terminales vivas de todos los workspaces. Es **interactivo**: lo que se tipea va a la terminal enfocada. `Esc` cierra y devuelve el foco exactamente al pane previo.

Mockups aprobados: variante B (overlay) de la comparativa A/B/C. La grilla se construye como componente independiente del contenedor para poder promoverla más adelante a un workspace fijo "Hub" (variante A) sin rehacer nada.

### Puntos de entrada

1. Atajo global `Ctrl/Cmd+Shift+O` (toggle).
2. Entrada "Hub: ver todas las terminales" en la Command Palette.
3. Botón en la tab bar (a la derecha del `+`), con punto de actividad cuando algún pane de un workspace no visible tiene actividad.

### Qué muestra cada tile

Mismo lenguaje visual del pane actual (borde `color-mix` con `--pane-color`, header teñido, punto de color, label del AI en mayúsculas, cuenta) más:

- **Chip del workspace de origen** (estilo `.pane-pid-chip`, azul) con el nombre del tab.
- Label de actividad existente (`.pane-activity-label`) / badge `ended` si el proceso murió.
- Botón de **pin** en el header del tile.
- Contenido: xterm real conectado al PTY existente (replay de las últimas ~200 líneas del buffer + stream en vivo).

### Filtros (fila superior del overlay)

`Todas` (default) · `Activas` (busy o con actividad reciente) · `Pineadas` · chips por workspace. El último filtro elegido se recuerda en `localStorage` (no amerita tocar el formato de sesión). Contadores por filtro.

### Interacciones

| Gesto | Acción |
|---|---|
| Click en tile | Foco: el teclado va a esa terminal |
| `Tab` / `Shift+Tab` | Ciclar foco entre tiles |
| Doble click o `Enter` sobre tile enfocado | Saltar a ese pane en su workspace (cierra overlay, activa el tab, enfoca el pane) |
| `Esc` | Cerrar overlay y devolver foco al pane previo |
| Pin en header | Alterna `pinned` del pane |
| `Ctrl/Cmd+Shift+O` | Toggle abrir/cerrar |

Con más de 12 tiles tras filtrar: paginación simple (12 por página), para acotar la cantidad de xterms vivos.

## Adición aprobada (2026-07-14): Hub como workspace desde el `+`

Además del overlay, el Hub se puede crear como **una pestaña más**. Interacción elegida (mockup "A"): el `+` crea un workspace vacío como hoy (un click, sin cambios); en su **estado vacío** (`EmptyState`), junto a "+ New Terminal", aparece **"▦ Ver todas las terminales (Hub)"**. Al tocarlo, ese tab se convierte en la vista Hub (nombre → "Hub", ícono ▦ en la pestaña) y su contenido es la grilla de todas las terminales de los demás workspaces. El overlay (`Ctrl/Cmd+Shift+O`) se mantiene igual; ambos comparten el mismo núcleo `HubView`.

- La grilla del overlay se refactoriza a `HubView` (toolbar de filtros + paginación + teclado + `HubGrid`). `HubOverlay` pasa a ser un wrapper (backdrop + título + `HubView`); `HubWorkspace` monta `HubView` inline como contenido del tab activo.
- Un tab Hub tiene `isHub: true` y `panes: []`; se excluye de las fuentes/chips de filtro. Cuando es el tab activo, los demás tabs quedan inactivos → sus `TerminalPane` reales desmontados → los tiles del Hub son la única vista de esos PTYs (sin doble-vista, más limpio que el overlay).
- `isHub` persiste en la sesión (save/restore/migrate). El botón del `EmptyState` solo aparece si hay terminales en algún otro workspace.
- Limitación conocida (v1): si restaurás la sesión con el tab Hub activo, los PTYs de los otros tabs aún no existen (se crean al montar sus `TerminalPane`), así que esos tiles se ven vacíos/ended hasta visitar esos tabs una vez. Se documenta en el PR.

## Fuera de alcance (v1)

- Panel lateral persistente (variante C).
- Detección fina de "esperando input" (heurísticas de prompt): v1 usa las señales existentes (busy/actividad/idle/ended).
- Broadcast cross-workspace desde el Hub.
- Reordenar/mover panes desde el Hub.

## Arquitectura

Sin IPC nuevo y sin store nuevo. Todas las piezas existen:

- **PTYs**: viven en el main process para todos los workspaces (`electron/pty-manager.ts`, `Map<paneId, IPty>` + buffer de 10k líneas). `window.pty.write(paneId, …)` ya es global.
- **Datos**: `tabs.flatMap(t => t.panes)` en `App.tsx` (fuente única de verdad; el overlay no copia estado).
- **Stream**: `subscribeToPtyData` (`src/pty-events.ts`) entrega `(paneId, data)` de todas las terminales con un solo listener.
- **Estado de actividad**: `busyPanes` y `tabActivity` existentes en `App.tsx`.

### Componentes nuevos (`src/components/`)

1. **`HubOverlay.tsx`** — contenedor overlay. Se monta en `App` gated por `hubOpen` (useState en App), mismo patrón que Command Palette / GlobalSearch. Maneja: atajo, `Esc`, prioridad frente a otros overlays (si palette o búsqueda están abiertos, `Esc` cierra esos primero; el atajo del Hub no abre si hay un dialog modal), guardar/restaurar el pane enfocado previo (`terminal-registry`), paginación y fila de filtros.
2. **`HubGrid.tsx`** — grilla pura y reutilizable. Props: `entries: HubEntry[]` (`{ pane, tabId, tabName, tabColor, busy, ended }`), `focusedPaneId`, callbacks (`onFocus`, `onJump`, `onTogglePin`). Sin conocimiento del contenedor ni de App. Es la pieza que luego se monta en un tab Hub.
3. **`HubTile.tsx`** — mini-pane. Header reutilizando clases/estilos de pane existentes + chip de workspace + pin. Cuerpo: instancia xterm propia (readonly hasta tener foco) conectada por `paneId`:
   - mount → `window.pty.getBuffer(paneId)` (recortado a ~200 líneas) → `write()` → suscripción al stream global filtrando su `paneId`;
   - unmount → `term.dispose()`; **nunca** matar el PTY (mismo contrato que `TerminalPane`).

### Cambios en código existente

- `App.tsx`: estado `hubOpen`, montaje de `HubOverlay`, entrada en Command Palette, botón en tab bar, handler de "jump" (setActiveTabId + foco de pane). Derivar `HubEntry[]` con `useMemo` sobre `tabs`/`busyPanes`/`tabActivity`.
- `src/types.ts`: `pinned?: boolean` en `PaneNode` y `SessionPane` (persiste con el save/restore de sesión existente; migración trivial: ausente = false).
- `src/styles/global.css`: sección nueva `/* ── Hub Overlay ── */` reutilizando tokens (`--raven-blue`, `--pane-color`, etc.). Sin colores hardcodeados nuevos.

## Decisión técnica clave: tamaño del PTY

Un PTY tiene un único cols×rows; hay dos vistas posibles del mismo PTY (pane real + tile del Hub).

**Decisión:** solo el **tile enfocado** redimensiona el PTY a su tamaño (para poder interactuar con TUIs coherentemente). Los tiles sin foco renderizan el buffer sin resize — puede haber wrapping imperfecto, aceptable en una vista compacta. Al cerrar el overlay se re-ajustan (`fit()`) los panes montados del workspace activo, que es lo que ya pasa en un remount. Es el trade-off estándar de tmux con múltiples clientes.

Riesgo residual: un agente TUI en el workspace activo visible detrás del overlay se redibuja chico si su tile toma foco. Mitigación: si el pane pertenece al workspace activo, el foco en su tile **no** redimensiona (ya está montado a tamaño real; solo se enruta el input).

## Performance

- xterm solo para los tiles de la página visible (máx. 12); `dispose()` al paginar/filtrar/cerrar.
- Replay acotado a ~200 líneas por tile.
- Suscripción única al bus de datos en `HubOverlay`, fan-out interno a los tiles (no 12 listeners IPC).
- Overlay cerrado = costo cero (no se monta).

## Errores y bordes

- **PTY muerto**: tile con badge `ended` existente; para relanzar se salta al pane (el restart vive ahí).
- **Cierre de pane/workspace con el Hub abierto**: la grilla se deriva de `tabs` en cada render; el tile desaparece solo. Si era el enfocado, el foco pasa al siguiente.
- **Workspace activo dentro del Hub**: sus panes también aparecen (con su chip), para que la vista sea completa y predecible.
- **0 resultados tras filtrar**: estado vacío con hint del filtro activo.

## Testing (según CONTRIBUTING: ejercitar en la app real)

- `npm run build` limpio (TS strict).
- Manual (documentado en el PR): 3 workspaces con agentes → abrir Hub → tipear en terminal de otro workspace → verificar llegada; Enter salta al pane correcto; Esc devuelve foco; pin + filtro Pineadas; pane ended muestra badge; sesión con `pinned` sobrevive restart.
- E2E Playwright (si el harness del repo lo permite sin fricción): abrir overlay, escribir cross-workspace, verificar eco en buffer.
- Smoke en Windows (dev local) y pedir verificación Mac/Linux en el PR (requisito del equipo).

## Checklist para el PR (controles del equipo)

- [ ] PR enfocado: solo esta feature, sin "while I'm here".
- [ ] Screenshots/recording del overlay en el body del PR (requisito CONTRIBUTING para UI).
- [ ] El *why* en el body; el diff muestra el *what*.
- [ ] Sin dependencias nuevas.
- [ ] Tokens/estilos existentes, cero colores hardcodeados nuevos.
- [ ] Review visual en app real antes de pedir review.
- [ ] Nota de performance (xterms acotados, replay acotado) y de seguridad (sin IPC nuevo, sin superficie nueva).
- [ ] **No se mergea**: queda para review y merge de Gero.
