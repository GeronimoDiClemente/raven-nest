# Import de configuración de editor (VS Code / IntelliJ) — Design Spec

**Fecha:** 2026-08-08
**Estado:** Aprobado para pasar a plan de implementación

## Contexto y objetivo

Nestmux ya tiene un editor de código embebido (Monaco, `EditorPane.tsx`, ver `docs/specs/2026-07-09-code-editor-integration-design.md`), pero hoy sin ninguna preferencia configurable: `<Editor path={activePath} value={...} onChange={...} theme="vs-dark" />` está hardcodeado, sin `tabSize`/`fontSize`/`wordWrap`/tema elegible. El objetivo de este cambio es que un usuario que usa VS Code (o IntelliJ) a diario todos los días pueda importar su configuración de edición existente, con un click, en vez de reconfigurar todo a mano dentro de Nestmux.

**Punto de partida técnico importante:** Monaco Editor **es** el motor de edición de VS Code (extraído de VS Code como proyecto separado por Microsoft) — no es una alternativa a él. Por eso el import de config de VS Code puede tener fidelidad real: es literalmente el mismo widget de texto, solo configurado distinto. El editor de IntelliJ, en cambio, corre sobre JVM/Swing — stack incompatible con Electron, sin SDK de embedding disponible. No hay forma de "usar el editor real de IntelliJ" dentro de Nestmux; el import de su configuración hacia Monaco es la única vía posible de acercamiento.

**Fuera de alcance de este spec** (ver "Decisiones de scope" más abajo): importar keybindings/atajos de teclado queda para un spec y plan de implementación separados, una vez que esta infraestructura de import ya esté probada. `formatOnSave`, reglas de linting, snippets y cualquier cosa atada a una extensión específica quedan explícitamente afuera — no hay LSP/formatter real en Nestmux hoy (mismo criterio que excluyó "real LSP/IntelliSense" del spec original del editor).

## Arquitectura

### Un IPC channel nuevo, separado del fs-bridge scoped

`electron/fs-bridge.ts` está deliberadamente sandboxeado al `repoPath` del pane activo (scoping por `realpath`, ver el fix de Task 2 en el spec original — protección contra path traversal). Leer la configuración de VS Code/IntelliJ es, a propósito, una lectura **fuera** de cualquier worktree — mezclarla en el fs-bridge scoped rompería esa garantía de seguridad.

Nuevo módulo main-process, `electron/ide-config-bridge.ts`, con su propio namespace IPC (`ide-config:detect`, `ide-config:import`):

