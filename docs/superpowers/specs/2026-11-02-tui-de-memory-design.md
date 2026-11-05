# La TUI de Nest Memory — diseño

**Fecha:** 2026-11-02 · **Rama:** `feat/memories-settings` · **Estado:** aprobado por Gero (2026-11-02) ·
**Fase 1** del lanzamiento de Nest Memories

## Objetivo

Que `nestmux-memory` sin argumentos abra una interfaz de terminal para **ver, buscar, crear,
editar y borrar** memorias, en cualquier terminal (Cursor, VS Code, una terminal suelta) y
también en un pane de Nest. Es la cara del plugin para quien vive en la terminal, al estilo de
la TUI de Engram.

Reemplaza la §4.3 del spec `2026-09-09-nest-memories-plugin-y-cifrado.md` en dos puntos: suma
escritura (allá era sólo lectura) y, por eso, deja de ser "ANSI a mano sin dependencias".

## Problema

Hoy el paquete tiene `status`, `search` y `doctor` como comandos de una pasada: imprimen y
terminan. No hay forma de recorrer la memoria, leer una entera, seguir sus wikilinks ni
corregirla sin abrir Nest. Correr `nestmux-memory` sin argumentos muestra la ayuda.

## Decisiones (Gero, 2026-11-02)

1. **Las dos caras:** la TUI es del plugin, y Nest tiene un acceso que la abre en un pane.
2. **Editor completo:** ver, buscar, crear, editar y borrar.
3. **Ink + `$EDITOR`:** Ink (React para terminal) para navegar; para escribir texto, el editor
   del usuario, como `git commit`.

## Diseño

### 1. Pantallas

Arriba un encabezado y pestañas (`1`–`4` o `Tab`); abajo una barra fija con las teclas de la
pantalla actual.

```
 Nest Memory · raven-nest            ● synced · 1,284 items · Cloud
 [1 Recent]  2 Search   3 Status   4 Doctor
 ─────────────────────────────────────────────────────────────────
 ▸ decision  Encryption is mandatory on connect          2h ago
   bugfix    Stale guard orders like resolveLWW           3h ago
   pattern   Link codes survive OAuth via link_code       1d ago
 ─────────────────────────────────────────────────────────────────
 ↑↓ move  ⏎ open  n new  e edit  d delete  / search  q quit
```

- **Recent** (la de entrada): las memorias del proyecto donde se abrió la TUI, en el mismo
  orden que `memory_context`. `g` alterna "this project" / "all projects".
- **Search:** FTS5 local en vivo (debounce de 150 ms). Misma lista que Recent.
- **Status:** items, estado del sync, plan, cifrado (incluido "Encrypting… N left" y
  `needs_encryption_setup`), conflictos, sesión activa, y la línea de upgrade del paquete cuando
  hay un límite (`lineaDeUpgrade`).
- **Doctor:** lo bloqueado con su razón, mismo contenido que `nestmux-memory doctor`.
- **Detalle** (`⏎` sobre una fila): título, tipo, tags, proyecto, fecha relativa y contenido
  con scroll. Los `[[wikilinks]]` se resaltan; `Tab`/`Shift+Tab` los recorre y `⏎` abre la
  memoria enlazada, con la misma resolución estilo Obsidian que Nest
  (`2026-10-20-memories-estilo-obsidian-design.md`). Un link sin destino se muestra apagado y
  no abre nada. `Esc` vuelve (pila de navegación: volver desde un link regresa a la memoria
  anterior, no a la lista).

**Teclas globales:** flechas y `j`/`k`, `/` salta a Search, `q` y `Ctrl+C` salen restaurando la
terminal (cursor, modo crudo, pantalla alternativa). `?` muestra todas las teclas.

**Tamaño:** se adapta al ancho; por debajo de 60 columnas oculta la columna de fecha y por
debajo de 40 muestra "Window too narrow". Re-dibuja en `SIGWINCH`.

**Sin color** (`NO_COLOR` o salida que no es TTY): `nestmux-memory` sin argumentos y sin TTY
imprime la ayuda como hoy, en lugar de abrir la TUI.

### 2. Escribir: `$EDITOR`

- `n` (nueva) y `e` (editar) escriben un archivo temporal `memory-<id>.md` (permisos 0600, en
  `os.tmpdir()`), con frontmatter y cuerpo:
  ```markdown
  ---
  title: Encryption is mandatory on connect
  type: decision
  tags: [encryption, sync]
  ---
  Body in Markdown. [[Wikilinks]] work as in Nest.
  ```
  Una nueva arranca con `type: decision`, el proyecto actual y un comentario de ayuda en el
  cuerpo que se descarta si queda igual.
