# Nest Terminal — el rediseño visual, y la migración de stack

> Rama: `feat/nest-terminal-ui`
> Fecha: 2026-09-09
> Origen: «la parte visual no me gusta, quiero que realmente sea lindo de ver» + «quiero la reestructuración total si hiciera falta»
> Construye sobre: `DESIGN-EXPLORATION.md` (rama `feat/visual-redesign`), que planteó Ruta A vs Ruta B y nunca cerró

## 1. La respuesta corta, porque contradice el pedido

Pediste la reestructuración total si hacía falta. **No hace falta para que se vea bien**, y conviene saberlo antes de gastar meses.

Está medido, no opinado: el spike del 2026-09-09 armó la ventana de Nest con componentes **shadcn de fábrica, sin editar ninguno**, y todo el carácter de la dirección elegida salió de **46 líneas de tokens** más dos clases de utilidad. El look vive en los tokens; los componentes son intercambiables.

Entonces son **dos decisiones separadas**, y este documento las trata como tales:

| | Qué compra | Qué cuesta |
|---|---|---|
| **A · El look** | Que Nest se vea como la dirección elegida | Semanas |
| **B · El stack** | Consistencia y velocidad *después*; dejar de estilar a mano cada botón | Meses, 107 componentes |

**B no mejora el aspecto.** Lo que evita es que dentro de seis meses estemos otra vez acá, porque cada pantalla nueva se estila a mano y la consistencia depende de disciplina en vez de una máquina.

La recomendación es hacer **A completo primero**, y **B incremental y sin fecha**, empezando por el chrome. Si A termina y el resultado te convence, B deja de ser urgente y pasa a ser una decisión de ingeniería, no de diseño.

## 2. Lo medido

Verificado en disco el 2026-09-09.

### 2.1 El tamaño real

| | |
|---|---|
| Componentes `.tsx` | **107** |
| Hooks | 42 |
| `src/styles/global.css` | **12.104 líneas**, archivo único |
| Otros archivos CSS | **0** — todo vive en ese archivo |
| Tests de UI (jsdom) | 63 |
| Literales de color | **597 hex + 261 `rgba()`** en el CSS, **214 hex** en los `.tsx` |
| Colores distintos | **239** |

### 2.2 Por qué se ve plano — las tres causas, en orden de impacto

1. **La escala no tenía pasos.** `--background: #000000`, `--card: #0a0a0a`, `--popover: #111111`: tres tonos a menos de 30 puntos de luminancia sobre 255. Una tarjeta no se distinguía del fondo, así que nada agrupaba nada. **Ya arreglado** (§4.1).
2. **Dos acentos peleando.** El azul `#0066FF` de los tokens y un violeta `#7c3aed` escrito a mano en 36 lugares que ni siquiera pasaba por los tokens. **Ya arreglado**: 74 literales en el CSS y 43 en los `.tsx` convertidos.
3. **No hay escala tipográfica.** `--ui-font-size: 13px` y casi todo el CSS usa ese tamaño con un solo peso. **Pendiente, y es lo que más aplana hoy.**

### 2.3 En qué se basan Orca y Superset

Los dos: **Tailwind v4 + shadcn/ui + Radix**. Verificado desde sus fuentes, no de oído. Los valores de Orca (`src/renderer/src/assets/main.css`, bloque `.dark`):

| | Nest antes | Orca |
|---|---|---|
| fondo | `#000000` | `#0a0a0a` |
| tarjeta | `#0a0a0a` | `#171717` |
| elevado | `#111111` | `#262626` |
| borde | `#1e1e1e` sólido | `rgb(255 255 255 / 0.07)` translúcido |
| primary | `#0066FF` + `#7c3aed` | `#e5e5e5` — **sin acento cromático** |
| radio | `6px` | `0.625rem` (10px) |
| fuente | system-ui | **Geist Variable** |

Lo que hace la diferencia no es el stack: es que ese stack les **impone** una escala con pasos, un primary sin color y bordes translúcidos.

### 2.4 Lo que el spike probó y lo que no

**Probó**: la dirección se logra con componentes shadcn sin tocar; el tema son 46 líneas; Tailwind v4 + shadcn + Radix + Geist compila y anda.

**Encontró un problema real**: shadcn asume que el shell lleva `bg-background text-foreground`. Sin eso, todo componente que no fija color propio queda ilegible — pasó en el primer build del spike. El `global.css` de Nest **no hace eso en ningún lado**, así que es lo primero que se rompería en una migración.

**No probó**: que migrar 107 componentes sea barato. El spike hizo dos pantallas.

## 3. Parte A — el look

