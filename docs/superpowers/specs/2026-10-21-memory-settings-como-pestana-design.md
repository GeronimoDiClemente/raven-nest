# Memory settings como pestaña — diseño

Fecha: 2026-10-21 · Rama: `feat/memories-settings` (local) · Subproyecto 2a de los acordados el
20-10 (1 vista Obsidian ✅ → **2 Memory settings** → 3 idioma de Nest → 4 tema claro).
El 2 se partió en dos: **2a** (este spec: forma, contenido, copy y opciones de la vista
nueva) y **2b** (equipo y cuenta: plan/upgrade, cómo funciona compartir, vincular máquinas —
cambia comportamiento y servidor, va con su propio spec).

## 1. Problema

Memory settings (spec del 19-10, §3) es una vista que reemplaza todo el overlay, con un rail
numerado de 4 secciones y 9 tarjetas. Gero la probó y dice: **hay demasiadas cosas** y **no se
entiende qué hace cada una**. El inventario del 21-10 lo confirma:

- Conectar una máquina aparece de tres formas (Connect, «Add a machine that has no browser» y
  un campo de token suelto) sin decir cuándo usar cuál.
- La explicación del cifrado se repite tres veces (tarjeta de Cloud, bajada de la sección y
  tarjeta de cifrado). La tarjeta de cifrado sin nube dice «Connect cloud memory» sin botón.
- El campo del servidor propio («Where your memory syncs to») lo ve todo el mundo.
- «Share this project's memory with a team» le muestra a casi todos un callejón sin salida
  («Get in touch» sin contacto).
- «Branch notes» está bajo *team* y no necesita equipo.
- Tres «How it works» distintos; el de bienvenida dice «5 steps» y el tour tiene 6.
- Los filtros del grafo no se recuerdan: vuelven a cero al reabrir Memories.
- Cloud y el vault siguen con `sp-card` y estilos inline; el resto, con shadcn.

Además la vista no habla el idioma de la pantalla nueva (explorer + pestañas + panel, spec del
20-10).

## 2. Decisiones de Gero (21-10)

1. Estructura: Sync · Encryption · Editor & graph (nueva) · This project · Notes on disk ·
   Advanced. Sin números.
2. Contenedor: **opción B — Settings es una pestaña del workspace** (se descartaron el modal
   estilo Obsidian y la página completa de hoy).
3. Editor & graph lleva: modo de vista del editor, tamaño de letra, recordar filtros del
   grafo, etiquetas y animación del grafo.
4. Todo el copy reescrito en inglés: qué es y para qué sirve, sin repetir.
5. Plan/upgrade y el flujo de compartir quedan para 2b.

## 3. La pestaña

- `MemoryTab` suma `{ kind: 'settings'; section: SeccionDeSettings }` (`src/lib/memory-tabs.ts`).
  `tabId` = `'settings'` (hay una sola). **No es fija**: se cierra con ×, clic medio o
  Ctrl/Cmd+W como cualquier pestaña. Título de la pestaña: «Settings».
- Acción nueva del reducer `openSettings(section?)`: si la pestaña existe la activa (y cambia
  de sección si se pasa una); si no, la agrega al final y la activa.
- El engranaje del header (`aria-label="Memory settings"`, `data-tour-id="memories-settings"`)
  llama a `openSettings()`. Account → «Memory settings» en los Settings globales abre Memories
  con la pestaña Settings activa (reemplaza `vistaInicial: 'settings'`).
- **Sale** el modo `vista: 'memorias' | 'settings'` de `MemoriesWorkspace`, el Back de settings,
  `onVistaChange` y `MemorySettingsView.tsx` como contenedor. El arreglo de Task 10 («la pestaña
  Team thread se entera del toggle hecho en Settings») se conserva: el toggle ahora vive en una
  pestaña del mismo workspace, así que el estado del hilo se comparte en memoria en vez de
  releerse al volver.
- **Explorer**: con la pestaña Settings activa, el panel izquierdo muestra la lista de
  secciones (mismo ancho, mismo estilo de fila que las carpetas, ítem activo con `bg-accent`).
  Al activar otra pestaña vuelven las carpetas, con su estado (abiertas/cerradas, búsqueda)
  intacto.
- **Panel derecho**: se colapsa mientras Settings está activa y vuelve al estado previo al
  salir, sin persistir ese colapso — igual que el Ruling 11 para Team thread.
- Las notas abiertas siguen montadas detrás (como hoy con la vista de settings): cambiar a
  Settings no cierra ni pierde ediciones.

