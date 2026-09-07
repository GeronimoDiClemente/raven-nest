# Adapter de memoria para opencode (MCP-only) — diseño

> Rama: `smoke/memory-bridge` (`.claude/worktrees/memory-smoke`)
> Fecha: 2026-09-07
> Continúa: Task 6 del plan `docs/superpowers/plans/2026-09-03-memoria-por-cuenta-multi-dispositivo.md`
> (Step 4 dejó el recon de opencode/qwen hecho, sin construir adapter). qwen ya se construyó
> por separado (commit `b35dfd7`) siguiendo el mismo patrón que gemini — ese no necesitó
> spec propio porque no tenía piezas nuevas. Este sí las tiene.

## 1. Qué es

Cablea `opencode` a Nest Memory para que tenga acceso a los mismos tools MCP
(`memory_search`, `memory_promote`, etc.) que ya tienen Claude/Gemini/Codex/qwen — mismo
server (`electron/memory-mcp/index.ts`), cero código nuevo del lado del shim, un cuarto
(quinto, contando qwen) cliente.

**Alcance de este spec — sólo MCP.** opencode también tiene un sistema de hooks (un plugin
JS que corre embebido en su propio proceso, no un subcomando por stdin/stdout como
Claude/Gemini/qwen), pero mapear sus eventos (`session.created`, `session.idle`,
`experimental.session.compacting`) a nuestro `SessionStart`/`Stop`/`PreCompact` nunca se
probó en vivo — no se sabe si `session.created` dispara una sola vez por sesión real o
también por subagentes. Decisión explícita (Gero, 2026-09-07): esa pieza queda para una
segunda entrega, con su propio spec, después de un smoke que lo confirme. Este documento
no la cubre.

## 2. Por qué opencode es distinto a gemini/qwen

Los tres research previos (Task 6 Step 4 + esta sesión) encontraron:

- **Aislación por cuenta: igual de barata que qwen.** `USERPROFILE`/`HOME` aíslan a
  opencode entero (confirmado sobreescribiendo la variable) y `pty-manager.ts` ya
  redirige ambas a `accountDir` para todo pane de IA — sin env var extra tipo
  `GEMINI_CLI_HOME`.
- **El archivo de config es `.jsonc`, no `.json`.** `os.homedir()/.config/opencode/opencode.jsonc`
  (confirmado leyendo el binario instalado) admite comentarios. `.claude.json` y
  `.gemini/.../settings.json` son JSON plano — el `JSON.parse`→mutar→`JSON.stringify` que
  usan `memory-provisioner.ts` y `memory-provisioner-gemini.ts` los deja intactos, pero
  sobre un `.jsonc` con comentarios los borraría la primera vez que se provisione encima.
- **La forma del entry MCP es distinta.** `Config.mcp` (confirmado en
  `@opencode-ai/sdk`'s `types.gen.d.ts`) es `{ [name]: { type: "local", command: string[],
  environment?: Record<string,string> } }` — un solo array `command` (binario + args
  juntos) y la clave `environment`, no `mcpServers.<name> = {command, args, env}` como
  gemini/qwen/claude.

## 3. Decisión: `jsonc-parser` como dependencia nueva

Confirmado (Gero, 2026-09-07): agregar `jsonc-parser` (paquete de Microsoft/VS Code, cero
dependencias, la librería de referencia para este problema exacto) en vez de aceptar perder
comentarios con un `JSON.parse`/`stringify` ingenuo. Se usa su API basada en texto, no en
objetos:

```ts
import { modify, applyEdits, parse } from 'jsonc-parser'

const edits = modify(rawText, ['mcp', 'nest_memory'], value, {
  formattingOptions: { insertSpaces: true, tabSize: 2 },
})
const newText = applyEdits(rawText, edits)
```

`modify()` opera sobre el **texto crudo** y devuelve una lista de edits que preservan
comentarios y formato fuera del path tocado — nunca reconstruye el documento entero. Esto
es una diferencia real de forma respecto a `writeJson()` (que si serializa el objeto
completo) y es la razón por la que este módulo no puede reusar `readJsonOrThrow`/`writeJson`
de `memory-provisioner.ts` tal cual — sólo reusa `writeFileAtomic` para el paso final de
escritura (con el texto ya editado, no con `JSON.stringify`).

Para lectura (¿ya está provisionado?, ¿hay que abortar por corrupción?) se usa `parse(text,
errors, { allowTrailingComma: true })` de la misma librería — tolera comentarios y comas
finales (JSONC válido) pero deja algo en `errors` si el archivo está genuinamente roto.

## 4. Componentes

### 4.1 `electron/memory-provisioner-opencode.ts` (nuevo)

```ts
export function provisionOpencodeAccount(
  accountDir: string,
  paths: ProvisionerPaths,
  isWin: boolean,
): { args?: string[]; env?: Record<string, string> }

export function deprovisionOpencodeAccount(accountDir: string): void

