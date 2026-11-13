# Pedido para Codex — propuestas de diseño con Superdesign

## Contexto

Nest (este repo) es un emulador/multiplexor de terminales para agentes de código: muchos panes con
Claude Code, Codex, Gemini, etc., cada uno en su worktree. Con 4 a 12 panes abiertos el problema es
saber **cuál te necesita, cuál terminó y qué está haciendo cada uno**.

Claude ya armó una ronda de propuestas (no las copies; hacé las tuyas con tu enfoque):

- **Bandeja de atención**: «2 need you · 3 unread», con ⌘J para saltar al siguiente. El estado ya se
  calcula en `src/lib/pane-state.ts` (`waiting`, `unread`, `working`, `idle`), pero hoy sólo se muestra
  `waiting` (ver `ESTADOS_VISIBLES`).
- **Identidad del pane**: número · tarea · rama · agente, en vez de sólo el logo del agente.
  Header actual: `src/components/PaneHeader.tsx`.
- **Sidebar**: hoy `src/components/Sidebar.tsx`. Ideas exploradas: agrupado por estado, árbol
  repo › worktree › pane, rail colapsado, por agente, feed de actividad.

## Lo que te pido

1. Confirmá que estás en la rama `feat/memories-settings` (`git branch --show-current`). **No cambies
   de rama**: este working tree lo comparte otra sesión que está trabajando.
2. Usá el CLI de **Superdesign** (instalalo si no está) para generar **varias direcciones distintas**
   de: (a) la bandeja de atención, (b) el header/identidad del pane, (c) el sidebar. Al menos 3 por
   cada una, bien diferentes entre sí.
3. **Con la visual real de Nest**, no una genérica:
   - tokens de `src/styles/global.css` (`--background #0a0a0a`, `--card #141414`, `--popover #1f1f1f`,
     `--muted-foreground #9b9b9b`, `--ok`, `--warn`, `--destructive`, bordes `rgb(255 255 255 / 0.08)`);
   - fuente Geist para la UI y Geist Mono para datos;
   - acento **acromático**: el color es estado, nunca marca (ver la sección UI de `CLAUDE.md`);
   - los logos de agentes reales (`src/components/AILogo*`), los estilos reales de `.pane-header`,
     del sidebar y de los panes en `global.css`;
   - textos de la UI en inglés.
4. Para cada dirección, una línea de por qué y su riesgo principal.

## Corrección de Gero: tiene que parecer Nest de verdad

Lo que hiciste hasta ahora no se parece a Nest real (aunque algunas ideas le gustan: **no las tires,
ajustalas**). Referencia visual: `design/codex/ref/nest-pane-real.png` (captura real de un pane).
La anatomía real, sacada de `src/styles/global.css` (`.pane-wrap`, `.pane-header`, `.pane-estado`,
`.sidebar`, `.sidebar-item`):

- **Fondo de terminal negro puro** (`#000`); el resto de la app `#0a0a0a`, sidebar `#141414`.
- **Pane**: borde de 1.5px con el color que eligió el usuario al 55%, radio 4px, y un resplandor
  `0 0 14px -4px` del mismo color al 38%. Sin color → borde blanco translúcido.
- **Header del pane**: 32px de alto, fondo `color-mix(color del pane 10%, #141414)`, línea inferior
  del color al 27%, padding `0 12px 0 10px`. A la izquierda: punto de color de 10px, logo del agente
  de 14px (`src/components/AILogos.tsx`) y su nombre en MAYÚSCULAS 11px/600 con letter-spacing .8px,
  el chip «3 ports ▾» y «+ note» en gris. A la derecha: íconos de 20px en gris (`#6e6e6e`): capas
  con número, copiar, descargar, compartir, maximizar y cerrar.
- **Estados** (`.pane-estado`): 10px/600, mayúsculas, letter-spacing .06em, padding 2px 6px, radio 3px.
  `NEEDS YOU` = texto `--warn #e3b341` sobre `--warn` al 14%. `UNREAD` = texto `--ok #4ade80` sobre
  `--ok` al 12%. `WORKING` = texto gris sin fondo.
