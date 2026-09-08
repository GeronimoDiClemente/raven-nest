# Team Memory Layer 2 — el hilo del proyecto

> Rama: `smoke/memory-bridge`
> Fecha: 2026-09-08
> Construye sobre: Layer 1 (`team_memberships`, `POST /v1/projects/share`, pull autorizado fila por fila)
> Reusa: `docs/superpowers/specs/2026-08-26-memory-vault-design.md` (motor de notas)
> Evidencia externa: research del 2026-09-08 (competencia, infra de memoria, prácticas humanas)

## 1. Qué es

El reemplazo del `.md` que la gente del mismo proyecto se manda a mano para que el otro
tenga contexto.

En palabras del usuario que lo pidió:

> "gente del mismo proyecto enviándose .md o handoffs manuales a los otros miembros para
> que tengan contexto de cómo se viene llevando el proyecto, y el contexto tiene que
> llegar de manera que se respete la forma en la que se viene llevando"

Concretamente: **un documento vivo en disco, por proyecto, organizado como índice + una
nota por rama, que aparece solo en la máquina de cada compañero y que ninguna persona
tiene que escribir ni mandar.**

Layer 1 movió las filas entre cuentas. Layer 2 las convierte en algo que una persona lee.

### 1.1 Por qué esto y no otra cosa

El research del 2026-09-08 midió el hueco. El resumen que importa para las decisiones de
abajo:

- **Nadie tiene las cuatro propiedades juntas** (documento vivo · por rama · con autor y
  fecha · sincronizado por cuenta y no por git). Devin es el más cercano pero su
  conocimiento son ítems atómicos sin rama; Copilot Memory es el único con verificación
  por rama pero son facts sueltos, sin autor y con retención de 28 días; Amp tiene autor
  e hilo cronológico pero sincroniza el log crudo, y en junio 2026 tuvo que matar los
  threads públicos por fuga de datos.
- **La industria vio el problema y decidió no resolverlo.** Cursor, Windsurf, Claude Code
  y Augment tienen captura automática y las cuatro la dejan machine-local y personal, por
  escrito en sus docs. Las dos primeras recomiendan explícitamente que, si querés algo
  durable y compartido, lo escribas a mano en un archivo commiteado — que es exactamente
  el `.md` del dolor.
- **El hueco no es "memoria de equipo"**: eso ya existe tres veces (Cognee tiene el mejor
  control de acceso, Zep el mejor modelo temporal, Basic Memory el mejor formato). **El
  hueco es que el estante compartido se llene solo.** En los tres, alguien tiene que hacer
  una llamada explícita para promover algo.
- **Amenaza concreta**: Basic Memory Teams ($15/seat) ya tiene markdown determinístico,
  wikilinks, plugin de Claude Code con briefing de sesión y workspace de organización. Le
  falta sólo el write-back automático de agentes, y lo tiene anunciado.

## 2. Restricciones de base

- **Ni una tabla nueva ni un endpoint nuevo.** Layer 1 ya mueve las filas. Lo único que
  cambia en la ruta de captura es el `scope` con el que nace una fila.
- **El archivo nunca entra a git.** Es material derivado: cada máquina lo regenera de su
  memoria sincronizada. Eso es lo que evita el conflicto de merge entre compañeros, que
  es el modo de falla que mata a la solución manual.
- **El vault personal sigue excluyendo todo scope `team`** (decisión de producto de
  Task 5, privacidad de compañeros). Las notas del equipo son otra carpeta y otro módulo,
  no una relajación de esa regla.
- **Sin pipeline de síntesis aparte.** Los datos duros salen por parsing de lo que Nest ya
  sabe; la narrativa sale de los handoffs que la gente y sus agentes ya escriben. Ningún
  modelo redacta el hilo.
  *(Redacción deliberada: no decimos "costo cero de tokens". El contenido de cada entrada
  lo redacta igual el LLM del agente cuando escribe el handoff. Lo que no existe es un
  pipeline de extracción aparte, que es donde la categoría gasta y falla.)*
- **Multi-OS**: se reusa `vault-naming.ts`, cuyos slugs ya son estables en NTFS, APFS y
  ext4.

## 3. Las decisiones tomadas

Cerradas en el brainstorm del 07 y 08 de septiembre. No reabrir sin motivo nuevo.

