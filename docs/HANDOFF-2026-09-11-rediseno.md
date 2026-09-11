# Handoff — rediseño visual de Nest (rama `feat/nest-terminal-ui`)

Estado al 2026-09-11, madrugada. **Nada pusheado**: 65+ commits locales por decisión
explícita del usuario ("todo en local por el momento hasta nuevo aviso").

---

## Si vas a seguir esto desde otra máquina — leé esto primero

La rama en `origin` está en `2f1d47c`, meses atrás. Para trabajar desde otra máquina hay
que pushear, **y eso requiere el OK del usuario**.

Pero el problema mayor no es git: **el contexto de las decisiones no viaja**. El ledger,
los ~57 briefs y reportes de cada task y los diffs de review viven en
`.superpowers/sdd/2026-09-09-migracion-tailwind-shadcn/`, que está gitignoreado a
propósito (12 MB). Las capturas sí viajan desde el commit `6d487d6`; el resto no. Este
documento existe para cubrir ese hueco.

Y en Windows hay una piedra conocida, documentada en `CLAUDE.md`: `better-sqlite3` no tiene
prebuild para el ABI de Node 20, así que compila desde source, y ahí falla si no está el
toolset ClangCL de Visual Studio.

**Recomendación: seguir desde la Mac donde se hizo.** Windows sirve para algo distinto y
valioso —verificar que el rediseño se ve igual en los dos sistemas, que es el eje de todo
esto— pero como sesión de verificación, no de continuación.

---

## Lo que está hecho

| Qué | Commit |
|---|---|
| Migración a Tailwind v4 + shadcn (tasks 1–12 del plan) | varios |
| Preflight de form controls + Geist sólo subset latin | `89f8d62`, `44543cb`, `6198d79` |
| Tratamiento B de botones: sólido / contorno / fantasma | `2020396` |
| Una sola escala de filas: 32 / 28 / 24 | `a13c7c1` |
| Aire entre las tabs y `Link repo` | (junto a `a13c7c1`) |
| Lo local es gratis; compartir al equipo mira la capacidad | `c48ea5a`, `3e14094` |
| Puente de datos del grafo de memorias | `1c7b948` |
| Aristas por similitud (apagadas por default) | `4440f0f` |
| `.tab-name`, `<select>` de Team, 3 clases CSS muertas | `7fb45cf`, `1074362`, `5e283e0` |
| Las capturas de evidencia dejan de perderse | `6d487d6` |
| `CLAUDE.md`: el baseline de typecheck que documentaba era falso | `3fca393` |

### Specs escritas

- `docs/superpowers/specs/2026-09-10-workspace-shell-design.md` — la cáscara compartida.
- `docs/superpowers/specs/2026-09-11-memories-legible-design.md` — el contenido de Memories.
- `docs/RECETA-MIGRACION-UI.md` — la receta con las trampas que ya mordieron.

---

## Las cuatro cosas que hay que saber antes de tocar nada

**1. Los estilos inline y el CSS sin capa le ganan a cualquier utilidad de Tailwind**, sin
importar la especificidad. Si un estilo "no aplica", esa es casi siempre la causa — no la
especificidad. De los componentes sin migrar, 55 tienen estilos inline y 16 con color
hardcodeado.

**2. El typecheck real son estos dos, y hoy dan cero errores:**

```bash
npx tsc -p tsconfig.node.json --noEmit --composite false
npx tsc -p tsconfig.web.json  --noEmit --composite false
```

`npx tsc -b` **no sirve**: falla con tres errores `TS6307` de configuración de project
references que abortan el build antes de chequear código. `CLAUDE.md` decía lo contrario
hasta el commit `3fca393` y **dos agentes cayeron ahí**.

**3. Un guard que no viste fallar no es un guard.** En esta rama pasó tres veces que un
test verde no probaba nada: el más engañoso mockeaba `team: null`, así que nunca llegaba
al gate que decía estar probando. Rompé lo que el test afirma, confirmá el rojo, restaurá.

**4. Verificá todo número antes de construir encima.** Pasó cuatro veces que un reporte
afirmó algo que el repo desmentía — incluida una en la que el propio controlador escribió
un número falso en un comentario del código. Los casos: los scrollbars "sin estilar" (ya
había una regla universal), `.tab-name` "en 16px" (eran 12), "~15 errores de tipo
preexistentes" (eran cero), y "la mayoría de los form controls estaba desnuda" (65 de 87
ya estaban cubiertos).

---

## Decisiones tomadas (no se revisitan sin el usuario)

### Producto
- **Todo lo local es gratis.** Se paga la memoria en la nube; Teams es custom.
- Compartir al equipo se gatea por **capacidad** (`PLAN_LIMITS[plan].memoryTeamShare`), no
  por nombre de plan — el gate viejo dejaba que un usuario **Cloud** compartiera al equipo.
- **Integrations y Orchestration se esconden, no se borran** (`ENABLE_INTEGRATIONS_ORCHESTRATION`
  en `src/lib/releaseFlags.ts`). No salen en esta release, pero el hito 1 está terminado.
- El catálogo de agentes **detecta por PATH en vez de prometer**. Agregar un agente es una
  línea y un SVG; lo caro es garantizar 27 binarios que cambian flags.

### Visual
- Jerarquía por **forma**: sólido / contorno / fantasma. Es lo que el primitivo shadcn ya traía.
- **El color es estado, nunca marca.** Allow-list justificada: marca de terceros (los logos
  de IA conservan su color), leyenda categórica, íconos por extensión.
