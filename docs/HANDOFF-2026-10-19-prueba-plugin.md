# Handoff — Prueba local del plugin de memoria (19 de octubre de 2026)

Para seguir desde cualquier máquina. Rama: **`feat/nest-terminal-ui`**, todo commiteado y
pusheado. **Sin release y sin deploy**: el servidor de Railway no tiene nada de lo de
octubre. La idea es probar todo local primero.

```bash
git fetch origin && git checkout feat/nest-terminal-ui && git pull
npm install                                  # deja el binding de Electron
(cd packages/nest-memory && npm run build)   # el CLI del paquete corre desde su dist/
```

---

## Qué cambió hoy

**`memory_search` busca por términos sueltos, no por frase exacta.** Antes la query entera
iba entre comillas en el `MATCH` de FTS5: «Smoke paquete» no encontraba «Smoke del
paquete». Ahora cada término va entre comillas por separado, unidos por AND
(`consultaFtsPorTerminos` en `electron/memory-reads.ts`). Lo usan los tres caminos de
`searchObservations`: el MCP con daemon, el MCP de solo lectura y el `search` del CLI.
Tests nuevos en `electron/__tests__/memory-store.test.ts` (bloque `search & context`).

Se dejó afuera a propósito:
- `crossProjectMemories` (la búsqueda del overlay Memories en la app) **sigue con frase
  exacta**. Si se quiere el mismo criterio, es reusar `consultaFtsPorTerminos` ahí.
- `memory-vecinos.ts` busca backlinks por título y alias: **ahí la frase exacta es la
  correcta** y no se toca.
- Sin fallback a OR ni orden por relevancia: sigue `updated_at DESC`. Si un agente manda
  una oración entera («cómo resolvimos el bug del sync»), el AND puede dar vacío.

Verificado: 906/906 tests de memoria y los dos `tsc` de CI en 0. En la suite completa
fallan 5 tests de componentes (`AutomationsView*`, `IntegrationsMarketplace-connect`,
`MemoriesWorkspace`, `memories-en-vivo`). Corridos aislados pasan los 48, con y sin el
cambio, así que es carga del suite y no este cambio.

---

## El kit de prueba local

Lo que hay que probar: el plugin en los dos modos (**con Nest** = lee la base del Nest dev;
**suelto** = sin Nest, base propia, `login` aprobado desde el Nest dev) contra un servidor
de sync local.

### Trampa nueva: el path del socket

**macOS limita el path de un socket Unix a 104 caracteres.** Si `RAVEN_HOME` está en un
path largo (el scratchpad de Claude tiene ~140), el daemon de memoria del Nest dev no
escucha y en el log sale **`EADDRINUSE`**, que despista: no hay otro proceso ni un socket
viejo (`memory-ipc-server.ts` ya borra el socket viejo antes de escuchar). En la sesión del
16-oct el daemon del Nest dev nunca escuchó por esto. **Usar un `RAVEN_HOME` corto**, por
ejemplo `/tmp/nmk-home`.

### 1. Postgres + servidor de sync (puerto 8099)

Postgres 16 en `127.0.0.1:55432` (ver `server/README.md`, o en Mac `postgresql@16` nativo
con `pg_ctl ... -o "-p 55432" start`). Después, desde la raíz:

```bash
cd server && set -a && . ../.env && set +a && \
  SUPABASE_URL=$VITE_SUPABASE_URL SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
  DATABASE_URL=postgres://postgres:nestmem@127.0.0.1:55432/nest_memory \
  PORT=8099 npx tsx src/index.ts
```

Arriba si `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8099/v1/sync/status` da
`401`. La cuenta tiene que estar en la tabla `allowlist` de esa base.

### 2. Nest dev aislado

```bash
export KIT=/tmp/nmk            # path CORTO, ver la trampa del socket
mkdir -p $KIT/home $KIT/userdata $KIT/paquete-home
RAVEN_HOME=$KIT/home MAIN_VITE_SUPABASE_URL=http://127.0.0.1:8099 \
  npx electron-vite dev -- --user-data-dir=$KIT/userdata --remote-debugging-port=9223
```

No toca `~/.raven-nest` ni la Nest instalada. Si antes corriste `npm test`, primero
`npm run native:electron`. **No cerrar la Nest instalada** si hay sesiones de Claude
corriendo adentro.

### 3. Wrappers del plugin

`$KIT/nm-con-nest`:
```bash
#!/bin/bash
export RAVEN_HOME=/tmp/nmk/home NEST_MEMORY_SYNC_URL=http://127.0.0.1:8099
exec node <repo>/packages/nest-memory/dist/cli-del-paquete.js "$@"
```
`$KIT/nm-suelto`: igual, con `RAVEN_HOME=/tmp/nmk/paquete-home`.

Para Claude Code, un `mcp-con-nest.json` (y el equivalente `mcp-suelto.json`):
```json
{ "mcpServers": { "nest_memory": { "command": "/tmp/nmk/nm-con-nest", "args": ["mcp"] } } }
```
y `claude --mcp-config /tmp/nmk/mcp-con-nest.json --strict-mcp-config`.

### 4. Qué probar

