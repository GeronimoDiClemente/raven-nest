# Tutorial de texto sobre la app real (pivote v3)

**Fecha:** 2026-06-01
**Branch:** `feat/tutorial-interactivo`
**Estado:** diseño aprobado, pendiente plan de implementación

## Motivación

Las iteraciones v2 (sandbox demo con componentes reales + interacción drag/sync)
quedaron demasiado complejas para el valor que aportan. El usuario quiere un
tutorial **explicativo de texto, paso a paso, no interactivo**, que le dé **foco
(spotlight) a los elementos clave de la app real**. El motor de coachmarks ya
existente (`OnboardingTour`) es esencialmente eso; lo que sobra es todo el
andamiaje de sandbox/demo construido para montar componentes aislados.

## Enfoque

Correr `OnboardingTour` **sobre la app real** (scope = `document`, sin `rootRef`),
en modo **solo-texto / solo-Siguiente** (sin `advanceOnClick` ni `advanceOnAction`,
para no disparar acciones reales sobre los repos del usuario). El tour asume que
el usuario está parado en la sección relevante (decisión: "app real tal como está").

### Se reutiliza (ya hecho)
- `src/tutorial/OnboardingTour.tsx` — motor spotlight + tooltip de texto, bilingüe,
  clamp de viewport, botones Atrás/Saltar/Siguiente. Se usa **sin** `rootRef`,
  `advanceSignal` ni `onStepChange`.
- `src/tutorial/i18n.ts`, `src/hooks/useTourSeen.ts`, `src/tutorial/registry.ts`,
  `src/tutorial/types.ts`.
- Los `data-tour-id` ya presentes en los componentes reales (`WorktreesSection`,
  `NewWorktreeModal`, `DiffViewerPanel`, `PortsBanner`).
- `src/lib/bridge.ts` **se mantiene**: `useBridge()` delega a `window` cuando no
  hay `BridgeProvider`, así que los 5 componentes migrados siguen funcionando en
  la app viva sin cambios. Revertir la migración sería churn innecesario.

### Se elimina (andamiaje sandbox/demo)
- `src/tutorial/TutorialSandbox.tsx`
- `src/tutorial/DemoWorkspaceMock.tsx`
- `src/tutorial/DemoProvider.tsx`
- `src/tutorial/demo/harness.ts`, `mocks.ts`, `fixtures.ts`, `worktree-fixtures.ts`
- Tests asociados: `tutorial-isolation.test.tsx`, `demo-workspace-mock.test.tsx`,
  `worktrees-tutorial.test.tsx`, `harness.test.ts`, `onboarding-tour-advance.test.tsx`
  (la parte de advance interactivo), y la parte de `bridge-context.test.tsx` /
  `bridge.test.ts` que valida override por subtree (el passthrough a window se
  conserva). El detalle fino de qué test se borra vs se recorta lo fija el plan.

> `capture/` (CaptureWorktrees, drive.mjs) son utilidades de screenshots fuera del
> producto; no bloquean el borrado pero pueden quedar rotas — el plan decide si se
> tocan o se dejan.

## Contenido del tour (worktrees)

Solo pasos cuyo `data-tour-id` esté presente en la **vista de lista de worktrees
con un repo abierto**. Todos avanzan **solo con Siguiente**.

- Se mantienen: `header`, `add` (+New), `list`, `diff-chip`, `pr`, `menu`
  (centrado, el body indica "click derecho"), y opcionalmente `env`/`ports-banner`
  si está visible.
- Se quitan o se pliegan en pasos vecinos: los pasos internos del modal
  (`branch`, `presets`, `create`) y los interactivos (`drag-terminal`, `sync-cwd`,
  `diff-panel`) — requieren abrir UI o ejecutar acciones que en modo no-interactivo
  no ocurren. La lista final de pasos la fija el plan.
- Se elimina `advanceOnClick`/`advanceOnAction` de todos los pasos.

## Puntos de entrada

- **Botón "?"** en el header de la sección Worktrees (`wt-header`), visible solo
  cuando hay un repo abierto. Abre el tour de esa sección.
- **Settings → Tutorial** (ya existe: `onOpenTutorial` → `setTutorialTour`).
- **Sin auto-launch a ciegas**: se elimina el effect de `App.tsx:352-357`
  (`sidebarExpanded && activeTab.repoPath && !seen`), porque si el usuario no está
  en la vista de worktrees el spotlight no tendría a qué apuntar.

## Cambios de cableado

- `App.tsx`: reemplazar `<TutorialSandbox tourId=… onClose=… />` (línea ~1259) por
  `<OnboardingTour steps={getTour(tutorialTour)!.steps} onClose=… />`
  document-scoped; quitar el import de `TutorialSandbox`; quitar el effect de
  auto-launch; mantener `onOpenTutorial`/`setTutorialTour` y `useTourSeen` (para
  marcar visto desde Settings, opcional).
- Sección Worktrees: agregar el botón "?" en el header y threadear un callback
  hasta `App` para abrir el tour (`setTutorialTour('worktrees')`).

## Testing

- Test de que `OnboardingTour` sobre `document` spotlightea anchors reales y avanza
  con Siguiente sin disparar clicks/acciones.
- Test de que el tour de worktrees recortado tiene solo pasos Next-only (sin
  `advanceOnClick`/`advanceOnAction`).
- Verificación manual en Electron: abrir un repo, ir a Worktrees, tocar "?",
  recorrer todos los pasos, confirmar que no se ejecuta ninguna acción real.

## No-objetivos

- No tocar el comportamiento de la app viva fuera de las entradas del tutorial.
- No reintroducir interacción (drag/sync) ni datos demo.
- No replicar todavía a My Repos / Teams (follow-up).

## Riesgos

- Pasos cuyo anchor no esté en pantalla caen al tooltip centrado (fallback del
  engine). Aceptable, pero el recorte de pasos debe minimizar esos casos.
- Borrar tests del sandbox baja el conteo total; asegurarse de que la suite quede
  verde y `tsc` limpio tras el borrado.
