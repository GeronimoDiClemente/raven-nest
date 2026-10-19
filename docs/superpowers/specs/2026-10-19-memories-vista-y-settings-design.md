# Memories: mirar vs. configurar — diseño

**Fecha:** 2026-10-19 · **Rama:** `feat/nest-terminal-ui` · **Estado:** para revisión de Gero

Mockups (versión anterior a la dirección visual de §5, sirven para la estructura):
https://claude.ai/artifact/3MvgSq3PYXbS91JDR4pECR

## 1. Problema

El overlay Memories mezcla dos cosas: lo que se **mira** (grafo, lista, búsqueda) y lo que se
**configura una vez** (cifrado, cifrado de equipo, vincular una máquina, servicio de sync,
compartir el proyecto, el hilo del equipo). Las tarjetas de configuración se apilan debajo del
contenido y se sienten incómodas. Además la configuración de memoria está partida en dos
lugares: «Cloud memory» vive en los Settings globales.

Y Memories no se explica: las tarjetas dicen qué hacer pero no qué son ni para qué sirven
(«Connect a machine without a browser», «Sync service», «Share with a team», «Team thread»
fueron los cuatro casos concretos que no se entendían).

## 2. Qué queda en Memories (la vista principal)

- **Header:** Back · «Memories» · a la derecha «How it works» y «Settings» (engranaje).
- **Fila de estado:** igual que hoy (pending, notas del vault, conflictos, bloqueadas,
  terminales mudas), **sin** el popover del vault (pasa a settings, §3).
- **Body:** «New memory» · chips por tipo de memoria con contador (filtran el grafo y la
  lista) · grafo · lista con buscador.
- **Grafo de ramas del hilo:** sólo aparece si el hilo está prendido para el repo de la
  pestaña. Sin el estado vacío «Share this project's thread… Turn on» ni la línea «Link a
  repo»: las dos son configuración y van a §3.

Sale de la vista: `ShareProjectCard`, `MemoryEncryptionCard`, `TeamEncryptionCard`,
`LinkDeviceCard`, `SyncServiceCard`, el toggle del hilo.

## 3. Memory settings (vista dentro del mismo overlay)

El engranaje reemplaza el body por una vista con navegación lateral (el mismo
`WorkspaceNavButton` de los Settings globales). Back vuelve a los nodos. Secciones, por uso:

| # | Sección | Contenido |
|---|---|---|
| 01 | **Sync** | «Cloud sync» (la tarjeta de Nest Memory traída de los Settings globales, extraída a `CloudMemoryCard`) · «Add a machine that has no browser» (`LinkDeviceCard`) · «Where your memory syncs to», marcada *Advanced* (`SyncServiceCard`) |
| 02 | **Encryption** | «Encrypt your memory» (`MemoryEncryptionCard`) · «Encrypt what <team> shares» (`TeamEncryptionCard`, sólo con equipo activo) |
| 03 | **This project & team** | «Share this project's memory with a team» (`ShareProjectCard`) · «Branch notes in the repo» (el toggle del hilo) · sin repo vinculado: sólo «Link a repo» |
| 04 | **Notes on disk** | `MemoryVaultCard` (hoy en el popover) |

Abajo del rail: **«How Memories works»**, que abre el recorrido de §4.2.

### 3.1 Copy: qué es y para qué sirve, en cada tarjeta

Cada tarjeta lleva título que dice lo que hace, una línea de *qué es* y, cuando hace falta,
*cuándo se usa*. Los textos de los mockups son la base. Puntuales:

- **Add a machine that has no browser:** «For a server, a VM or an SSH box where you can't
  sign in with a browser», y los dos pasos numerados (`npx @nestmux/memory login` → tipeá el
  código acá en 10 minutos).
- **Where your memory syncs to:** «Leave it as it is — change it only if your company runs its
  own Nest server».
- **Share this project's memory with a team:** dos cajas, *The team will see* / *Stays only
  yours*. El texto final se ajusta a lo que el código hace hoy: compartir **no es autoservicio**
  (sólo despliegues propios o plan team/enterprise; ver el encabezado de `ShareProjectCard.tsx`).
  La cara «sin permiso» sigue explicando por qué.
- **Branch notes in the repo:** escribe una nota por rama en `.nest/team/`, viaja con git, y
  dibuja el mapa de ramas debajo del grafo.
- **Encrypt your memory:** aviso del código de recuperación («si perdés todas las máquinas y el
  código, la copia de la nube no se abre nunca más»).

### 3.2 La barra de la nube

Hoy en «Cloud memory» la barra de **progreso de subida** está pegada a la **cuota**, y se lee
como «casi lleno» (3.1 MB de 1 GB con la barra al 92%). Se separan:
- subida: texto «Uploading N changes…» con punto ámbar, sólo mientras hay pendientes;
- cuota: «Cloud space: X of Y» con su barra a escala real.

