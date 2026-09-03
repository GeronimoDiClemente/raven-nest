# La memoria es de una cuenta de Nest — Implementation Plan

**Goal:** que cada cuenta de Nest tenga **sus** memorias, **sus** handoffs y **sus** proyectos, y que
se pueda retomar el trabajo desde cualquier dispositivo con el contexto de la IA — sin importar con
qué IA se generó.

**Es bloqueante de release.** No sale a la venta sin esto: se está vendiendo "tu memoria en todas
tus máquinas" y hoy ni es por cuenta ni viaja el contexto. Entra en la lista del §12 de
`docs/nest-memory-architecture.md` ("qué tiene que ser verdad para abrir a usuarios"), junto a los
cuatro que ya están ahí.

**Spec relacionada:** `docs/superpowers/specs/2026-08-26-memory-vault-design.md` (el vault markdown,
que es la pieza "estilo Obsidian" de la Task 5).

---

## Lo que ya es verdad (verificado el 2026-09-03, no asumido)

Vale empezar por acá porque es más de lo que parece y evita rehacer cosas.

- **La memoria NO está partida por IA, y nunca lo estuvo.** `origin_ai` es sólo procedencia: se
  guarda, se devuelve en el summary y **no aparece en un solo `WHERE`**. El hook de `SessionStart`
  sirve `store.context(projectKey, 5)`, filtrado por proyecto y nada más. Una memoria escrita por
  claude ya se le serviría a codex el día que codex pueda pedirla.
- **El store, el `project_key`, el modelo de sync y la cuota son agnósticos de la IA.** Ninguno sabe
  quién escribió.
- **La nube ya está particionada por cuenta**: la tenencia del servicio es por `users.id`, y
  `authenticate` la resuelve desde el token del device.
- **El autor ya se sella y el push ya está acotado** (commit `33b691c`): `setCurrentUser()` declara
  la cuenta activa, `pendingMutations()` sólo devuelve lo de esa cuenta, y la primera cuenta que
  entra reclama el store y adopta las filas huérfanas. Eso cerró la fuga grave — que el daemon de
  una segunda cuenta empujara a su nube las memorias de la primera.

## Lo que NO es verdad todavía

- **El store es uno por máquina**: `{home}/.raven-nest/memory/memory.db`. `ravenHome()` no sabe
  quién está logueado. Dos cuentas en la misma máquina leen la misma base — el sellado impide que se
  mezclen *en la nube*, no que se vean *en local*.
- **Sólo las observaciones se replican.** `appendMutation` se llama únicamente desde las escrituras
  de `observations`. `sessions`, `session_prompts`, `promotion_queue`, `import_runs` y `projects`
  son locales y no salen de la máquina. O sea: **el contexto de sesión no viaja**, que es
  literalmente la promesa de "retomar desde otro dispositivo".
- **Los handoffs no están en la memoria.** `handoff.md` se escribe en `{worktree}/.nest/handoff.md`
  — un archivo dentro del worktree. La otra máquina tiene otro worktree, así que no lo ve. (Que
  además ensuciaba el `git status` del repo del usuario se arregló en la Task 4.)
- **Sólo claude captura.** Las demás CLIs reciben el env (`NEST_MEMORY_SOCKET`, `TOKEN`, `AI`,
  `ACCOUNT`) porque `pty-manager` lo inyecta para todas a propósito, pero no tienen con qué usarlo:
  el provisioner es claude-only.

---

## Global Constraints

- **Local-first no se negocia.** La memoria local funciona sin login y sin nube; nada de este plan
  puede convertir el login en un requisito para capturar.
- **Fallar cerrado.** Ante la duda de a quién pertenece una fila, no se sincroniza. Ya es la regla
  del sellado y se mantiene.
- **Una sola fuente de la regla de tenencia.** El servidor la aplica en cada request; el cliente la
  respeta pero no la reimplementa.