1. **Qué tiene que "respetarse"**: las convenciones de trabajo (que no se reabran
   discusiones cerradas), el hilo y no memorias sueltas, el formato del equipo, y de quién
   viene cada cosa — autor y fecha, y que se vea que es de equipo y no personal.
2. **Qué se comparte solo**: por default sólo el hilo del proyecto (handoffs +
   decisiones); todo lo demás sigue naciendo `personal`. Configurable por proyecto desde
   la UI. Esto matiza la regla de Layer 1 ("la promoción es siempre manual"): sigue
   habiendo un default conservador, pero deja de ser manual pieza por pieza.
3. **Cómo llega**: un documento vivo en disco. Es lo único que funciona en todos los CLIs
   — ver §3.1. Donde el CLI además deje inyectar, se inyecta.
4. **Estructura**: índice + una nota por rama/worktree, enlazadas con `[[wikilinks]]`,
   estilo Obsidian. Reusa el motor de notas del vault.
5. **Quién escribe el hilo**: híbrido, mecánico + lo que ya se escribe. Nada de sintetizar
   con un modelo: gasta tokens en cada cierre y puede afirmar cosas que nadie dijo.
6. **Checkpoints por turno**: el relato deja de escribirse sólo al cerrar.
7. **Se escribe uno por worktree, completo.** Mismo precedente que `handoff.md`: la unidad
   de trabajo es el worktree y el CLI corre con `cwd` ahí. Es derivado y chico, y el
   hash-compare evita reescribir si nada cambió.
8. **El SQLite local sube a `synchronous = FULL`** (§8.3).
9. **La v1 lleva vista de grafo** (§7).
10. **Enfoque B**: módulo nuevo, no un flag en el módulo del vault personal (§5).

### 3.1 Por qué "documento en disco" y no un tool MCP

Esta decisión es la que más evidencia externa tiene, y conviene dejarla escrita porque es
contraintuitiva (lo natural sería exponer un tool y confiar en que el modelo lo llame):

1. **Anthropic le grita al modelo en mayúsculas.** Cuando el memory tool está en `tools`,
   la API inyecta sola al system prompt: `IMPORTANT: ALWAYS VIEW YOUR MEMORY DIRECTORY
   BEFORE DOING ANYTHING ELSE`. Nadie escribe eso si el tool se llama de forma confiable.
2. **El servidor MCP `server-memory` oficial lo admite en su README**: si el modelo no
   prioriza guardar, la información se pierde. Documentado como comportamiento esperado.
3. **Cline usa el mismo recurso**: *"I MUST read ALL memory bank files at the start of
   EVERY task - this is not optional"*. Convención de prompt, no mecanismo.
4. **El creador de Memobase, sobre su propio producto**: *"Agents don't automatically use
   it all the time without being prodded"*.
5. **Redis documenta los dos patrones lado a lado y falla a favor del determinístico**: el
   LLM-driven tiene overhead de schemas y latencia de rondas extra; el `memory_prompt`
   hidratado es "eficiente, sin overhead de tools, menos llamadas API".

Y del otro lado: Letta —el proyecto más viejo de la categoría— compila su core memory al
system prompt en cada turno, sin retrieval.

**La matización, para no sobrevender:** inyectar garantiza la *entrega*, no la
*obediencia*. La doc de Claude Code lo dice: *"there's no guarantee of strict
compliance"*, y para lo que debe pasar sí o sí recomienda hooks, no memoria.

Refuerzo propio: el spike del 07-09 midió que **opencode no puede inyectar contexto en el
prompt**. Un archivo en disco es lo único que funciona en los cinco CLIs que soportamos.

## 4. Layout en disco

En cada worktree enrolado, al lado del `handoff.md` que ya existe:

```
<worktree>/.nest/
  handoff.md              ← ya existe, personal, NO se toca
  team/
    _index.md             ← el MOC: de quién es cada rama, qué se movió último
    ramas/
      sidebar-tabs.md     ← una nota por rama/worktree
      memory-bridge.md
    general.md            ← lo de equipo sin rama atada
    _conflicts/           ← bytes del usuario si editó a mano
    README.md             ← "esto es un espejo, Nest lo regenera"
    .manifest.json
```

