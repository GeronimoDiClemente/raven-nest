# Handoff — de la Mac a la PC (2026-08-28)

Nota de pickup para seguir desde la otra máquina. Todo lo que se hizo en la Mac ya
está en `origin/feat/integrations` @ `f174a89`. Desde la PC alcanza con `git pull`.

Los handoffs por área siguen valiendo y no se repiten acá:
`2026-08-22-graph-live-smoke-handoff.md` (el graph, con los tres blockers),
`docs/MEMORY_INTEGRATIONS_CONTRACT.md` (lo de Bauti), y `SMOKE-SETUP.md` en la rama
`smoke/memory-bridge` (el entorno del smoke de memoria, escrito desde Windows).

---

## 1. Dónde quedó cada rama

| Rama | Commit | Estado |
|---|---|---|
| `feat/integrations` | `f174a89` | 230 commits sobre main. Suite **951 verdes**, 3 skipped |
| `feat/nest-memory-phase1` | `1f32f67` | De Bauti. Phase 1 completa. **No la tocamos y no la vamos a tocar** |
| `smoke/memory-bridge` | `a8fee1b` | Merge descartable de las dos + el adapter real. **No se mergea a ningún lado** |

Typecheck: 69 errores, todos preexistentes de la rama (`ImportMeta.env` sin los tipos
de Vite en `tsconfig.node.json`, más dos `OpenDialogOptions`). Ninguno en lo tocado.
Si te da un número distinto de 69, algo nuevo entró.

---

## 2. Qué se hizo en la Mac (4 commits)

| Commit | Qué |
|---|---|
| `744dcd7` | Launch headless de los nodos del graph — blockers **A** y **B** |
| `d93a06e` | Live smoke de ese launch contra la PTY real |
| `b37611b` | Decisiones humanas del gate en el board — blocker **C** |
| `f174a89` | Smoke in-app del eval-loop + el fix que destapó |

**Los tres blockers del graph están cerrados y verificados**, no sólo escritos:

- **A y B** — `electron/__tests__/graph-pty-launch.live.test.ts` (`GRAPH_PTY_SMOKE=1`).
  Un nodo coder real sale en exit 0 a los ~45 s, la pty cierra (`exists()` false → el
  nodo llega a `done`) y escribe su artefacto sin pedir un permiso. Más el mecanismo
  puro sin LLM: `exec sh -c 'exit N'` devuelve N para N ∈ {0, 3, 42}.
- **C** — `e2e/02-graph-in-app.spec.ts` (`GRAPH_APP_SMOKE=1`). La app de verdad,
  `review-only` en modo `gate`, dos reviewers `claude` reales, el gate frena, se
  aprueba desde el botón y el run se completa. **Verde en 56 s.**

---

## 3. Lo que NO viaja por git

Esto hay que rehacerlo en la PC; nada de esto está en el repo.

- **El worktree `memory-smoke`** — es local. En la PC ya tenías el tuyo en
  `C:\Users\gerod\Dev\raven-nest\.claude\worktrees\memory-smoke`; si sigue ahí, sigue
  sirviendo. `.claude/worktrees/` quedó gitignoreado en `744dcd7`.
- **`node_modules` y las builds nativas.** El truco de doble ABI de `better-sqlite3`
  es por máquina. En la Mac quedaron las dos builds guardadas al lado del binario
  (`better_sqlite3.node.electron130` y `.node141`) y se cambia copiando la que haga
  falta encima de `better_sqlite3.node`. **En Windows el ABI de Node no compila** (falta
  el componente Clang de Visual Studio) — es el §3 de `SMOKE-SETUP.md`.
- **`.env` / `.env.local`.** Gitignoreados. La rama de memoria suma
  `MAIN_VITE_SUPABASE_URL` (mismo valor que `VITE_SUPABASE_URL`) para el daemon de sync.
- **`~/Desktop/puente-y-orquesta.html`**, la página visual del estado. Vive como
  artifact: https://claude.ai/code/artifact/1aa0c1aa-1a80-4bdb-8de4-b0691f0e17bd

**No corras `npm run postinstall` tal cual**: pasa `-w` dos veces y revienta con
`argv.w.split is not a function`. Usá `npx electron-rebuild -f -o node-pty,better-sqlite3`.

---

## 4. La cola, en orden

### 1. Smokear codex — **esto se hace en la PC, no en la Mac**

El único ítem que está bloqueado por la máquina y no por el código. Los flags headless
de codex en `graph-tick.ts` son **best-guess sin verificar**:

```
exec codex exec --dangerously-bypass-approvals-and-sandbox "$(cat '<prompt>')"
```

En la Mac el paquete global está roto (`@openai/codex-darwin-arm64/vendor/.../codex`
ENOENT — ni `codex --version` arranca), así que no se pudo probar. En la PC codex
está en PATH y verificado. **Importa**: el coder del template `full` corre con codex,
o sea el nodo que más decisiones toma del pipeline por defecto.

Cómo: `GRAPH_APP_SMOKE=1` con un template que use codex, o a mano el comando de arriba
en un worktree tirable. Si los flags están mal, se arregla el `HEADLESS` spec en
`electron/integrations/graph-tick.ts` y sus 7 unit tests.