- La TUI suelta la terminal (sale de la pantalla alternativa y del modo crudo), lanza el editor
  y espera a que termine; después la retoma.
- **Qué editor:** `$VISUAL`, después `$EDITOR`; si no hay, `notepad` en Windows y `nano` en Mac
  y Linux (si `nano` no existe, `vi`). Se lanza sin shell, partiendo la variable en argumentos
  (para `code --wait`).
- **Al volver:** si el archivo no cambió, no pasa nada. Si cambió, se parsea: `title` no vacío,
  `type` dentro de los tipos de memoria conocidos, `tags` lista. Con error, la TUI muestra
  cuál y ofrece **Reopen** (vuelve al editor con lo escrito) o **Discard**. Con éxito escribe
  por el cliente (§3): `memory.save` para una nueva, `memory.update` para una existente.
- El archivo temporal se borra siempre al terminar (también ante error o `Ctrl+C`).
- `d` (borrar) pide confirmación `Delete "<title>"? y/N` y llama al borrado del cliente.
- El editor externo es donde vive el texto en claro **en disco** fuera de la base: igual que
  la base local (que ya está en claro, CLAUDE.md), la máquina del usuario está fuera del modelo
  de amenaza; aun así el archivo es 0600 y se borra.

### 3. De dónde salen los datos

La TUI no tiene fuente de verdad propia: usa **el mismo cliente que el MCP del paquete**.

- Con Nest abierto, le habla a su daemon (escritor único) por el descubrimiento de
  `electron/memory-mcp/elegir-cliente.ts` (variables del pane primero, `pipe-auth.json` + ping
  después).
- Con Nest cerrado, el paquete escribe solo con el candado que ya tiene
  (`2026-09-13-nest-memory-portable-design.md` §5–6) y, después de cada escritura, corre el sync
  de una pasada (`sync-del-paquete.ts`) si hay credencial, igual que el MCP local.
- Las lecturas de Status y Doctor reusan las funciones que ya arman esas salidas
  (`estado-de-sync-del-paquete.ts`, el doctor del paquete), sin reimplementarlas.
- Si en medio de la sesión Nest se abre o se cierra, la próxima escritura vuelve a elegir
  cliente (el mismo reintento que el MCP).

### 4. Ink en el paquete

- El paquete compila a CommonJS y Ink 5 es sólo ESM. Se carga con `import()` dinámico **sólo**
  en el camino de la TUI; `mcp`, `login`, `status` y los hooks no cargan React.
- `engines.node` sigue en `>=22.5`. Este spec lo subía a `>=22.12` por el `require` de ESM, pero
  Ink se carga con un `import()` nativo, que no lo necesita; el 2026-11-05 se volvió a 22.5.
- Dependencias nuevas del paquete: `ink`, `react`. De desarrollo: `ink-testing-library`.
  Nada más (sin `ink-text-input`: el único input de una línea es el de Search y se escribe a
  mano con `useInput`).
- La TUI vive en `electron/tui-del-paquete/` (un archivo por pantalla, más el estado puro),
  compilada con el resto del paquete.

### 5. El acceso desde Nest

- Comando en la paleta **"Open Memory in terminal"** y un botón con el mismo texto en el
  encabezado de la vista Memories.
- Abre un pane nuevo en el proyecto actual que corre la TUI con el Electron de Nest en modo
  Node, así anda aunque el plugin no esté instalado por npm.
- **Corrección (Gero, 2026-11-05): el pane NO corre `cli-del-paquete.js`.** Tres razones:
  Electron 33 trae Node 20.18, que no tiene `node:sqlite` (el CLI lo carga al arrancar); Node 20
  no puede hacer `require` de un ESM con top-level await (Ink); y el CLI no viaja en la app
  (electron-builder empaqueta sólo `dist/` y `dist-electron/`). Lo que corre es un entry propio
  de electron-vite, **`dist-electron/memory-tui.js`** (`electron/tui-de-nest.ts`), que sólo le
  habla al daemon (`crearFuenteDelDaemon`) y nunca abre la base. Un test de grafo de imports
  (`paquete-sin-nativas.test.ts`) fija que desde ahí no se llega a `node:sqlite`,
  `better-sqlite3` ni `electron`. `ink` queda externo en el build y se carga con el `import()`
  real de `tui-del-paquete/ink.ts`.