`.nest/` ya está excluido por `.git/info/exclude`, y esa exclusión la escribe
`handoff.ts:excluirNestDelRepo`, que contempla que en un worktree `.git` es un **archivo**
con `gitdir:` adentro y no un directorio. Es por clon, no se commitea y no toca nada
versionado.

### 4.1 La unidad es la rama, no la observación

Ésta es la diferencia estructural con el vault personal, donde cada fila es una nota. Acá
el planner **agrupa por `gitBranch`** y renderiza el hilo de esa rama en orden
cronológico. Para reusar `applyVaultPlan` sin deformarlo, cada nota lleva un id sintético
estable `rama:<slug>` en el lugar donde el vault pone el `syncId`.

Las filas `team` sin `gitBranch` van a `general.md`.

### 4.2 Una nota de rama

```markdown
---
nest_scope: team
nest_project: raven-nest
nest_rama: feat/sidebar-tabs
nest_estado: activa            # activa | sin-worktree | cerrada
nest_ultima_sync: 2026-09-08T14:22:03Z
nest_version: 1
---
# feat/sidebar-tabs

Índice: [[_index]] · Relacionadas: [[memory-bridge]]

## 2026-09-07 14:20 · Gero
2da vuelta del sidebar: el repo va DEBAJO de las pestañas, misma caja.
Densidad de VS Code probada y **rechazada** ("quedó todo pegado").

## 2026-09-07 02:10 · Gero
`--font-ui`/`--font-mono` a 13px. Inter nunca estuvo empaquetada.
```

Autor y fecha por entrada salen de `authorDisplay` y `createdAt`, que `MemoryRecord` ya
tiene. No hace falta ninguna tabla de "dueño de la rama": el índice deriva eso de quién
escribió la última entrada.

`nest_ultima_sync` no es decorativo: es lo que evita que alguien lea contexto viejo
creyendo que es actual (§8.2).

### 4.3 El índice tiene presupuesto

Claude Code carga **las primeras 200 líneas / 25 KB** del índice de memoria en cada sesión
y lee los archivos de tema on-demand. Lo inyectado ocupa contexto en *todos* los turnos,
se use o no.

`_index.md` se diseña contra ese techo desde el día uno: una línea por rama (nombre,
estado, último autor, cuándo), nunca contenido. Si un proyecto supera el techo, se recorta
por recencia y el índice lo dice explícitamente en su última línea.

## 5. Arquitectura — por qué un módulo nuevo

Se evaluaron tres caminos:

- **A** — extender `vault-plan.ts` con una config `onlyTeam` y llamarlo dos veces.
- **B** — módulo nuevo `team-thread-plan.ts` reusando las piezas de abajo. **Elegido.**
- **C** — un solo pase que emite las dos raíces.

**Se descartó A** porque `vault-plan.ts` es, por decisión de producto, el módulo que
**excluye** el scope `team`. Un bug de config ahí filtra notas de compañeros al vault
personal, que es el peor bug posible de esta feature. En B **la separación la garantiza la
estructura y no un booleano**.

**Se descartó C** porque acopla la cadencia del vault personal (que puede estar apagado)
con la del equipo, y hace que un solo manifest mezcle dos ciclos de vida.

### 5.1 Módulos

| Módulo | Qué hace | fs |
|---|---|---|
| `electron/integrations/team-thread-plan.ts` | **Nuevo, puro.** Agrupa filas `team` por rama, compone las entradas y emite un `VaultPlan` | no |
| `electron/integrations/team-thread-graph.ts` | **Nuevo, puro.** Notas → nodos + aristas + coordenadas | no |
| `electron/integrations/vault-apply.ts` | Reusado. Se parametriza dónde deja manifest/tombstones/README | sí |
| `electron/integrations/vault-note.ts` | Reusado tal cual (frontmatter, `vaultContentHash`, `scrubSourceRef`) | no |
| `electron/integrations/vault-naming.ts` | Reusado tal cual (slugs seguros en los 3 SOs) | no |
| `electron/memory-redaction.ts` | Reusado, pero corre **antes** de promover (§6.3) | no |
| `src/components/TeamThreadGraph.tsx` | **Nuevo.** SVG a mano, sin dependencias | — |