### 2. Los tres bugs abiertos del merge

Los cuatro están en el §3 de `MEMORY_INTEGRATIONS_CONTRACT.md`. El 3.3 no es un bug
nuestro (es la Phase 2 de Bauti llegando antes). Los otros tres sí:

- **3.1** `pty-manager.ts:185` — `cmd === 'claude'` es comparación exacta, así que un
  nodo con modelo asignado arranca **sin el flag de memoria, en silencio**. Los nodos
  sin modelo sí andan, lo que lo hace peor: falla de a ratos. Fix: comparar contra
  `cmd.split(' ')[0]` e insertar el flag en vez de reconstruir el comando.
- **3.2** `pty-manager.ts:133` — con `accountDir` vacío se saltea el bloque entero de
  inyección de memoria. En integrations `accountDirForAgent()` devuelve `''` cuando el
  agente no tiene cuenta guardada → un nodo headless con el HOME real queda afuera.
- **3.4** `useMemory.ts:32,51` — acceden a `window.memory` sin guard y tumban Settings
  entero. **El fix correcto es el optional chaining, no mockear la API en el test**: un
  hook de renderer no puede asumir que una API del preload existe. `main.ts` ya trata la
  memoria como algo que puede fallar y degradar; el hook es la única pieza que no.

### 3. El smoke del puente de memoria

El entorno ya está listo en las dos máquinas. Falta correrlo: conectar Nest Memory en
Settings, aprobar un gate y ver subir el contador de items. Ojo con el §6 de
`SMOKE-SETUP.md` — `RAVEN_HOME` descartable y `--user-data-dir` propio, porque el lock
de instancia única de Electron choca con el Nest que hospeda la sesión.

### 4. El vault markdown

Specado entero en `2026-08-26-memory-vault-design.md`, sin construir. One-way: el store
manda, los `.md` son espejo.

### 5. La vista de grafo propia

Condicional, recién después de medir si la gente abre el vault con Obsidian.

---

## 5. Trampas anotadas

Cosas que ya costaron una corrida cada una. No las vuelvas a pagar.

**El estado de un gate no se lee, se deriva.** Un gate retenido para decisión humana
**no escribe nada en `run.nodes`**: `planTick` lo mete en `heldGates` → `plan.blockedOn`,
y `main.ts` sólo persiste `plan.run`, así que `blockedOn` muere en cada tick y nunca
llega al renderer. Un gate sólo pasa de `queued` a `done` (lo aplica `applyDecision` o
el modo `auto`) o a `skipped`: **jamás vale `blocked` ni `needs_input`**. Hay que
derivarlo de los upstream, como hace `gateState()` en `graph-runner.ts`. Eso es
`src/lib/graph-decision.ts`. La primera versión leía el estado del gate, tenía 5 tests
en verde y estaba **muerta en la app** — los fixtures estaban hechos contra un contrato
asumido en vez de leído. Lo agarró el smoke in-app, que es exactamente para eso.

**No afirmes lo que decide un LLM.** El smoke in-app afirmaba `.gb-node.done === 2`
después de los reviewers. Falló en una corrida perfectamente sana: los reviewers
reportaron un concern bloqueante y el verdict pass los dejó en `blocked`, no en `done`.
Las dos corridas son válidas y el gate frena igual. Afirmá el invariante que te importa
(que el gate quede esperando), no el camino.

**`keepRealHome` en el harness de e2e.** `RAVEN_HOME` aísla todo el storage de Nest,
pero las CLIs que Nest spawnea en una pty **heredan `HOME`** y buscan ahí sus
credenciales. Un `HOME` descartable las deja sin login y el smoke se cuelga en una
pantalla de auth. Sólo lo usan los smokes que corren agentes de verdad.

**Los tests de preload no existían y hacían falta.** El blocker C era «handler vivo,
bridge mudo»: `graph:gate:approve` andaba en main desde hacía commits, pero `preload.ts`
no lo exponía. Ningún test de UI ni de main lo agarra, porque cada lado está bien por
separado. Por eso ahora hay `electron/__tests__/preload-graph-runs.test.ts`.

---

## 6. Comandos

```bash
# Al día
git fetch --all --prune && git checkout feat/integrations && git pull

# Verificación normal
npm test                 # 951 verdes, 3 skipped
npx tsc -b               # 69 errores, todos preexistentes

# Smokes gateados (gastan tokens, necesitan claude autenticado en PATH)
GRAPH_PTY_SMOKE=1 npx vitest run electron/__tests__/graph-pty-launch.live.test.ts
GRAPH_LIVE_SMOKE=1 npx vitest run electron/__tests__/graph-eval-loop.live.test.ts
npm run pre-e2e && GRAPH_APP_SMOKE=1 npx playwright test e2e/02-graph-in-app.spec.ts

# El worktree del smoke de memoria (si no lo tenés en esta máquina)
git worktree add .claude/worktrees/memory-smoke smoke/memory-bridge
cd .claude/worktrees/memory-smoke
npm ci --ignore-scripts
npx electron-rebuild -f -o node-pty,better-sqlite3   # NO `npm run postinstall`
```

Recordá que `docs/superpowers/` está en `.gitignore`: cada spec y cada plan entra con
`git add -f`. Este archivo también.