export function isOpencodeAccountProvisioned(accountDir: string): boolean
```

- `provision()`: lee el texto crudo de `{accountDir}/.config/opencode/opencode.jsonc`
  (`'{}'` si no existe). **Nota post-implementación (review final, 2026-09-07):** el miedo
  original de este párrafo — que `modify()` de jsonc-parser no manejara texto vacío — resultó
  infundado, verificado empíricamente: `modify('', ...)` funciona perfecto. La implementación
  real terminó siendo *más* estricta que este miedo: un archivo vacío/sólo-espacios pasaba por
  el chequeo de corrupción y `provision()` tiraba (bug real, corregido en el fix wave de la
  review final). La lección para el próximo adapter JSONC: no asumir el comportamiento de una
  librería de terceros en el spec — un `node -e` de 10 segundos lo confirma o lo refuta.
  Calcula el edit para `['mcp', 'nest_memory']` con
  `{ type: 'local', command: [paths.execPath, paths.shimPath], environment: { ELECTRON_RUN_AS_NODE: '1' } }`,
  aplica el edit y escribe atómico. Devuelve `{}` — sin flags de CLI ni env extra, opencode
  lee su propio `mcp` de config al arrancar, igual que gemini/qwen no necesitan nada
  adicional para su MCP.
- `deprovision()`: mismo camino pero con `value: undefined` en el path `['mcp',
  'nest_memory']` — jsonc-parser's `modify()` con `undefined` genera el edit de borrado.
  Nunca borra el archivo ni la carpeta `.config/opencode/` — no es exclusiva de Nest, es la
  config real de opencode para esa cuenta (mismo principio que gemini/qwen/claude ya
  aplican a sus respectivos archivos).
- **Error handling**: si el archivo existe pero `parse()` reporta errores reales (no sólo
  la sintaxis JSONC estándar que la propia librería tolera), la función lanza en vez de
  sobreescribir con un documento vacío — mismo criterio y misma razón que
  `readJsonOrThrow` documenta para `.claude.json` (M11: el próximo `PtyManager.create()`
  reintenta el provisioning, así que abortar este ciclo no cuesta nada más que un log).

### 4.2 `electron/memory-cli-adapters.ts`

Un `opencodeAdapter` más en `ADAPTERS`, mismo esqueleto que `qwenAdapter`:

```ts
const opencodeAdapter: AiMemoryAdapter = {
  aiType: 'opencode',
  binNames: ['opencode'],
  provision: (accountDir, paths, isWin) => provisionOpencodeAccount(accountDir, paths, isWin),
  deprovision: (accountDir) => deprovisionOpencodeAccount(accountDir),
}
```

### 4.3 `package.json`

Agrega `jsonc-parser` a `dependencies` (no `devDependencies` — corre en producción, dentro
del proceso principal de Electron).

## 5. Flujo de datos

`PtyManager.create()` lanza `opencode` → `adapterForBin('opencode')` matchea →
`ensureProvisioned` corre `provisionOpencodeAccount` **antes** de que el proceso arranque →
opencode lee su `opencode.jsonc` al iniciar → conecta al server `mcp.nest_memory` (spawnea
`execPath shimPath` con `ELECTRON_RUN_AS_NODE=1`) → mismo `memory-mcp/index.ts` que ya
sirve a los demás clientes, en modo tool (`memory_search`/`memory_promote`/etc. — el modo
`runHook()` del shim no se usa en esta entrega, ver §1).

## 6. Testing

`electron/__tests__/memory-provisioner-opencode.test.ts`, calco de la suite de
`memory-provisioner-qwen.test.ts` con un test adicional que no existía en ningún
provisioner anterior:

- Escribe `mcp.nest_memory` con la forma correcta (`type`, `command` como array de 2
  elementos, `environment`).
- Idempotente — provisionar dos veces no duplica la entrada.
- Preserva otras claves de `mcp` y del documento.
- **Preserva un comentario `//` real** — siembra un `opencode.jsonc` con un comentario de
  línea, provisiona, y verifica que la substring del comentario sigue presente en el texto
  crudo del archivo después. Repite la misma verificación después de `deprovision()`. Esta
  es la prueba concreta de que `jsonc-parser` cumple la razón por la que se eligió sobre
  `JSON.parse`/`stringify`.
- Deprovision quirúrgico: sólo borra `mcp.nest_memory`, dejando otros servers MCP y el
  resto del documento intacto.
- Deprovision es no-op sin throw cuando nunca se provisionó.
- `isOpencodeAccountProvisioned` refleja el estado en las tres situaciones (nunca
  provisionado, provisionado, deprovisionado).
- Registrado en el adapter registry por `aiType` y por bin name.
- `adapter.provision()` no devuelve `args` ni `env`.
- Manejo de corrupción: un `opencode.jsonc` con JSON genuinamente roto (no JSONC válido)
  hace que `provision()` lance, sin sobreescribir el archivo.

## 7. Fuera de alcance (explícito)

- El plugin de hooks (`~/.config/opencode/plugins/*.js`, auto-cargado, sin tocar
  `opencode.jsonc`) para `SessionStart`/`Stop`/`PreCompact` — ver §1. Cuando se retome,
  hace falta primero un smoke en vivo confirmando la cardinalidad de `session.created`/
  `session.idle` (¿una vez por sesión real, o también por subagentes?) antes de diseñar el
  mapeo.
- `copilot` (sin instalar) y `cursor`/`grok`/`deepseek` (sin instalar, sin cambios desde el
  Step 4 original) siguen fuera de este plan.