- Una sola escala, **24 / 28 / 32 / 36**, compartida por botones y filas.
- **Ninguna librería de animación.** La app ya tiene 21 keyframes y la curva
  `cubic-bezier(.32,.72,0,1)`; el problema era que las tres pantallas grandes no la usaban.

### Memories
- La pantalla muestra **memorias**, no diagnóstico. Hoy no muestra ni una.
- Memorias de **todos los proyectos juntas**.
- Grafo **3D**, en un **cuadro acotado** que no se coma la pantalla (como el panel local de
  Obsidian).
- **Un contador se muestra sólo si el dato ya está.** Nada de fetches nuevos para pintar un
  número; sin dato no se muestra cero, se muestra nada.
- Las aristas por similitud van **apagadas por default**: las otras tres son hechos que
  alguien afirmó, ésta es inferencia.

### Alcance
- **Los overlays se quedan.** Orca no los tiene —todo vive en un shell persistente— y es
  probablemente la diferencia de fondo, pero es reestructurar la app entera.

---

## La cola, en orden

1. **`<select>` de Team → componente `Select` de shadcn.** El popup nativo de macOS no se
   puede capturar (es overlay del sistema); Radix renderiza en el DOM, se estila, se ve
   igual en los tres sistemas y se puede verificar.
2. **Cáscara de los workspaces**, en tres tandas — brief de la primera en
   `.superpowers/sdd/.../cascara-1-brief.md`:
   movimiento y nav con estado → logos de IA por fila → estados vacíos.
3. **Memories**: la lista, el grafo 3D acotado, las dos tools MCP.
   Brief de la parte de datos en `.superpowers/sdd/.../memories-datos-brief.md`.
4. **`.repo-action-btn`**: quedó en 26px, fuera de la escala, porque My Repos exige GitHub
   conectado de verdad. La salida es inyectar repos falsos en el harness.
5. **Migración de íconos a `lucide-react`.** Hay **171 `<svg>` escritos a mano en 41
   archivos**, con **9 tamaños** (10, 11, 12, 13, 14, 15, 16, 22, 28 px) y **8 grosores de
   trazo** (1.1 a 2 — con 105 en 1.3, 45 en 1.4 y 31 en 1.2, que a ojo son el mismo y no lo
   son). `lucide-react@^1.43.0` está instalado **desde antes y su único uso apareció el
   2026-09-11**, en `src/components/ui/select.tsx`, el primitivo que se migró ese día.
   Es tedioso pero mecánico, y conviene de **una sola pasada con verificación visual** — no
   de a poco, porque el valor está en que queden todos iguales. Es de lo que más rinde
   contra "parece improvisado": parte de por qué Orca se ve coherente es que sus íconos
   salen todos del mismo set.
6. **Catálogo de agentes** y **barra de cuotas** (A1–A5 de `INTEGRATIONS_ORCA_BACKLOG.md`).

### Librerías — auditoría del 2026-09-11

Hecha con evidencia, no con una lista genérica. El resultado: **falta menos de lo que sobra
mal usado**.

- **Falta de verdad:** virtualización de listas (`@tanstack/react-virtual`). No hay ninguna,
  y la lista de memorias de todos los proyectos se traba sin ella. Entra con Memories.
- **Medido y decidido (2026-09-11):** el render 3D es `react-force-graph-3d` detrás de un
  `import()` diferido. Cuesta **+1.4 KB crudos en el arranque** (0.04%) contra los 1379.8 KB
  que costaría importándolo arriba; el 1.37 MB se carga de disco al abrir el grafo. La tabla
  de las cuatro mediciones está en la spec de Memories.
- **Deuda:** los 171 íconos a mano contra una librería instalada y sin usar.
- **Ya está, no traer nada:** Radix completo, `react-resizable-panels`, `@dnd-kit`, el stack
  shadcn entero (`cva`, `clsx`, `tailwind-merge`, `tw-animate-css`), `shiki` + Monaco.
  **Toasts tampoco faltan**: hay `NotificationPanel.tsx` propio.
- **No justifica dependencia:** gráficos (`TeamStats` dibuja ocho elementos SVG) ni fechas
  (11 lugares con formateo a mano → un helper compartido de diez líneas).

### Abierto, sin decidir

- **El popup del `<select>`** nunca se vio de verdad (limitación de permisos de captura de
  pantalla en el entorno).
- **El área de click del sidebar colapsado**: bajó de 43×44 a 43×32, −27%. Medido, no
  resuelto.
- **`memory_update` puede no ser seguro de implementar** tal cual: tiene que participar del
  mismo mecanismo de replicación (`content_hash`, `revision_count`, `lamport`,
  `mutation_log`) o deja registros inconsistentes.

---

## Cómo levantar la app para mirarla

`npm run dev` **no funciona** si la Nest instalada está abierta: `electron/main.ts:81` pide
`requestSingleInstanceLock()` y la instancia nueva se cierra sola con exit 0, en silencio.

La salida es un `--user-data-dir` propio, que es lo que hace el harness de e2e. Hay un
script en el scratchpad de la sesión que lo automatiza. **Con `RAVEN_HOME` y `HOME`
temporales la app arranca con un perfil vacío** —sin repos, sin Hub, sin config— y eso se
confunde fácil con "falta código". No falta: son los datos.

Para verla con datos reales hay que cerrar la Nest instalada, o usar `HOME` real con
`--user-data-dir` distinto — con la salvedad de que serían dos procesos sobre la misma
base de memoria.
