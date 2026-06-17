# Tour `activation` — onboarding de primer arranque

**Fecha:** 2026-06-16
**Branch:** `feat/tutorial-interactivo`
**Estado:** diseño aprobado (brainstorming) — pendiente plan de implementación

## Objetivo

Cuarto y último tour del tutorial de Nest. A diferencia de los tres existentes
(`worktrees`, `my-repos`, `teams`), que explican una sección puntual y se lanzan
a demanda, `activation` es el **onboarding de primer arranque**: el "aha moment"
que orienta al usuario nuevo en cuanto abre la app por primera vez —
abrir su primera terminal, conectar repos, conocer el trabajo en equipo.

Reusa el motor narrado existente (`OnboardingTour`) sin modificarlo: spotlight
sobre la app real + tooltip con copy, avance Next-only. No navega, no abre
modales, no ejecuta acciones reales.

## Decisiones tomadas

1. **Lanzamiento:** auto-launch la primera vez + botón "?" de re-entrada.
   - Auto-launch cuando `isInitialState && !tourSeen('activation')`.
   - Botón "?" en el `EmptyState` + entrada en Settings → Tutorial.
   - Se reactiva el auto-launch (eliminado en el pivote v3) **solo para este
     tour**: el motivo de su eliminación ("sin vista no hay a qué apuntar") no
     aplica acá, porque en el primer arranque el `EmptyState` siempre está
     montado.

2. **Sin ramificación por plan:** los 5 pasos son estáticos para todos los
   planes, igual que los otros tres tours. El nuevo típico arranca con trial
   Team de 15 días (`computeEffectivePlan` devuelve `plan:'team'`), así que ve
   My Repos / Team sin chocar el paywall. Para el Free post-trial, esos pasos
   funcionan como funnel de upgrade — no molestan y no justifican la
   complejidad de construir los steps dinámicamente. `activation` queda como un
   `TourDef` estático; `getTour` no cambia.

3. **Expandir el sidebar al lanzar:** en el primer arranque `sidebarExpanded`
   es `false` (íconos de 16px sin label; `WorktreesSection` ni se monta). El
   orquestador de lanzamiento hace `setSidebarExpanded(true)` al iniciar
   `activation`, de modo que los ítems del sidebar muestren su label y sean
   buenos targets de spotlight. Es responsabilidad del **lanzador**, no del
   motor narrado, que sigue intacto. El sidebar queda expandido al cerrar el
   tour (el usuario lo colapsa si quiere).

## Pasos

Narrados, Next-only, copy bilingüe en las defs (el render fuerza `'en'` vía
`resolveTutorialLocale`, pero las defs siguen `{ en, es }` como los otros tours).

| # | id | anchor | placement |
|---|----|--------|-----------|
| 1 | `welcome` | `[data-tour-id="empty-new-terminal"]` | `bottom` |
| 2 | `new-terminal` | `[data-tour-id="empty-new-terminal"]` | `bottom` |
| 3 | `my-repos` | `[data-tour-id="sidebar-myrepos"]` | `right` |
| 4 | `team` | `[data-tour-id="sidebar-team"]` | `right` |
| 5 | `outro` | `[data-tour-id="empty-new-terminal"]` | `bottom` |

Copy:

1. **welcome**
   - en — *Welcome to Nest* / "Your multi-AI terminal workspace. You've got 15 days of Team to try everything — here's a 30-second tour."
   - es — *Bienvenido a Nest* / "Tu workspace de terminales multi-IA. Tenés 15 días de Team para probar todo — acá va un tour de 30 segundos."

2. **new-terminal**
   - en — *Open your first agent* / "Start a real terminal running Claude, Codex, Gemini or any CLI agent. This is where the work happens."
   - es — *Abrí tu primer agente* / "Arrancá una terminal real con Claude, Codex, Gemini o cualquier agente CLI. Acá pasa todo."

3. **my-repos**
   - en — *Your repos* / "Connect GitHub or GitLab and bring your repositories. Link a local folder to open a terminal in any of them."
   - es — *Tus repos* / "Conectá GitHub o GitLab y traé tus repositorios. Linkeá una carpeta local para abrir una terminal en cualquiera."

