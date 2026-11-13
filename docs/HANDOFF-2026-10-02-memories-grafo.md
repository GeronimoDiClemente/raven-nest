# Handoff — Memories: grafo, lista y MCP (2 de octubre de 2026)

Para seguir desde otra máquina. Rama: **`feat/nest-terminal-ui`**, todo commiteado y pusheado.

```bash
git fetch origin && git checkout feat/nest-terminal-ui && git pull
npm install            # deja el binding de Electron
```

---

## Lo que se cerró en esta sesión

| commit | qué |
|---|---|
| `f8f87f7` | **La lista de Memories no mostraba lo recién guardado** hasta reabrir. Desde `089d2bf` la búsqueda vive en el workspace y remontar la lista ya no la recargaba. `useCrossProjectMemories` tiene `refresh()` y el workspace lo llama en cada bump de `version` |
| `c4010bd` | **El MCP `nest_memory` sin daemon fallaba siempre** («No read-only database opener was registered at startup»). El shim `electron/memory-mcp/index.ts` es otro proceso y nunca registraba el motor de SQLite |
| `e88257b` | **Grafo 3D**: llena la caja (encuadre sin extremos + gravedad al centro), caja `clamp(420px, 55vh, 720px)`, inercia en la órbita, giro solo lento. Cifrado / vincular máquina / servicio de sync pasaron **al fondo** de la pantalla |
| `11bd4ff` | **La fila del usuario en la sidebar se aplastaba** con la ventana baja (22px en vez de 32): era la única sin `flex-shrink: 0` |

Verificado al cerrar: unitarios 3480 en verde, typecheck de CI (los dos comandos) en 0, e2e
`03`, `04`, `08` y `10` en verde contra un build nuevo.

---

## Por dónde seguir: links estilo Obsidian EN LA APP

El usuario preguntó si quedó implementado «buscar por referencias, y que dentro del texto de
una memoria puedas ir a otra». **Del lado de los agentes, sí; en la app, no.**

- **Hecho** (ver la memoria `memories-wikilinks-obsidian`): los `[[...]]` del contenido se
  resuelven por topic → último tramo del topic → alias → título; son aristas `wikilink` en el
  grafo; los no resueltos son nodos hueco; `memory_get` devuelve vecinos y backlinks.
- **Falta**: el panel del documento (`MemoryGraphPanel.tsx`, el `<pre>` cerca de la línea
  607) muestra el contenido **crudo**. No hay Markdown, los `[[...]]` no se pueden clickear y
  no hay lista de «Mencionada en».

Propuesta que quedó sobre la mesa (diseño acotado, **todavía sin aprobar**):
1. Renderizar el contenido como Markdown (negritas, código).
2. `[[...]]` clickeable → selecciona esa memoria (lista + grafo, es la misma selección).
   Un hueco no navega a ningún lado: se muestra como pendiente.
3. Sección «Mentioned in» al pie, con los backlinks.

**Pregunta abierta al usuario**: dijo «por una palabra en **negrita** ir a la otra memoria».
¿Quiere decir los `[[links]]`, o que cualquier `**negrita**` lleve a una memoria con ese
nombre? Lo segundo no es Obsidian (ahí sólo `[[...]]` linkea). Preguntarle antes de diseñar.

La UI va en inglés (lo fija `src/__tests__/la-app-es-en-ingles.test.ts`).

---

## Trampas que mordieron hoy

- **Después de `npm test` la app no arranca** hasta `npm run native:electron` (el binding de
  better-sqlite3 queda en el de Node). Y el MCP de memoria tampoco abre la base.
- **Los e2e corren contra `dist/`**: `npm run build` antes, o el verde no prueba tu cambio.
- **El MCP de memoria de las sesiones corre `dist-electron/memory-mcp.js` DEL REPO.** El
  arreglo de `c4010bd` llega recién con un `npm run build` en esa máquina **y una sesión
  nueva de la CLI**: los procesos ya lanzados siguen con el código viejo.
- **El exit code de `npm test` es 1 con todo en verde**: hay un error de sourcemap
  preexistente («Unhandled Errors»). Mirar la línea `Tests N failed`.
- **Medir el grafo con Playwright por CDP**: el build de dev tiene que levantarse con
  `--disable-renderer-backgrounding --disable-backgrounding-occluded-windows
  --disable-features=CalculateNativeWinOcclusion`, o con la ventana tapada rAF se frena. Y
  un script con `connectOverCDP` no termina solo: `process.exit(0)` al final.
- **Levantar el dev build junto a la Nest instalada** (sin matar las sesiones que viven en
  sus panes):
  ```bash
  RAVEN_HOME=$HOME npx electron-vite dev -- \
    --user-data-dir="$HOME/Library/Application Support/nest-dev" --remote-debugging-port=9222
  ```
  En Windows/Linux el `--user-data-dir` va en la ruta de datos de la app de esa plataforma.

---

## Otros pendientes (no urgentes, ninguno de código puro)

- Paquete portátil: `login` de punta a punta contra Railway (necesita aprobar el código desde
  Nest en < 10 min); llavero de Windows y Linux escrito y nunca ejecutado.
- Fase 1 de memories: el lado verde del §2.2 y el workspace de equipo con equipos joineados
  (necesitan credenciales reales).
- Batería: re-medir en la pestaña Energía (baseline 224,95); ~6% en reposo sin atribuir.
- **Release: no ofrecer.** El usuario la trae cuando quiera.