- `nm-con-nest status` / `nm-suelto status`: de qué base lee cada uno.
- `nm-* search "dos palabras"` con un orden distinto al del texto guardado: tiene que
  encontrarla (es el cambio de hoy).
- `nm-suelto login`: aprobar el código desde el Nest dev (Memories → «Connect a machine
  without a browser») antes de los 10 minutos.
- MCP en los dos modos: `memory_save` y `memory_search` desde un Claude Code real.

**No correr `setup` real ni instalar el `.vsix`**: escriben `npx -y nest-memory mcp` y el
nombre en npm sigue libre.

**OJO en un panel de Nest**: el `HOME` está redirigido a la carpeta de la cuenta, así que
el modo suelto guarda su credencial y su base en `<HOME de la cuenta>/.nest-memory/`, no en
el `~` real.

---

## Pendiente (sin cambios desde el 16-oct)

1. Probar el plugin (arriba).
2. Cifrado de equipo del lado del **miembro**: necesita una segunda cuenta.
3. Deploy a Railway, con OK explícito.
4. Reservar `nest-memory` en npm.
5. Llavero de Windows y Linux: escrito, nunca ejecutado (falla cerrado). Si la otra PC es
   Windows, es buen momento para probarlo.
6. Limpieza: 4 memorias de prueba en español («Smoke del paquete…»), 2 en el
   `.nest-memory/` del HOME de la cuenta Claude en Nest y 2 en el home del Nest dev. La UI
   y los datos visibles van en inglés.
7. Fase 1: el lado verde del §2.2 (una CLI que sí llega al bridge) y el workspace de equipo
   con equipos joineados.
8. El cifrado nunca se probó entre **dos máquinas físicas**. Con la otra PC se puede.

---

## Actualización del 19-10 (tarde, desde Windows): rama `feat/memories-settings`

Sale de `feat/nest-terminal-ui` @`bb0fda7`. **Local, sin push.** 24 commits.

**Qué trae**
- **Plugin**: sin `NEST_MEMORY_SYNC_URL` usa el servicio por defecto de Nest; `login` guarda
  contra qué servicio se conectó (el token sólo vale ahí) y avisa por stderr si el env apunta a
  otro. Se publica como **`@nestmux/memory`** (nombre en una constante:
  `electron/nombre-del-paquete.ts` + espejo `src/lib/nombre-del-paquete.ts`, con test que los
  ata a `package.json`). La carpeta `~/.nest-memory/` y la clave MCP `nest_memory` NO cambian.
- **Rediseño de Memories** (spec `docs/superpowers/specs/2026-10-19-memories-vista-y-settings-design.md`,
  plan `docs/superpowers/plans/2026-10-19-memories-vista-y-settings.md`): la vista principal
  sólo muestra memoria (grafo, lista, chips por tipo con color de la paleta ANSI del tema,
  ajustado a 3:1); la configuración vive en **Memory settings** dentro del overlay (01 Sync ·
  02 Encryption · 03 This project & team · 04 Notes on disk); «Cloud memory» salió de Settings
  global; bienvenida de primera visita + tour de 5 pasos + «How Memories works».
- Verificado: los dos `tsc` en 0; `npm test` 3796 verdes; e2e 03, 04 (mide también las
  pantallas nuevas), 08, 12 (dos corridas seguidas, cuenta nueva por corrida) y 16 en verde.

**Probado contra staging**: el plugin suelto en Windows (login con código → credencial en el
llavero de Windows → `memory_save` por MCP → las memorias llegan a staging). Staging tiene el
servidor de octubre; **prod no** (va con el release). La allowlist de staging suma
`gerodc06@`.

**Bloqueante de release**: la UI y la CLI muestran `npx @nestmux/memory`. No se publica nada
hasta que exista la org `nestmux` en npm (Gero, con 2FA) y esté publicado `@nestmux/memory`.
La 0.0.1 de reserva está armada en el scratchpad de la sesión; `packages/nest-memory` sigue con
`private: true` a propósito.

**Pendiente**
1. Gero prueba el rediseño en la app (`npm run native:electron` si corriste tests, después `npm run dev`).
2. Org `nestmux` + 2FA en npm → publicar la reserva.
3. Vista de terminal del plugin estilo Engram (para quien no usa Nest) — arrancar con diseño.
4. Deploy a prod con el release.

### Cierre del 19-10 (noche) — retomar acá

- Rama `feat/memories-settings` lista y revisada; **sin mergear ni pushear**. Falta que Gero elija:
  mergear a `feat/nest-terminal-ui`, abrir PR, o dejarla.
- Suite completa sobre el árbol final: 3818 verdes / 4 fallas por carga (pasan aisladas, dos
  corridas). Ojo: `MemoryGraphPanel-chips-tipo` (nuevo) y `MemoryDocumentoAcciones` son sensibles
  a la carga; conviene darles más margen o revisar sus `waitFor`.
- Gero empezó a probar el rediseño en el Nest dev (kit en el scratchpad de la sesión, contra
  staging). Primera cosa mañana: seguir esa prueba y anotar lo que vea.
- Después: org `nestmux` + 2FA en npm → publicar la reserva; y la vista de terminal del plugin
  estilo Engram (arrancar con brainstorming).
- El binding de better-sqlite3 quedó en Electron (sha `359cbd480d7c…`).