## 4. Las filas

Cada sección es: título, una bajada opcional de una línea, y una lista de **filas**. Una fila
(`SettingRow`, componente nuevo en `src/components/memories/settings/`) tiene a la izquierda el
nombre (`font-medium`) y una línea de qué es / para qué sirve (`text-muted-foreground`, máx. 2
líneas), y a la derecha el control. Separador `border-border` entre filas. Detalle extra
(estado, barra, listas de máquinas) va debajo de la fila, a todo el ancho.

Las tarjetas actuales se reescriben en este formato con shadcn + utilidades. **No cambia lo que
hacen**: mismos IPC, mismas máquinas de estado del cifrado, mismo compartir. Cambia dónde
están, cuándo aparecen y qué dicen. Ningún `sp-card` ni estilo inline en lo nuevo.

## 5. Contenido y copy

### Sync — «Your memory on every machine you sign in to.»
- **Cloud sync** — «Keeps a copy in the cloud so what your agents learn here is there on your
  other machines.» Control según estado (hoy en `CloudMemoryCard`): Connect / Turn off / Retry
  / Upgrade / Unavailable. Debajo, la línea de estado: «Up to date · N memories», «Uploading N
  changes…» (punto ámbar con `--warn`), «Offline — N changes waiting», «Another Nest is syncing
  this memory — N changes queued», «Couldn't sync — …», «Your plan doesn't include cloud sync».
  Diálogo de Turn off igual que hoy (con «Also delete my cloud memory»).
- **Cloud space** — «X of Y» con barra a escala real. Sólo conectado y con cuota del servidor.
- **Machine without a browser** — «A server, VM or SSH box. Run `<comando login>` there and
  approve the code it shows.» Control: input del código + «Approve». Sólo conectado.
  Mensajes de validación y éxito de `LinkDeviceCard` tal cual.
- El aviso «No repositories linked yet…» se mantiene, acortado: «Link your repos before
  connecting — memory imported without them goes to Global and stays there.»
- «Learn more» (MemoryHub) sale de esta pestaña: MemoryHub sigue apareciendo una vez en el
  primer arranque y con «How it works».

### Encryption — «The server stores your memory without being able to read it.»
- **Encrypt your memory** — «Only your machines hold the key. On this machine it stays
  readable, so search and agents work as usual.» Control: «Turn on» o el estado «On · key #N».
  La frase de qué viaja en claro (tipo, scope, rama) aparece **una vez**, debajo de la fila
  cuando está activo. El aviso del código de recuperación va en el paso «Save this code».
  Sin nube: la fila dice «Needs cloud sync» y el control es «Set up sync», que cambia la
  sección a Sync.
- **Authorise / recover** — filas que sólo aparecen cuando aplican: máquinas esperando (con
  huella y «They match — authorise»), esta máquina sin clave (huella, «I've been authorised»,
  «Use the recovery code»), re-subida pendiente. Mismo flujo que hoy.
- **Encrypt what `<team>` shares** — sólo con equipo activo. «Only the team leader can turn it
  on.» Mismas variantes que `TeamEncryptionCard`.

### Editor & graph (nueva)
Editor:
- **Live preview** — «Hide Markdown syntax except on the line you're editing.» Switch,
  default on. Off = el editor muestra el Markdown crudo (sin las decoraciones que ocultan o
  estilan la sintaxis). El autocompletado de `[[` se mantiene; navegar un link queda en el
  panel derecho («Links to») y, si la extensión de clic se puede separar del live preview,
  también con clic en el texto del link.
- **Readable line width** — «Cap note width so long lines are easy to read.» Switch, default
  on (`max-width` ~ 72ch centrado).
- **Spellcheck** — «Underline misspelled words while you write.» Switch, default off
  (`spellcheck` en el contenido de CodeMirror).
- **Font size** — «Size of the note text.» Select 12–18 px, default el actual.

Graph:
- **Remember graph filters** — «Keep orphans, guessed links, colours and forces as you left
  them.» Switch, default on. On: lo que el panel de filtros cambia se guarda y se restaura.
- **Labels** — «When node names show on the graph.» Select: «Always» · «When zoomed in»
  (default, el umbral relativo de V3) · «On hover».
- **Animate graph** — «Turn off on slow machines: nodes appear already in place.» Switch,
  default on. Off = la simulación corre sin dibujar (warmup) y se muestra quieta.
- **Reset graph to defaults** — botón; vuelve filtros y fuerzas a los defaults.