4. **team**
   - en — *Work as a team* / "Invite your teammates and collaborate in the same terminals in real time."
   - es — *Trabajen en equipo* / "Invitá a tu equipo y colaboren en las mismas terminales en tiempo real."

5. **outro**
   - en — *You're set* / "Reopen any tour anytime from the **?** buttons or Settings → Tutorial. Now open a terminal and dive in."
   - es — *Listo* / "Reabrí cualquier tour cuando quieras desde los botones **?** o Settings → Tutorial. Ahora abrí una terminal y a darle."

> Nota de copy: el paso `welcome` menciona "15 days of Team" — es válido para el
> caso típico (nuevo en trial). No se ramifica por plan; un usuario que ya pagó
> o cuyo trial venció lo lee como contexto, no como bug. Si más adelante molesta,
> es un cambio de copy aislado.

## Wiring

### Anchors faltantes (agregar `data-tour-id`)
- `empty-new-terminal` → botón "+ New Terminal" del `EmptyState` (`App.tsx`, ~1305).
- `sidebar-myrepos` → ítem My Repos del sidebar (`Sidebar.tsx`, ~578).
- `sidebar-team` → ítem Team del sidebar (`Sidebar.tsx`, ~536).

### Archivos nuevos / modificados
- **Nuevo** `src/tutorial/tours/activation.ts` — `activationTour: TourDef` con los 5 pasos.
- `src/tutorial/registry.ts` — registrar `activationTour` en el mapa `tours`.
- `App.tsx`:
  - Effect de auto-launch: si `isInitialState && !tourSeen('activation')`,
    setear `tutorialTour='activation'`, `setSidebarExpanded(true)`, y marcar
    visto con `useTourSeen`.
  - Pasar `onStartTutorial`/`onOpenTutorial('activation')` al `EmptyState` para
    el botón "?".
  - Al lanzar `activation` desde cualquier entrada (auto, "?", Settings),
    expandir el sidebar.
- `EmptyState` (`App.tsx`) — botón "?" que dispara el tour; `data-tour-id` en el
  botón principal.
- `Sidebar.tsx` — `data-tour-id` en los ítems Team y My Repos.

### Sin cambios
- `OnboardingTour` (motor), `i18n`, `tooltipPosition`, `bridge`. El tour es
  estático y narrado; no toca nada del runtime del motor.

## Persistencia y re-entrada

- `useTourSeen('activation')` — key `nest:tour-seen:activation` en `localStorage`.
- `markSeen()` se llama dentro del **effect del auto-launch** (apenas se muestra),
  no al cerrar el tour. Así Skip y Done dan igual: una vez que se mostró una vez,
  no vuelve a auto-lanzarse en el próximo arranque.
- Re-entrada siempre disponible vía "?" del `EmptyState` y Settings → Tutorial
  (no togglean el flag de visto).
- Forzar en dev: `localStorage.removeItem('nest:tour-seen:activation'); location.reload()`.

## Testing

- `section-tours.test.ts` (contrato existente): extender para que `activation`
  cumpla el mismo contrato que los otros — registrado en `registry`, todos los
  pasos con `title`/`body` bilingües, anchors presentes como string.
- Sin test e2e de Electron en este paso (igual que `my-repos`/`teams`, que se
  verificaron manualmente). Verificación manual: auto-launch en primer arranque,
  sidebar expandido, los 5 pasos anclan, copy en inglés, "?" reabre.

## Fuera de alcance (YAGNI)

- Ramificación de pasos por plan.
- Entrar a modales (Connect GitHub vive dentro de My Repos/Settings/Teams; el
  tour solo apunta al ítem del sidebar con copy que lo explica).
- Avance por acción (`advanceOnClick`/`advanceOnAction`): el tour es Next-only.
- Paso dedicado de Worktrees: ya tiene su propio tour; el `outro` remite a los
  botones "?".
- Tocar el motor `OnboardingTour`.

## Pendiente no relacionado

`capture/` (untracked) quedó obsoleto desde el pivote v3 (importa harness
borrado). Está fuera de `tsconfig.web` y vitest, no rompe build/tests. Decidir
borrarlo en una tarea aparte.