- `npx tsc -b` es el typecheck real y emite al lado de los fuentes: `git add` de lo nuevo **antes**
  del `git clean -fd`.
- La barra es el código de salida, no el conteo de tests.

---

### Task 1: Una base por cuenta

**Files:** `electron/main.ts` (dónde se abre el store), `electron/memory-store.ts` (la migración de
adopción), test nuevo.

El store pasa a `{home}/.raven-nest/memory/<userId>/memory.db`. El problema real no es el path: es
**cuándo se sabe el userId**. Hoy el store se abre al arrancar la app, antes de que exista sesión, y
tiene que seguir funcionando así (local-first).

La forma que resuelve las dos cosas: **una base "sin cuenta" que se adopta**. Se arranca contra
`{home}/.raven-nest/memory/_local/memory.db`, y cuando el renderer declara la cuenta se decide:

- Si esa cuenta **no tiene** base propia todavía → la de `_local` **pasa a ser suya** (rename del
  directorio). Es el caso de todo el mundo hoy, y es lo mismo que ya hace el reclamo de `33b691c`.
- Si esa cuenta **ya tiene** base → se cierra `_local`, se abre la suya, y `_local` queda como está
  para la próxima vez que no haya sesión.

Un `close()` + `open()` en caliente con el daemon corriendo es la parte delicada: hay que parar el
daemon, cerrar, mover, abrir y volver a arrancarlo, y `memory-ipc-server` tiene que rechazar
escrituras mientras tanto en vez de escribir en un handle muerto.

- [ ] **Step 1:** Test que falla — dos cuentas en la misma máquina no se ven las memorias en local.
- [ ] **Step 2:** `resolveStorePath(ravenHome, userId | null)` puro, con sus tests.
- [ ] **Step 3:** El swap en caliente: parar daemon → cerrar → mover/abrir → arrancar.
- [ ] **Step 4:** Que el IPC server rechace durante el swap (y que el shim lo lea como "reintentá").
- [ ] **Step 5:** Suite entera + typecheck.

### Task 2: Qué pasa con lo capturado antes de loguearse

**Decisión de producto, no técnica** — va antes de escribir la Task 1.

Una persona usa Nest sin cuenta, captura memorias, después se loguea. La adopción de la Task 1 dice
"son tuyas". Es lo razonable en una máquina personal y es lo que ya hace `33b691c`. Pero en una
máquina compartida —una demo, una laptop de equipo— el segundo que se loguea se lleva lo del
primero, y eso es exactamente lo que este plan viene a impedir.

Opciones, para decidir:

1. **Adopción silenciosa** (lo de hoy). Cero fricción, riesgo en máquina compartida.
2. **Adopción con aviso**: al primer login se muestra "hay N memorias capturadas sin cuenta,
   ¿son tuyas?". Fricción de un click, cierra el caso compartido.
3. **Nunca adoptar**: lo de `_local` se queda ahí y sólo se ve sin sesión. Lo más seguro y lo más
   confuso: el usuario capturó cosas que "desaparecen" al loguearse.

**DECIDIDO (Gero, 2026-09-03): la 2 — adopción con aviso.**

- [x] **Step 1:** ~~Que Gero elija.~~ Adopción con aviso.
- [ ] **Step 2:** El diálogo al primer login cuando hay memorias sin cuenta: cuántas son, de qué
      proyectos, y dos salidas — "son mías" (adopta) y "no" (quedan en `_local`, invisibles para esta
      cuenta). Copy en inglés, como toda la UI.
- [ ] **Step 3:** Que "no" sea recuperable: si más tarde entra la cuenta dueña, adopta. Lo que no
      puede pasar es que un "no" borre nada.

### Task 3: El contexto de sesión viaja

**Files:** `electron/memory-store.ts`, `electron/memory-daemon.ts`, `server/src/push.ts`,
`server/src/pull.ts`, `server/migrations/00X_sessions.sql`.