### This project — «Settings for `<repo>`.»
- **Branch notes** — «Writes a short note per branch into `.nest/team/`. It travels with git,
  so it's readable without Nest, and adds a branch map under the graph.» Switch (hoy
  `TeamThreadToggle`).
- **Share with a team** — sólo si `puedeCompartirMemoria === true`. Copy actual de las dos
  cajas, abreviado. Si es `false`: una fila sin control, «Sharing with a team needs a Teams
  plan.» + botón link «See plans» que abre el `UpgradeModal` existente (sin tocarlo: es 2b).
  Mientras es `undefined`: no se muestra.
- Sin repo: «Open a repo in this tab to see its settings.» + «Link a repo».

### Notes on disk
- **Mirror to Markdown** — «One file per memory in a folder you can open in Obsidian or grep.»
  Control Enable/Disable. Activo: ruta, «Open folder», «Regenerate now», resultado de la última
  pasada, y dos switches «Include old versions» / «Include teammates' memories».

### Advanced — «Only if your company runs its own Nest server.»
- **Sync server** — URL + «Change» (hoy `SyncServiceCard`, sin el badge *Advanced*).
- **Sync token** — «Connect with a token instead of signing in.» El campo que hoy está en
  Cloud; conectar con token llama a `connectWithToken` como hoy.

### Sale
Los textos de cifrado repetidos, la tarjeta de compartir sin salida, el campo de token en
Sync, el badge *Advanced*, la numeración y las bajadas largas del rail.

## 6. Preferencias

- `AppSettings` (`src/lib/keybindings.ts`) suma `memoryPrefs: MemoryPrefs` con defaults en
  `DEFAULT_SETTINGS`. Se guarda con `window.settings` como `voiceLanguage`: por máquina,
  sobrevive al reinicio.
- **Ojo**: `useSettings` arma el estado campo por campo al cargar; tiene que leer `memoryPrefs`
  (con merge contra los defaults, para campos nuevos) o el próximo `set` lo pisa.
- `MemoryPrefs = { editor: { livePreview, readableWidth, spellcheck, fontSize }, graph: {
  remember, labels, animate, filtros?: FiltrosGuardados } }`.
- Hook `useMemoryPrefs()` (en `src/hooks/`) lee/escribe. Los componentes de
  `src/components/memories/` reciben las preferencias **por props** y no importan el hook
  (requisito del plugin: nada ahí depende de Electron).
- `useGraphFilters` acepta un estado inicial y un `onChange`; con `remember` on, el workspace
  le pasa lo guardado y guarda cada cambio (debounce ~300 ms).

## 7. Tours y «How it works»

- Queda un solo «How it works»: el del header (MemoriesWelcome → tour `memories`).
- Sale el tour `memory-settings` (`tutorial/tours/memory-settings.ts`, su registro y el evento
  `nest:memory-settings-seccion`).
- El último paso del tour `memories` apunta al engranaje y dice qué hay en Settings.
- `MemoriesWelcome` dice la cantidad real de pasos (sale el «5 steps» fijo).

## 8. Tests

- Unit: reducer de pestañas (`openSettings` crea/activa/cambia sección; se cierra como una
  común); explorer muestra secciones con Settings activa y conserva carpetas al volver; panel
  derecho se colapsa y vuelve; cada sección muestra/oculta filas según estado (sin nube, sin
  equipo, sin repo, `puedeCompartir` false/undefined/true, conectado o no); «Set up sync»
  cambia de sección; prefs: carga con defaults, merge de campos nuevos, `useSettings` no pisa
  `memoryPrefs`; editor respeta livePreview/readableWidth/spellcheck/fontSize; grafo respeta
  labels/animate; filtros recordados se restauran y Reset vuelve a defaults.
- Los tests de las tarjetas existentes se adaptan (mismo comportamiento, copy nuevo).
- `la-app-es-en-ingles` y `e2e/04-contraste.spec.ts` pasan. El e2e de Memories que abre
  Settings se actualiza a la pestaña.
- Typecheck: los dos `tsc` de CI.

## 9. Fuera de alcance (2b y después)

- Plan/upgrade (`UpgradeModal`, la contradicción del plan Free, el error de checkout que sólo
  va a consola), cómo funciona compartir, `CONTACTO` vacío, `MemoryAdoptionDialog`.
- Recordar pestañas abiertas entre reinicios.
- Idioma de Nest y tema claro (subproyectos 3 y 4).
