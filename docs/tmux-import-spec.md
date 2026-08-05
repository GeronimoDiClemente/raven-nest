# tmux → Nest import — spec / roadmap (2026-08-05)

Rama `worktree-tmux-import`. Diseño original: `tmux-import-research.md` (Desktop de Gero).
Este doc define el alcance real ("qué le ofrece tmux a la persona") y el camino para darlo.

## Principio
Traer el setup de tmux (keybindings + opciones) a Nest con **preview**, mapeando
**intención** (no tecla→tecla). **Nunca** se ejecuta nada del conf.

## Qué ofrece tmux vs qué puede representar Nest

Nest tiene un set **acotado** de acciones bindables → el import es lossy por diseño.

| Lo que el usuario tiene en tmux | Nest | Estado |
|---|---|---|
| Navegar panes (`select-pane -LRUD`, `last-pane`) | `prevPane`/`nextPane` | ✅ funciona |
| Navegar ventanas (`next/previous/last-window`) | `nextTab`/`prevTab` | ✅ funciona |
| Splits (`split-window -h/-v`) | `newPane` | ✅ funciona |
| Nueva ventana (`new-window`) | `newPane` | ✅ (impreciso: ventana≈tab, pero Nest no bindea "new tab") |
| Zoom (`resize-pane -Z`) | `toggleZoom` | ✅ funciona |
| `history-limit` | scrollback | ⚠️ se detecta, **no se aplica aún** |
| `mouse` | xterm ya lo cubre | ✅ informado |
| **Cerrar pane (`kill-pane`)** | — | ❌ **falta acción `closePane`** |
| **Cerrar ventana (`kill-window`)** | — | ❌ **falta acción `closeTab`** |
| Resize (`resize-pane -LRUD n`) | — | ❌ Nest no bindea resize |
| Rename (`rename-window`) | — | ❌ Nest no bindea rename |
| Prefix chords, `copy-mode`, plugins TPM, status bar, `if-shell`/`run-shell` | — | ❌ ajeno al modelo de Nest (informado con razón) |

## Hecho (commiteado, TDD)
- **Parser puro** `src/lib/tmux/parse.ts` — batches 1+2 + **flags `-n`/`-r`/`-T`** + fixture de conf real. 31 tests. Maneja aliases, comentarios, continuaciones `\`, quotes, `unbind`, y tira `run-shell`/`if-shell`/`source-file`/`@plugin` a "never executed".
- **IPC** `tmux:read-conf` (main, solo I/O) + `window.tmux.readConf()`. Parseo en el renderer (para conflictos vs bindings vivos).
- **Modal de preview** `TmuxImportModal.tsx` + botón "Import from tmux…" en Settings→Keybinds. Apply de keybindings vía `updateKeybinding`. 8 tests. CSS calcado de `.sp-*`.
- Suite 220/220, tsc-limpio. **Sin pushear.**

## Para dar más de "lo que ofrece tmux" (roadmap con hooks concretos)

### 1. Acciones `closePane` / `closeTab` — el gap más grande (DECISIÓN DE PRODUCTO)
`kill-pane`/`kill-window` están en casi todo `.tmux.conf`. Requiere **acciones nuevas
bindables en Nest** → cambia la app para TODOS los usuarios (no solo importadores) y
agrega shortcuts **destructivos** → **verificar en vivo antes de shippear**. Todo el
plumbing ya existe:
- `Keybindings` + `DEFAULT_SETTINGS` (`keybindings.ts`): agregar `closePane`, `closeTab` (elegir defaults, ej. `Meta+w` / `Meta+Shift+w`).
- Dispatch en `App.tsx` (~L895, fase captura): `if (matchesBinding(e, kb.closePane)) { e.preventDefault(); const id = focusedPaneIdRef.current; if (id) removePane(id); return }` y análogo `closeTab(activeTabId)`. Las funciones ya existen: `removePane` (App.tsx:381), `closeTab` (App.tsx:582).
- `SettingsPanel` keybindRows + `TmuxImportModal` `ACTION_LABELS`: agregar las dos.
- `parse.ts` `mapBindCommand`: `kill-pane`→`closePane`, `kill-window`→`closeTab`.
- **Decisión Gero:** ¿agregamos estos shortcuts globales + qué defaults? (afecta a todos, es destructivo → live-test.)

### 2. Apply real de `scrollback` (history-limit)
Hoy la opción se muestra, no se aplica. Plan (5 archivos):
- `AppSettings`/`DEFAULT_SETTINGS`: `scrollback: number` (5000).
- `useSettings`: preservar `scrollback` al cargar (hoy L11-14 sólo reconstruye voiceLanguage+keybindings) + `updateScrollback`.
- `useXterm`: 5º param `scrollback = 5000`, usarlo en L56 (**solo afecta terminales NUEVAS**; las abiertas mantienen el viejo hasta recrearse).
- `TerminalPane` (L81): pasar `settings.scrollback` a `useXterm`.
- Modal: fila de `history-limit` aplicable (clamp a rango sano, ej. 1000–100000).

### 3. v2 — sesiones/layouts
Desde `~/.tmux/resurrect/last` + `tmuxinator`/`tmuxp` YAML → Workspaces. `PaneLayoutEngine`
ya renderiza árboles `Split` arbitrarios (v2 barato: destrabar el tipado `LayoutId`).

## No-negociables
- Nunca ejecutar contenido del conf (enforced).
- Nada se aplica sin preview/confirm.