- **Pestañas de repo arriba**: nombre + punto de color, subrayado de 3px del color del repo; a la
  derecha un chip con la memoria del sistema («6.32 GB»).
- **Sidebar**: 44px colapsado / 200px expandido, filas de 32px, radio 8px, texto `#9b9b9b`,
  hover `rgb(255 255 255 / .06)`.
- Tipografía Geist / Geist Mono; acento acromático; color sólo para estado o identidad del pane.

Una versión de referencia hecha sobre esta anatomía: la maqueta de Claude
(https://claude.ai/artifact/HomjMgZkNcAHQVwJ7TcNcq, tablero «A · Workspace»). No la copies: usala para
calibrar cómo se ve Nest, y hacé tus propias direcciones encima.

## Ampliación (pedido de Gero, 29-10 tarde)

No te quedes en «needs attention». Buscá **qué más le falta a Nest** como espacio de trabajo para
agentes, y sobre todo **cómo sacarle provecho a Memories, que es nuestro diferencial**: hoy vive
en una pantalla aparte (`src/components/MemoriesWorkspace.tsx`) y casi no se ve mientras trabajás.
Ideas que podés explorar o descartar (pensá las tuyas):

- qué memoria usó o guardó el agente de cada pane, visible en el pane;
- consultar o adjuntar una memoria sin salir de las terminales (panel lateral, ⌘K);
- cuando un agente pregunta algo que ya se decidió, mostrar la decisión guardada al lado;
- el hilo de equipo por rama: lo que otro agente o compañero aprendió en esa rama;
- el estado de memoria y sync en la UI general (hoy sólo en Settings);
- onboarding: el primer momento en que alguien ve que la memoria le sirvió.

Para cada idea: el problema concreto que resuelve, una pantalla y por qué nadie más (Warp, Cursor,
Ghostty, iTerm2) lo puede copiar fácil.

## Ronda 3: que den ganas de usar Nest (pedido de Gero)

La base visual de Nest está bien y se queda. Ahora Gero quiere **detalles que la hagan más linda y
que den ganas de usarla por sobre Warp, Ghostty, iTerm2 o la terminal de Cursor**: animaciones,
transiciones, cambios de estado que se sientan, micro-momentos. Con criterio, no fuegos artificiales:

- que cada animación **comunique algo** (un agente trabajando, uno que terminó, uno que te pide algo,
  una memoria que se usó, un pane que entra o sale del layout);
- **baratas**: sólo `transform` y `opacity`, nada que repinte la terminal, y que se pausen con la
  ventana oculta (Nest ya hizo un trabajo grande de batería, ver `src/lib/intervalo-visible.ts`);
- respetar `prefers-reduced-motion`;
- sobre la anatomía real de la sección «Corrección de Gero».

Entregá 4 a 6 ideas animadas de verdad (HTML con CSS/JS que se vea moviéndose), cada una con qué
comunica y cuánto cuesta. Dejalas en `design/codex/delight/` con su propio `index.html`.

## Superdesign y la sesión

El CLI es `@superdesign/cli` (`npm install -g @superdesign/cli@latest`). Generar borradores necesita
sesión iniciada. Si `superdesign auth status --json` no está autenticado, corré
`superdesign login --no-browser --json`, anotá la URL y el código en `design/codex/README.md` para que
Gero lo autorice mañana, y **no te frenes**: armá igual las direcciones como HTML estático en
`design/codex/` (una página por dirección y un `index.html` que las enlace), usando las herramientas de
inspiración que sí funcionen sin sesión (`search-prompts`, `get-prompts`).

## Reglas

- **Escribí sólo dentro de `design/codex/`.** No toques `src/`, `electron/` ni nada más del repo.
- Sin commits, sin push, sin instalar dependencias en el `package.json` del repo (si Superdesign
  necesita algo, que sea global o con `npx`).
- No mates procesos ni cierres Nest.
- Al terminar, dejá `design/codex/README.md` con la lista de direcciones, dónde ver cada una y tu
  recomendación.