- Conoce los paths estándar por SO:
  - VS Code: `%APPDATA%\Code\User\settings.json` (Windows), `~/.config/Code/User/settings.json` (Linux), `~/Library/Application Support/Code/User/settings.json` (Mac).
  - IntelliJ: busca bajo `~/.config/JetBrains/` (Linux/Mac vía XDG o `~/Library/Application Support/JetBrains/` en Mac, `%APPDATA%\JetBrains\` en Windows) todas las carpetas con patrón `IntelliJIdea*`, y toma la de fecha de modificación más reciente si hay varias instaladas.
- Solo **lee** — nunca escribe esos archivos. No hay sync bidireccional; es un import de una sola vía.
- Expone dos funciones de detección+parseo, una por IDE, cada una devolviendo un objeto de preferencias ya mapeadas a la forma que Monaco entiende (ver próxima sección) o un error tipado (`{ ok: false, error: string }`, mismo patrón que ya usa `bridge.fs.*`).

### Registro declarativo de mapeos (no una tabla hardcodeada)

En vez de un `if/else` gigante por campo, un array de entradas:

```ts
interface PreferenceMapping {
  key: string                    // nombre interno de la preferencia Nestmux
  vsCodeKey: string               // clave en settings.json (dot-path)
  intellijPath?: (root: string) => string | null  // función que ubica el XML/valor, si existe equivalente
  toMonacoOption: (value: unknown) => Partial<MonacoEditorOptions>
}
```

Agregar un campo nuevo el día de mañana es una entrada más en el array, no un rediseño. Vive en `src/lib/ide-config-mappings.ts` (compartido entre el parseo del main process y cualquier preview que necesite el renderer).

**Cobertura inicial — VS Code (amplia, ~20 campos):** `fontSize`, `fontFamily`, `fontWeight`, `fontLigatures`, `lineHeight`, `letterSpacing`, `tabSize`, `insertSpaces`, `detectIndentation`, `wordWrap`, `rulers`, `renderWhitespace`, `renderLineHighlight`, `lineNumbers`, `minimap.enabled`/`minimap.side`/`minimap.scale`, `scrollBeyondLastLine`, `smoothScrolling`, `cursorStyle`, `cursorBlinking`, `cursorSmoothCaretAnimation`, `mouseWheelZoom`, `matchBrackets`, `bracketPairColorization.enabled`, `guides.indentation`/`guides.bracketPairs`, `autoClosingBrackets`, `quickSuggestions`, `wordBasedSuggestions`, `stickyScroll.enabled`, `colorDecorators`, tema (heurística dark/light por nombre de `workbench.colorTheme`).

**Cobertura inicial — IntelliJ (más acotada, por cómo está repartida su config):** `fontSize`/`fontFamily` (`editor.xml` → `FONT_SIZE`/`FONT_FAMILY`), `tabSize`/`insertSpaces` (code style scheme → `TAB_SIZE`/`USE_TAB_CHARACTER`), `wordWrap` (`editor.xml` → `USE_SOFT_WRAPS`), `lineNumbers` (`editor.xml` → `LINE_NUMBERS_SHOWN`), tema (heurística por nombre del color scheme, ej. "Darcula" → dark).

Campos de Monaco sin equivalente directo en IntelliJ (bracket-pair-colorization, cursor smooth caret, sticky scroll, etc.) simplemente no tienen entrada `intellijPath` — el registro los omite para ese IDE sin romper nada.

### Tema: heurística, no paridad exacta

Monaco solo trae temas builtin (`vs`, `vs-dark`, `hc-black`, `hc-light`). VS Code e IntelliJ tienen cientos de temas custom con nombres arbitrarios — no hay forma de importar un tema exacto. La heurística: si el nombre del tema contiene "dark"/"darcula"/"black" (case-insensitive) → `vs-dark`; si contiene "light" → `vs`; si no matchea ninguno, se deja el tema actual de Nestmux sin tocar y se informa en el preview ("no pudimos mapear tu tema '{nombre}', se mantiene el actual").

## Flujo de UI

- Nueva sección en `SettingsPanel.tsx` (donde ya vive `fontSize` hoy): **"Importar configuración de editor"**, con dos botones — "Importar de VS Code" / "Importar de IntelliJ".
- Al clickear: dispara `ide-config:detect` + `ide-config:import`, y muestra un **preview antes de aplicar** — lista de campo, valor actual → valor importado. El usuario confirma o cancela; nada se pisa en silencio.
- Al confirmar: los valores van a `useUserPreferences().updatePrefs()` → se persisten en `user_preferences.ui_settings` (mismo mecanismo ya usado por `fontSize`) y `EditorPane` re-renderiza pasando las opciones nuevas al prop `options` de `<Editor>`.

### Errores (nunca crashear)

- Archivo/carpeta no encontrada en los paths estándar → "No encontramos la configuración de VS Code en este equipo."
- JSON/XML mal formado → "No pudimos leer tu configuración: {error}" — no toca las preferencias existentes.
- Varias versiones de IntelliJ instaladas → toma automáticamente la de modificación más reciente (limitación conocida, documentada; no hay selector de versión en v1).

## Persistencia

Por-usuario, sincronizada vía Supabase — mismo mecanismo que ya usa `useUserPreferences` para `fontSize` (tabla `user_preferences`, columna `ui_settings`, upsert por `user_id`). Se eligió sobre guardado local-por-máquina porque, aunque la config importada viene del disco de una máquina puntual, una vez traducida a opciones de Monaco es igual de válida en cualquier equipo donde el usuario abra Nestmux con su cuenta — consistente con cómo ya se comporta el resto de las preferencias de editor.

## Testing

- **Parseo (main process):** funciones puras testeadas en aislamiento — `settings.json` (string) → objeto de prefs mapeadas (casos válidos, JSON roto, campos ausentes/parciales); XML de IntelliJ → mismo criterio. Resolución de paths por SO mockeando `os.homedir()`/`process.platform`.
- **Selección de versión IntelliJ:** test de que, dadas varias carpetas `IntelliJIdea*`, elige la de `mtime` más reciente.
- **SettingsPanel (renderer):** click en "Importar" → aparece preview con los campos esperados → confirmar → `updatePrefs` llamado con los valores correctos. Estados de error (no encontrado, parseo roto) se renderizan sin crashear ni tocar preferencias existentes.
- **EditorPane:** que las opciones importadas efectivamente lleguen al prop `options` de Monaco — mismo patrón que ya usan los tests existentes para `value`/`onChange`.
- **E2E:** la config real de VS Code/IntelliJ no existe en CI — se necesita un fixture fake (`settings.json` de prueba en un home dir temporal) y una forma de override-ear el path esperado, mismo patrón que `RAVEN_HOME` ya usa en `e2e/helpers/harness.ts` para no depender de instalaciones reales del sistema.

## Decisiones de scope (registradas durante el brainstorming)

- **Keybindings quedan para un spec separado.** Es una pieza independiente (traducir keymaps completos a la API de comandos de Monaco, `editor.addCommand`/`addAction`), con su propio ciclo spec → plan → implementación, a diseñar una vez que esta infraestructura de import (UI, registro de mapeos, IPC de detección) ya exista y esté probada.
- **VS Code e IntelliJ desde el arranque**, no VS Code primero y IntelliJ después — decisión explícita del usuario pese a la asimetría de esfuerzo de parseo entre ambos.
- **Auto-detección en disco**, no pegar/subir el archivo a mano — prioriza comodidad sobre la flexibilidad de importar desde otra máquina.
- **Preview-antes-de-aplicar**, no aplicar directo — evita pisar preferencias existentes sin que el usuario lo vea venir.

## Fuera de alcance (v1 de este spec)

- Keybindings/atajos de teclado (spec separado, ver arriba).
- `formatOnSave`, reglas de linting, snippets, cualquier cosa atada a una extensión específica de VS Code o plugin de IntelliJ — no hay LSP/formatter real en Nestmux.
- Selector manual de versión cuando hay múltiples instalaciones de IntelliJ (toma la más reciente automáticamente).
- Sync bidireccional (Nestmux nunca escribe de vuelta a la config de VS Code/IntelliJ).
- Importar temas de color custom exactos (solo heurística dark/light contra los temas builtin de Monaco).