### 3.1 La dirección: «Nest Terminal»

La fundación de Orca —escala `neutral` de Tailwind, borde translúcido, primary acromático, Geist— empujada hacia la terminal:

- **Los datos van en mono** (Geist Mono): timestamps, rutas, ramas, contadores, títulos de memoria. El texto largo queda en sans, porque en mono se lee peor.
- **Micro-labels en versalitas** con tracking `.1em`.
- **Radio 6px** en vez de los 10 de Orca, y densidad 13 en vez de 16.
- **El color es estado, nunca marca**: verde sincronizado, ámbar advertencia, rojo destructivo. El acento es acromático.

Elegida en el design lab del 2026-09-09 contra otras tres (`Nest actual`, `Orca`, `Terminal puro`).

### 3.2 Los tres pasos, en orden de impacto

| Paso | Qué | Estado |
|---|---|---|
| **A1 · Color y elevación** | La escala de 4 pasos, primary acromático, bordes translúcidos, matar los acentos hardcodeados | ✅ hecho (commit `c9d481f`) |
| **A2 · Tipografía** | Escala real (11 · 12 · 13 · 15 · 17), pesos, versalitas para micro-labels, Geist + Geist Mono empaquetadas | pendiente — **es lo que más aplana hoy** |
| **A3 · Densidad y forma** | Radio, paddings, alturas de fila; y el layout de las pantallas que quedan vacías (Memories) | pendiente |

**A2 antes que A3**: la tipografía cambia cómo se lee *toda* la app; la densidad afecta pantalla por pantalla.

### 3.3 La fuente — la decisión que hay que tomar en A2

Hoy `--font-ui` es la fuente del sistema, con un comentario que explica la elección: igual que VS Code, para no empaquetar una web font. Orca empaqueta **Geist Variable** (~30 KB por subset latino).

**Recomendación: empaquetar Geist**, por el mismo motivo por el que Orca lo hace — una app de escritorio que se ve igual en las tres plataformas. El costo es ~90 KB en el bundle. La alternativa es quedarse con la del sistema y aceptar que en Windows y en Mac Nest se ve distinto.

## 4. Parte B — la migración de stack

### 4.1 Qué es

Meter **Tailwind v4 + shadcn/ui + Radix** y migrar los componentes a componentes shadcn. Es lo que hacen los dos competidores.

### 4.2 La regla que ordena todo: convivencia, nunca big bang

Tailwind convive con las 12.104 líneas de `global.css`. Un componente migrado deja de usar sus clases viejas; las clases viejas se borran **cuando ya no las usa nadie**, no antes. Nunca hay un estado donde la app esté a medio migrar y rota.

### 4.3 El orden

1. **El shell** — `bg-background text-foreground` en la raíz. Es la precondición del §2.4 y una línea.
2. **El chrome**: titlebar, tabs, sidebar. Es lo que se ve en todas las pantallas, así que da el mayor retorno visible por componente migrado.
3. **Los overlays**: Personal, Teams, Memories, Settings. Son pantallas enteras y autocontenidas: se migran de a una sin tocar el resto.
4. **Lo que queda**, por frecuencia de uso.

### 4.4 Lo que NO se migra

- **xterm y Monaco.** Tienen su propio sistema de temas y reciben colores como valores JS. Un `var(--primary)` **no resuelve** ahí — verificado: es la razón por la que `useXterm.ts` quedó afuera de la conversión de A1. Lo que hay que hacer es leer el token con `getComputedStyle` al construir el tema, y eso es trabajo aparte.
- **El grafo.** Dibuja SVG propio.
- **Los logos y colores de marca de terceros.** `builtinCatalog.ts` tiene el azul de Atlassian (`#0052CC`); convertirlo en nuestro acento sería un error, no una mejora.

### 4.5 Lo que cuesta de verdad

**63 tests de jsdom** consultan clases y estructura del DOM. Migrar un componente a shadcn le cambia el markup, así que **cada componente migrado arrastra sus tests**. Ese es el costo real de B, y es el que hace que no tenga fecha: no son 107 componentes, son 107 componentes más sus tests.

## 5. Alcance — actualizado el 2026-09-09 después de decidir

El §1 recomendaba hacer A y dejar B para después. **Gero eligió lo contrario, con el
argumento correcto**: «si es una cuestión de ingeniería y apuntamos a romperla, no tengo
apuro, total es laburo local, lo de que sea completo». B **entra entero**.