El único cambio a un módulo existente es parametrizar las tres rutas hardcodeadas de
`vault-apply.ts` (`.nest-vault/manifest.json`, `.nest-vault/tombstones.jsonl`,
`README.md`), con los valores actuales como default. Backwards-compatible.

## 6. De dónde sale el contenido

### 6.1 Qué entra

Sólo filas de scope `team` de ese proyecto, y por default sólo dos tipos: `handoff` y
`decision`. Todo lo demás sigue naciendo `personal` y no aparece nunca. El toggle por
proyecto **amplía** esa lista de tipos; no la reemplaza.

### 6.2 El único cambio en la ruta de captura

Hoy `handoff:write` guarda además una observación `type:'handoff'` que **nace
`personal`**. Con el hilo compartido activado para ese proyecto, esa fila nace `team`.

Ahí termina el trabajo de cañería: el push (debounce 3s / max-wait 30s), el pull
autorizado fila por fila y la resolución LWW ya existen desde Layer 1. El toggle se cuelga
de `memory:shareProjectWithTeam`, que el preload ya expone.

### 6.3 La redacción corre ANTES de promover

En el vault personal, un secreto que se filtra te lo filtrás a vos mismo. Acá se le filtra
a un compañero, y esa asimetría cambia dónde va el gate.

`memory-redaction.ts` corre en el momento de la promoción a `team`. **Una fila que dispara
warning de `possible-secret` no se promueve sola**: queda pendiente de confirmación
humana.

Evidencia de que esto no es paranoia: Amp tuvo que **eliminar los threads públicos en
junio 2026** porque exponían fragmentos de archivos sensibles; mem0 tuvo una auditoría de
producción donde **el 97,8% de 10.134 entradas era basura**; Augment reconoció
públicamente el *"frustrating lack of control"* antes de agregar revisión humana. Los tres
apuntan a lo mismo: captura automática sin curación ni control de visibilidad se degrada y
filtra.

### 6.4 Las entradas se agregan, la nota no se reescribe

El fundador de Markbase abandonó markdown como formato de memoria justamente por *"merge
conflicts in the text"*. Letta ya resolvió el mismo problema: hizo su `memory_insert`
**aditivo** en vez de reemplazo, y documenta que el reemplazo simultáneo pierde updates.

En nuestro caso el archivo es derivado y nunca entra a git, así que el conflicto real no
es de archivo sino de fila — y ahí manda el LWW de Layer 1. Pero la nota se **compone por
append**, de modo que dos personas escribiendo en la misma rama el mismo día conservan sus
dos entradas.

**Precisión, porque §4.2 podría leerse al revés:** lo aditivo es el **cuerpo** (las
entradas nunca se reescriben ni se reordenan). El **frontmatter sí se regenera** en cada
pasada, porque `nest_estado` y `nest_ultima_sync` son datos vivos que cambian sin que
nadie escriba una entrada nueva. El hash-compare mira el archivo entero, así que un cambio
de estado de rama reescribe la nota aunque no haya contenido nuevo — es correcto y es
barato.

### 6.5 Checkpoints por turno

Hoy el rollup corre sólo en `Stop`/`PreCompact`: la sesión que se corta antes de cerrarse
no deja relato (agujero 1 de durabilidad).

El spike de opencode midió que `session.idle` **dispara por turno**. Eso, que parecía un
problema para el mapeo 1:1 de sesiones, es el gancho para ir dejando checkpoints. El
rollup es parsing y reusa el `ai-title` que la CLI ya generó, así que no agrega llamadas a
ningún modelo.

**Cuidado documentado del spike**: `hook.stop` también llama a `closeSession()`. Colgarlo
de `idle` cerraría la sesión en el primer turno. El checkpoint es un camino distinto del
cierre, no el mismo con otro trigger.

## 7. El grafo

### 7.1 Qué dibuja

`team-thread-graph.ts` toma **las mismas notas que se escribieron en disco** y devuelve
nodos y aristas: `_index.md` al centro, una nota por rama alrededor, `general.md` como una
más; las aristas son los `[[wikilinks]]` que ya están en las notas. Sin fuente de datos
nueva ni estado paralelo: si el disco y el grafo discrepan, hay un solo origen posible.

### 7.2 Color por estado y frescura — el punto entero

La crítica más fuerte al grafo de Obsidian, incluso de quienes lo defienden, es que *"no
muestra estado, ni prioridad, ni qué está obsoleto"*. Nosotros sí lo sabemos:

- **Estado de la rama**: `activa` (existe y hay worktree abierto) · `sin-worktree` (existe
  pero nadie la tiene abierta) · `cerrada` (borrada o mergeada). **Lo consulta a git el
  planner y lo escribe en `nest_estado`; el grafo lo lee del frontmatter, nunca de git.**
  Así el grafo mantiene una sola fuente (§7.1) y no puede discrepar del archivo.
- **Frescura**: tiempo desde la última entrada. Lo de hoy brilla; lo de la semana pasada
  se apaga; lo que nadie tocó en un mes queda marcado.
- **Autor**: el de la última entrada, como subtítulo del nodo.

Un grafo donde la rama de un compañero de anteayer late y la propia de hace tres semanas
está gris contesta "¿en qué anda el equipo?" de un vistazo.

### 7.3 Local por default, global bajo demanda, con techo

Críticos y defensores coinciden en que el grafo local (un nodo y sus vecinos) rinde mucho
más que el global. Y la evidencia sobre escala es unánime: <50 nodos rinde, **>200 es una
bola de pelo**.

- Default: centrado en la rama del worktree actual.
- Global: un botón.
- **Arriba de 200 nodos el filtro por recencia se activa solo**, y la UI dice que está
  filtrando.

### 7.4 Layout determinístico, sin dependencias

No hay ninguna librería de grafos en `package.json` y no se agrega una. Radial por
anillos: foco al centro, vecinos en el primer anillo ordenados por recencia, el resto en
el segundo. SVG a mano.

Tres beneficios que no son estéticos: funciona offline, no suma superficie de supply
chain, y el layout es **una función pura que devuelve coordenadas**, o sea que se testea
con vectores fijos en vez de snapshots de píxeles.

### 7.5 Click abre la nota

El grafo navega; la nota cuenta. La nota se abre en el editor que Nest ya tiene. Con eso
hay un panel, no dos.

### 7.6 Lo que el grafo NO es — dejado escrito a propósito

**No es la vía de onboarding ni el modo principal de ponerse al día.** Para eso está la
nota. La defensora pública de la graph view de Obsidian dice que ella no la usa para
navegar y que **compartir un grafo con otra persona *"is not navigable"*** — que es
textualmente nuestro caso de uso. Lo nuestro rinde por color, no por topología, y nadie
debería venderlo distinto después.

## 8. Durabilidad y modos de falla

Cada modo de falla degrada; ninguno rompe. El hilo es derivado: si algo falla, se regenera
en la pasada siguiente.

### 8.1 Cadencias

Heredadas y ya medidas: la memoria se escribe en el instante en que ocurre; el push tiene
debounce 3 s / max-wait 30 s; las notas en disco, debounce 5 s + poll 60 s +
reconciliación al arranque, con hash-compare para no escribir si nada cambió. El pull ya
es periódico (intervalo + foco de ventana), así que **al compañero le llega sin pedirlo**.

El techo de cadencia no lo pone el costo sino el servidor: hay rate limit por device con
429 y `Retry-After`.

### 8.2 La tabla

| Falla | Qué pasa |
|---|---|
| Falla la escritura en disco | Warn y seguir, precedente de `handoff.ts`. Nunca tira hacia el IPC |
| Sin internet | Se captura local y se pushea después. **La nota lleva `nest_ultima_sync`**, para que nadie lea contexto viejo creyéndolo actual |
| El usuario editó el archivo a mano | Sus bytes se preservan en `_conflicts/` y el espejo se reescribe al lado (precedente del vault). El `README.md` lo avisa de entrada |
| Dos personas, misma rama, a la vez | La nota se compone por append; el LWW de Layer 1 decide a nivel de fila. Ninguna entrada se pierde |
| Fila con warning de secreto | No se promueve sola; espera confirmación (§6.3) |
| No se puede escribir `.git/info/exclude` | Best-effort: se escribe el hilo igual. Que no se pueda excluir no puede impedir lo que el usuario pidió |
| Se apaga el toggle del proyecto | Deja de promover y borra la carpeta local (`reason: 'disabled-project'`, ya existe). **No des-promueve lo ya compartido** — eso es una acción explícita y aparte |
| Sacan a alguien del equipo | El pull autorizado fila por fila ya lo corta server-side; localmente se borra la carpeta |