El checkbox «Also delete my cloud memory» pasa a la confirmación de «Turn off».

## 4. Explicarse adentro de la app

### 4.1 Primera visita a Memories

La primera vez que se abre (flag persistido por usuario, como `hasSeenMemoryHub`):
1. **Bienvenida que muestra, no enumera:** una escena — una terminal donde un agente guarda
   «decision: …» y, abajo, otra sesión al día siguiente que la lee sola. Debajo, los cuatro usos
   como lista de texto corta: sólo para vos · en todas tus máquinas · con tu equipo · fuera de
   Nest (`npx @nestmux/memory`). Botones «Show me around · 5 steps» y «Skip».
2. **Tour de 5 pasos sobre la pantalla real** (spotlight + tarjeta): fila de estado → grafo →
   búsqueda y lista → New memory → Settings.

«How it works» en el header lo reabre.

### 4.2 «How Memories works» en settings

Recorrido de 4 pasos, uno por sección (Sync → Encryption → This project & team → Notes on
disk), que navega la vista mientras explica.

### 4.3 Motor del tour

Se reusa el sistema de tutoriales existente (`src/tutorial/`, el del tour de Worktrees), que
está **pausado** (memoria `tutorial-feature-state`). Si su estado no da para dos tours más, el
plan lo resuelve con un componente de coachmark propio y chico; se decide al leerlo en el plan.

## 5. Dirección visual

Se descartó la primera pasada (cuadraditos de color con ícono, paleta pastel, tarjetas 2×2):
era genérica. Reglas:

- **Color sólo donde es dato:** los tipos de memoria. Salen de la **paleta ANSI del tema de
  terminal elegido** (`lib/terminal-themes.ts`), no de una paleta inventada: Memories se ve como
  tus terminales. Mapeo: decision → blue · bugfix → red · architecture → magenta · discovery →
  cyan · pattern → green · handoff → yellow · config / preference / session → gris (ANSI 8).
  Se usan en nodos del grafo, chips de filtro y la etiqueta de tipo de cada fila.
- **Rail lateral sobrio:** íconos grises, activo con el fondo gris de siempre, sin color.
- **Jerarquía con tipografía:** secciones numeradas en monoespaciada (`01 Sync`), sin íconos
  tintados en los títulos.
- **Estados** con los tokens existentes (`--ok`, `--warn`, `--destructive`).
- shadcn + utilidades, sin clases nuevas en `global.css` (regla del CLAUDE.md).

**CLAUDE.md:** el color por tipo de memoria entra en la allow-list de «leyenda categórica de un
estado no binario». Se agrega una línea con este caso.

## 6. Settings globales

- Sale la sección «Cloud memory» (`SECCIONES` y su `<Seccion>`); `MemoryHub` y `UpgradeModal`
  viajan con `CloudMemoryCard`.
- En Account, «Open Memories» pasa a «Memory settings» y abre Memories directo en la vista de
  settings (`onOpenMemories('settings')`).
- `MemoryAdoptionDialog` se queda donde está (no depende de que Settings esté abierto).

## 7. Piezas

- `MemoriesWorkspace.tsx`: estado `vista: 'memorias' | 'settings'`, header con los dos
  botones, body según la vista. Prop nueva `vistaInicial`.
- `MemorySettingsView.tsx` (nuevo): rail + secciones.
- `CloudMemoryCard.tsx` (nuevo): extraído de `SettingsPanel.tsx:652-822` con su estado.
- `useTeamThreadSettings` (hook nuevo): leer/escribir el setting del hilo. Lo usan el toggle
  (settings) y `TeamThreadPanel` (que pierde el estado vacío y el «Turn off»).
- `MemoriesStatusRow.tsx`: sin el popover del vault.
- `lib/memory-type-colors.ts` (nuevo): tipo → índice ANSI, puro y testeado.
- Tour: según §4.3.

## 8. Tests

- e2e a ajustar: `03-memories-in-app` (share y toggle del hilo pasan a settings) y
  `12-cifrado-dos-maquinas` (encryption pasa a settings). El resto sólo abre/cierra el overlay.
- Unit: mover los de cloud de `SettingsPanel.test` y `settings-una-seccion` a
  `CloudMemoryCard`; `MemoriesStatusRow.test` (el popover del vault se va); nuevos para
  `MemorySettingsView` (navegación), `memory-type-colors` y el flag de primera visita.
- `iconos-sin-repetir` sobre el rail nuevo.
- `e2e/04-contraste.spec.ts` antes de commitear (regla del CLAUDE.md).
- Typecheck: los dos `tsc` de CI.

## 9. Fuera de alcance

Cambiar qué hace cada tarjeta, los IPC, el comportamiento de compartir o del cifrado.