Eso cambia una cosa concreta y ya se aplicó: **no se reescriben las 627 declaraciones de
`font-size` de `global.css`**. Reescribir a mano un archivo que vamos a borrar es trabajo
tirado; la escala vive como tokens (que viajan al tema de Tailwind) y cada componente la
adopta al migrarse. Lo mismo vale para las 54 ocurrencias de azul del §7.4: se limpian al
migrar el componente que las usa, no antes.

**Entra:** A1 (hecho), A2 (hecho), A3, y B completo — los 107 componentes, en el orden
del §4.3 y bajo la regla de convivencia del §4.2.

**Fuera a propósito:** xterm, Monaco, el grafo del hilo y los colores de marca (§4.4).

## 5.1 Las dos decisiones visuales que se tomaron encima

**Memories con onda Obsidian.** El grafo de hoy (`TeamThreadGraph.tsx`, 129 líneas) es SVG
estático con posiciones precalculadas: no tiene física ni animación, y por eso no se siente
como el de Obsidian. Obsidian usa un layout **force-directed**: atracción tipo resorte
(Hooke) en las aristas y repulsión tipo Coulomb entre nodos, recalculado en vivo, con lo
denso agrupándose al centro y lo aislado derivando al borde. Entra en A3.

**El plugin externo con onda engram.** `Gentleman-Programming/engram` es un binario Go con
SQLite+FTS5, MCP y una TUI de cuatro pantallas (dashboard, recientes, detalle, búsqueda).

> ⚠️ **Tensión que hay que resolver antes de escribir la TUI, no después:** la TUI de engram
> usa **Catppuccin Mocha**, una paleta pastel *colorida*. La dirección de Nest es
> deliberadamente **acromática** — el color reservado para estado, nunca para marca (§2.2).
> «Que se vea onda engram» y «que se vea como Nest» son, hoy, dos identidades distintas.
> Hay que elegir: o la TUI hereda los tokens de Nest y sólo copia la *estructura* de engram
> (cuatro pantallas, navegación `j`/`k`/`/`/`Esc`), o se acepta que el plugin tenga su propia
> cara. La recomendación es la primera: la estructura de engram es lo bueno; su paleta es de
> ellos. Esto pertenece al plan del plugin (fase 2), no a este.

## 6. Riesgos

1. **A2 toca todo.** Cambiar la escala tipográfica de una app de 12k líneas de CSS mueve alturas de fila y alineaciones en pantallas que nadie va a mirar hasta que un usuario las abra. Mitigación: los e2e con captura que ya existen (`e2e/03-memories-in-app.spec.ts`) más capturas de las pantallas principales antes y después.
2. **La app en dev no se puede dejar abierta desde esta sesión** — cada comando corre en su propio grupo de procesos y al terminar se mata el árbol. La verificación visual va por capturas del harness headless, o la levantás vos con `npm run dev`.
3. **B se puede empezar y no terminar.** Una app mitad shadcn y mitad CSS a mano es peor que cualquiera de las dos puras. Mitigación: la regla del §4.2 y no empezar B hasta que A esté cerrado.
4. **La fuente empaquetada suma ~90 KB** y hay que decidirlo explícitamente (§3.3).

## 7. Estado de lo que estaba abierto

1. ~~¿Se empaqueta Geist?~~ **Sí, decidido y hecho.** Carga verificada en la app real.
2. ~~¿Se hace B más allá del chrome?~~ **Sí, completo** (§5).
3. **El layout de Memories** — sigue abierto en un punto: qué muestra la pantalla cuando no
   hay repo abierto. El resto se resuelve con el grafo animado del §5.1.
4. **54 ocurrencias de azul/violeta que quedaron.** 27 variantes cromáticas
   (`#a855f7`, `#3b82f6`, `#1a75ff`, `#4f9eff`…) que son casi-duplicados del acento y que
   la conversión por match exacto no cazó. **No se convierten en bloque**: la primera pasada
   automática se llevó puesto el azul de marca de Atlassian en `builtinCatalog.ts`, así que
   cada una se decide al migrar su componente.
5. **La paleta de la TUI del plugin** (§5.1), para la fase 2.

## 8. Lo que ya está construido y el plan puede dar por hecho

- **El contrato del shell.** shadcn asume `bg-background text-foreground` en la raíz. Es la
  precondición del §2.4 y lo primero de la migración.
- **El guard de contraste** (`e2e/04-contraste.spec.ts`). Mide lo que el navegador pinta
  sobre la app real y falla por debajo de 3:1. Es la red de seguridad de toda la migración:
  cazó tres bugs el día que se escribió, uno de ellos previo al rediseño.
- **Los e2e con captura** (`e2e/03-memories-in-app.spec.ts`), headless por default.
- **El spike** en el scratchpad: prueba viva de que el look sale con componentes de fábrica.