Hoy `sessions` y `session_prompts` se escriben y **mueren en la máquina**. Sin ellos, "retomar desde
otro dispositivo" es retomar las conclusiones (las observaciones) pero no el hilo.

Antes de construir hay que contestar una pregunta que la spec no tiene: **¿qué es "el contexto"?**
El transcript entero de una sesión es caro, sensible y casi siempre inútil; el resumen es lo que
sirve. La respuesta más barata y probablemente correcta es que **el rollup de sesión ya es una
observación** y por lo tanto ya replica — y que lo que falta no es replicar `sessions`, sino que el
`Stop` hook efectivamente escriba ese rollup, que hoy **no escribe nada** (es la Layer B que el plan
de cliente C1-C8 dejó anotada como la deuda más grande del subsistema).

**DECIDIDO (Gero, 2026-09-03): el rollup.** No se replican `sessions`: se cierra Layer B y el
resumen de sesión pasa a ser una observación como cualquier otra, con lo cual replica sola y no toca
el schema del servicio.

Esto convierte la Task 3 en **cerrar Layer B**, que es la deuda que el plan de cliente C1-C8 dejó
anotada como la más grande del subsistema: hoy `SessionStart` sólo lee, **`Stop` no escribe nada** y
`PreCompact` deja un placeholder que nadie resuelve.

- [x] **Step 1:** ~~Decidir.~~ El rollup.
- [ ] **Step 2:** Que `Stop` escriba el rollup de la sesión como observación. La pregunta abierta es
      **quién resume**: el propio agente antes de cerrar (barato, y ya tiene el contexto) o una
      pasada aparte (cara, y necesita el transcript). Va la primera salvo que falle en la prueba.
- [ ] **Step 3:** `PreCompact` resuelve su placeholder por el mismo camino.
- [ ] **Step 4:** Smoke real: sesión con trabajo de verdad, cerrarla, y que el resumen aparezca en la
      otra máquina.

### Task 4: Los handoffs dejan de ser un archivo del worktree

**Files:** `electron/integrations/handoff.ts`.

`{worktree}/.nest/handoff.md` no viaja, y además ensucia el repo **del usuario**: `writeHandoff`
escribe dentro de su worktree y nada lo excluye. Ojo que el arreglo **no** es el `.gitignore` de
este repo —el archivo cae en repos ajenos— sino `.git/info/exclude`, que es por clon y no se
commitea. Dos cosas separadas:

- [x] **Step 1:** Excluir `.nest/` vía `.git/info/exclude` al escribir el handoff. Hecho — era de
      una línea y no tenía por qué esperar al resto del plan.
- [ ] **Step 2:** Que el handoff se guarde **además** como observación (`type: 'handoff'`, project
      key del repo). Con eso replica solo, se busca solo y aparece en el vault. El archivo se
      mantiene como espejo local, porque es lo que el agente lee al arrancar.
- [ ] **Step 3:** Al abrir un worktree sin `handoff.md`, reconstruirlo desde la memoria si hay uno
      más nuevo en la nube. Esto es lo que hace que "retomar en la otra máquina" se sienta.

### Task 5: El vault, para eficientizar contextos

Ya specado entero en `2026-08-26-memory-vault-design.md`, sin construir. Lo que este plan agrega es
**dónde vive**: una carpeta por cuenta, espejo del store de esa cuenta, no una global.

El puente ya escribe `[[run-<runId>]]` dentro del contenido, así que las aristas existen desde el
día uno. Con el vault, cualquiera abre la carpeta con Obsidian y tiene la vista de grafo gratis — y
es la prueba verificable de la promesa de portabilidad.

- [ ] **Step 1:** Ejecutar la spec del vault, con el path por cuenta.

### Task 6: El cableado por CLI

Lo único que falta para que la memoria sea de verdad agnóstica. Relevado el 2026-09-03 en esta
máquina, no de memoria:

| CLI | MCP | Hooks | Cuenta propia | Nota |
|---|---|---|---|---|
| claude | sí (`.claude.json`) | sí (`--settings`) | sí | Es lo único provisionado hoy |
| **gemini** | **sí** (`gemini mcp add/list/remove`) | **sí** (`gemini hooks`, con un `hooks migrate` que importa los de Claude Code) | sí | **El más barato de los que faltan** |
| **codex** | sí | a verificar | sí | El que más importa: el coder del template `full` corre con codex |
| opencode | sí (`opencode mcp`) | a verificar | no (`noAccount`) | Corre con el HOME real → ya cae en el dir `__headless__` |
| copilot | a verificar | a verificar | vía `gh` | La extensión ni siquiera está instalada acá |
| cursor / qwen / grok / deepseek | a verificar | a verificar | no | Ninguno instalado en esta máquina |

- [ ] **Step 1:** Generalizar el provisioner de claude-only a un registro por `aiType`.
- [ ] **Step 2:** gemini (el más barato, y su `hooks migrate` puede ahorrarnos el diseño).
- [ ] **Step 3:** codex (el que más vale). El smoke va en la PC: en esta Mac el paquete global está
      roto (`vendor/.../codex` ENOENT, ni `--version` arranca).
- [ ] **Step 4:** Verificar los demás uno por uno antes de prometerlos.

### Task 7: El hub in-app — que todo usuario vea para qué sirve

**Files:** `src/tutorial/` (registry + un tour nuevo), la card de memoria de `SettingsPanel.tsx`, y
un componente de hub nuevo.

Pedido de Gero: al salir la release, **todo usuario** tiene que ver el fuerte del producto y el
mayor sanante de dolores — no un tutorial opcional escondido en un menú que sólo abre el curioso.

Tres cosas que definen el diseño:

- **No es un tour más.** El framework de tours ya existe (`src/tutorial/registry.ts`, con tours de
  worktrees, my-repos y teams) y sirve para el paso a paso, pero se lanza a pedido. El hub va en el
  primer arranque y lo ve todo el mundo, incluido Free.
- **Muestra el dolor con los datos del propio usuario.** Ahora que el import trae de verdad
  (`2f04e74`: 80 chunks contra datos reales, antes 17), el hub puede abrir con "importamos N
  memorias de M proyectos tuyos" en vez de una promesa abstracta. Ese es el momento en que se
  entiende: la IA deja de arrancar de cero.
- **Y recién ahí, qué agrega Cloud.** Ojo: **el plan pago se llama `Cloud`, no `Pro`** — el rename
  entró hoy en la Task 1 del corte comercial. Un hub que diga "Pro" nace desactualizado. Lo que
  agrega Cloud es una sola cosa y hay que decirla así: **tu memoria en todas tus máquinas**. Lo
  local es gratis y completo, que es justamente el argumento.
- **Copy en inglés**, como toda la UI de la app.

- [ ] **Step 1:** Definir el guion: qué dolor, en qué orden, y en cuántas pantallas. Tres como
      máximo.
- [ ] **Step 2:** El hub, con el conteo real del import.
- [ ] **Step 3:** Que aparezca una sola vez y se pueda volver a abrir desde Settings.
- [ ] **Step 4:** La pantalla de Cloud, leyendo el precio de `CLOUD_MONTHLY_PRICE` y no de un
      literal.

---

## Lo que este plan NO hace

- **No sincroniza la configuración ni las credenciales de las CLIs.** Viven en el HOME redirigido
  (`~/.raven-nest/accounts/<ai>/<name>`) y no sale nada de ahí. Es otro producto y otra categoría de
  riesgo: las memorias pasan por redacción, un token de sesión no. Se decide aparte.
- **No cierra §9.2 ni §9.3** — ya están hechos (`8634e1d`, y el gate de plan es server-side).
- **No define el vault bidireccional.** Sigue siendo one-way: el store manda, los `.md` son espejo.