### 8.3 `synchronous = FULL`

Hoy `memory-store.ts:502-503` deja el store en `journal_mode = WAL` + `synchronous =
NORMAL`. Eso aguanta que se caiga la app o el SO, pero **un corte de luz puede perder las
últimas transacciones**.

Sube a `FULL`. La base escribe poco y chico (observaciones de texto, no un log de alto
volumen), y con WAL el costo de `FULL` es muy inferior al de rollback-journal. Cierra el
agujero 3 de durabilidad.

## 9. Testing

Misma forma que el vault: el planner es puro y ahí vive el grueso de los tests; `apply`
toca fs y se prueba contra un directorio temporal.

Los cuatro que importan de verdad:

1. **El guardia de la separación** — el vault personal **nunca** contiene filas `team`. Es
   la regresión que justifica haber elegido el enfoque B en vez de un flag.
2. **Concurrencia** — dos autores, misma rama, mismo día: sobreviven las dos entradas.
3. **El gate de redacción** — una fila con pinta de secreto no se promueve sola.
4. **Vector fijo del layout** — entrada y salida exactas de la función de coordenadas.

Además, los de forma heredada del vault: agrupación por rama, notas sin rama a
`general.md`, `_conflicts/` cuando el hash en disco no coincide, borrado al apagar el
toggle, y el techo del índice.

## 10. Alcance de la v1

**Entra:**

- El hilo en disco (`.nest/team/`), regenerado solo, uno por worktree.
- El toggle por proyecto en la UI.
- El grafo con color por estado y frescura, local por default.
- `synchronous = FULL`.
- Checkpoints por turno.

**No entra:**

- Des-promoción masiva de lo ya compartido (existe como acción explícita, no como flujo).
- Búsqueda semántica sobre el hilo. La recuperación es léxica, igual que en OKF Agent
  Memory, que eligió BM25 y lo defiende. **Es una postura, no un hecho**: si la memoria de
  equipo crece a miles de entradas, hay que revisarla.
- Editar el hilo desde Nest y que vuelva al store. Sigue siendo one-way, igual que el
  vault.
- Leer `AGENTS.md` (ver §12).

## 11. Riesgos

1. **Basic Memory Teams llega primero.** Es el riesgo competitivo real y no es hipotético:
   tienen todo salvo el write-back automático, y lo anunciaron. Mitigación: nuestro
   diferencial no es el formato (que ellos ya tienen mejor pulido) sino la captura pasiva
   ya construida y la membresía con autorización fila por fila.
2. **El agente ignora el archivo.** Es el modo de falla universal de la categoría: Claude
   Code #19471, Codex #2927/#5093/#6502, Continue #6905 — y Codex además trunca a 32 KB
   sin avisar. Inyectar garantiza entrega, no obediencia. Mitigación parcial: índice corto
   (§4.3) y, donde el CLI lo permita, hooks.
3. **Volumen.** Si la captura pasiva genera mucho, generamos la próxima versión del mismo
   problema: un archivo tan grande que se ignora. El índice de una línea por rama es la
   mitigación, y no hay que abandonarla al escalar.
4. **El grafo decepciona.** Está mitigado por §7.6, pero el riesgo real es de expectativa,
   no técnico: si se vende como onboarding, decepciona al primer equipo que lo use en
   serio.

## 12. Pendientes que esto NO resuelve

- **`AGENTS.md`**: está bajo la Linux Foundation, lo usan +60k repos y lo soportan ~25
  herramientas (Zed llega a leer `.cursorrules`, `.windsurfrules`, `.clinerules` y
  `CLAUDE.md` como fallbacks). Si Nest no lo lee, queda afuera de un estándar de facto. No
  es parte de Layer 2, pero es un pendiente real y conviene que no se pierda.
- **El disparador para mover el dibujado al servidor**: hoy lo dibuja cada Nest, local,
  porque la mitad del contenido (ramas, worktrees, paths) sólo lo sabe la máquina y porque
  el formato no debe volverse deuda versionada server-side. **El día que el contexto del
  equipo tenga que verse sin Nest instalado —una web, alguien no técnico—, lo compone el
  servidor.** Esa es la condición, escrita de antemano.
