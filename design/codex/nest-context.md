Raven Nest UI context (source-grounded)

Product: desktop terminal multiplexer for coding agents; 4–12 panes make it important to find which agent needs attention, finished, or is working.

Exact visual tokens from src/styles/global.css:
--background #0a0a0a; --card #141414; --popover #1f1f1f; --foreground #f2f2f2; --muted-foreground #9b9b9b; --ok #4ade80; --warn #e3b341; --destructive #ff6568; --border rgb(255 255 255 / 0.08). Geist Variable UI and Geist Mono Variable for data. Acromatic accent: color communicates state, not brand. English UI.

Pane state from src/lib/pane-state.ts: waiting = needs you; unread = unread; working = working; idle has no visible label. Current ESTADOS_VISIBLES only exposes waiting. Design concept may surface unread and waiting in a global attention summary but must preserve different urgency: waiting is urgent, unread is quiet, working stays neutral.

Pane header source: src/components/PaneHeader.tsx and global.css. Real header includes pane color marker (user identity), actual agent logo and name, activity label, optional state badge, terminal actions. Header height is compact (var(--header-height)); base padding 10px left / 12px right, 8px gap. Pane color is identity, separate from semantic state. Header currently uses a very subtle 10% pane-color tint and a border mixed at 27%.

Sidebar source: src/components/Sidebar.tsx and global.css. Expanded sidebar 200px, collapsed rail 44px. Existing sections cover repo/worktrees, hub, explorer, tools, more tools, settings; collapse/expand and active selection exist. Rows are 32px tall and 10px horizontal padding. Preserve a compact desktop shell.

Agent logos: exact vectors are implemented in src/components/AILogos.tsx and selected through AI_LOGOS / AILogo. Use real Claude, Codex and Gemini marks in examples. The logos are third-party identity marks; their original colors are preserved.

Reference inspiration returned by Superdesign search-prompts: ascii-hero (developer dashboard, deep dark canvas, clear monospace data layer, status chips). Adapt its information density and hierarchy; do not import its blue accent, black-only surfaces, or landing-page layout.

## Corrección y ampliación — entrega 30/10

El brief posterior invalida la exploración de headers de 48px: todos son 32px. Ver assets/workspace.css y render.cjs para la geometría vigente. Terminal #000, sidebar #141414 200px o rail44, pane radio4 borde1.5 y colores de identidad del usuario. H2 desplaza contexto a una tira separada de42px. No usar prepare.cjs/bake.cjs como pipeline vigente.

Memories ya tiene tools de búsqueda/lectura/escritura, contexto en índice, registros superseded, sesiones por pane, estado sync/vault, hilo de equipo por rama y onboarding. La ampliación integra estas bases con el workspace. PRODUCT-NOTES.md distingue funciones existentes, nuevas superficies y telemetría pendiente; las pantallas M1–M6/W1–W2 son ejemplos, no eventos reales. «Retrieved» no equivale a «applied» y un bridge conectado no demuestra escritura.