- El pane se pide con el `cmd` centinela `NEST_MEMORY_TUI_CMD` (`'nest-memory-tui'`,
  `src/types.ts`). `PtyManager.create` lo reconoce y:
  - usa siempre el shell por defecto de la plataforma, aunque llegue otro (WSL no puede correr
    el `.exe` de Windows con su path);
  - inyecta sólo `NEST_MEMORY_SOCKET` y `NEST_MEMORY_TOKEN`; no redirige HOME, no registra el
    pane en `memoryPanes` ni provisiona nada (no es un pane de AI);
  - escribe el comando de `comando-de-la-tui.ts`, con `ELECTRON_RUN_AS_NODE` acotado a ese
    comando según la familia del shell (posix: `ELECTRON_RUN_AS_NODE=1 "<exec>" "<script>"`;
    PowerShell: se setea, `Start-Process -NoNewWindow -Wait` y se borra en un `finally`; cmd:
    `set` antes, `start "" /b /wait` y `set` vacío después). Las variantes de Windows esperan
    porque el `.exe` de Electron es de subsistema GUI y ni PowerShell interactivo ni cmd esperan
    a un programa GUI: el prompt volvería enseguida y el shell y la TUI se pelearían la entrada.
    **No están verificadas en una máquina Windows real.**
    El shell del pane queda sin la variable, así que un `code` lanzado después desde ahí no
    arranca en modo Node;
  - sin `tui` en la integración de memoria, devuelve `Memory is not available in this build`.
- Sin las variables (por ejemplo, alguien corre `memory-tui.js` a mano), el entry imprime
  "Open this from Nest — the pane didn't get Nest's memory variables." y sale con 1.
- Al salir de la TUI (`q`) el pane queda en el shell, como cualquier comando.

## Errores y bordes

- **Terminal que no soporta modo crudo** (algunas consolas viejas de Windows): se detecta al
  arrancar y se imprime "This terminal can't run the interactive view. Use `nestmux-memory
  search` or open Nest." con salida 1.
- **Base inexistente** (máquina nueva, sin Nest ni login): la TUI abre igual con Recent vacía y
  el mensaje "No memories yet. Agents save them through the MCP, or press `n`."
- **Escritura rechazada** (candado tomado por otro proceso, base de solo lectura): mensaje en la
  barra inferior con el motivo; la memoria editada se conserva en el temporal y se ofrece
  **Reopen** para no perder lo escrito.
- **Memoria de equipo cifrada sin clave en este device** (corregido 2026-11-05): una fila
  ilegible nunca llega a `observations` (`memory-store.ts`: "una fila ilegible no se aplica"),
  así que no hay título que listar ni detalle que abrir. Lo que la TUI muestra es el conteo, en
  Status (`contarIlegiblesDeEquipo`, con la base del paquete). En el pane de Nest, Status no lo
  trae: la fuente del daemon no expone ese conteo.
- **Memoria editada por otra máquina mientras estaba en el editor:** gana LWW como en todo el
  sistema; la TUI no intenta mezclar.

## Tests

- **Estado puro** (`tui-del-paquete/estado.ts`): navegación, pestañas, pila del detalle, recorrido
  de wikilinks, debounce de búsqueda, estados vacío/error — con vitest, sin Ink.
- **Pantallas** con `ink-testing-library` contra un cliente falso: lo que se dibuja en cada
  pestaña, ancho angosto, teclas.
- **Editor externo:** el ida y vuelta con un "editor" falso (un script node que reescribe el
  archivo): sin cambios → no escribe; cambios válidos → `save`/`update`; frontmatter inválido →
  Reopen conserva el texto; el temporal se borra en todos los casos, incluido el error del editor.
- **Carga diferida:** un test fija que `mcp`/`status` no cargan `ink` ni `react`.
- **Paquete:** `paquete-sin-nativas` y el build del paquete siguen en verde con las
  dependencias nuevas; `engines` dice `>=22.5`.
- **e2e** (headless, contra `dist/`): desde Nest, "Open Memory in terminal" abre un pane con la
  TUI; con un `EDITOR` falso se crea una memoria y aparece en Recent y en el store.

## Fuera de alcance

- El grafo en la terminal (es de Nest a propósito, spec del plugin §3).
- Un editor de texto propio dentro de la TUI.
- Promover a equipo y forzar sync desde la TUI (se puede sumar después con una tecla; no hace
  falta para lanzar).
- Configurar Claude Desktop en `setup` y el proyecto de una sesión sin carpeta: diseño corto
  aparte.
