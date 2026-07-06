# Instagram — 4 guiones de reels (Mes 1)

> 1 por semana (jueves). Duración objetivo: 30-60s. Formato 9:16 (1080×1920).
> Base de todos: **screen recording real de Nestmux** en tema oscuro, con zooms y cortes rápidos. El producto mostrándose solo es el mejor argumento — cero stock, cero animaciones genéricas.
> Producción: grabar la pantalla en máxima resolución, encuadrar la zona relevante en 9:16 con zooms (no meter la ventana entera diminuta). Overlays de texto en mono, color de acento de marca, máx. 2 líneas por overlay. Subtitular todo (mucha gente mira sin audio). Música: algo instrumental con pulso, sin copyright.

---

## R1 — Demo: 3 agentes lado a lado (jueves, sem. 1) — ~40s

**Objetivo:** que en 40 segundos se entienda qué es Nestmux sin que nadie lo explique.

**Hook (0-2s):** pantalla negra con una sola línea tipeándose en mono: `3 AIs trabajando a la vez. una ventana.` Corte seco al producto.

**Guion escena por escena:**

| t | Qué se ve en pantalla (screen recording) | Overlay | Audio/VO (opcional, Gero) |
|---|---|---|---|
| 0-2s | Texto del hook tipeándose con cursor | — | (silencio + primer beat) |
| 2-8s | Nestmux abierto, grilla vacía. Se abre un panel de Claude, se tipea un prompt real (ej. "agregá tests al módulo de auth") y se manda | `panel 1: claude` | "Le doy una tarea a Claude..." |
| 8-14s | Se abre segundo panel, Gemini, otro prompt (ej. "documentá los endpoints"). Zoom al panel | `panel 2: gemini` | "...otra a Gemini..." |
| 14-20s | Tercer panel, Codex, tercer prompt. La grilla queda 3 paneles visibles, los 3 escupiendo output a la vez | `panel 3: codex` | "...y otra a Codex." |
| 20-28s | Plano general de la grilla: los 3 agentes trabajando en simultáneo, output corriendo | `los tres. al mismo tiempo.` | "Mientras uno labura, superviso a los otros dos." |
| 28-35s | Ctrl+L presionado 2-3 veces: el layout cambia en vivo, las sesiones siguen intactas. Zoom a un panel que sigue corriendo | `Ctrl+L → 11 layouts, sin reiniciar nada` | "Y acomodo la grilla como quiera, sin cortar nada." |
| 35-40s | Cierre: zoom out a la grilla + placa final sobre fondo oscuro | `gratis · 3 paneles · nestmux.com` | "Nestmux. Gratis, en nestmux.com." |

**Caption:**
Claude, Gemini y Codex trabajando a la vez, cada uno en su panel, en una sola ventana. Esto es Nestmux.

Plan Free permanente: 3 paneles, todas las AIs, $0. macOS, Windows y Linux → nestmux.com

#ia #devs #terminal #devtools #programacion

---

## R2 — Worktrees: 3 agentes, 3 ramas, cero pisadas (jueves, sem. 2) — ~55s

**Objetivo:** mostrar el caso de uso más "wow" para devs que ya usan agentes: paralelismo real sin conflictos. Feature Pro (aclarado al final y en caption).

**Hook (0-2s):** overlay sobre dos paneles de terminal en pantalla: `¿2 agentes en el mismo repo? se pisan.` 

**Guion escena por escena:**

| t | Qué se ve en pantalla | Overlay | VO |
|---|---|---|---|
| 0-2s | Dos paneles lado a lado, ambos con el mismo path de repo visible | `¿2 agentes en el mismo repo? se pisan.` | "Si dos agentes tocan el mismo directorio, se pisan." |
| 2-8s | Se muestra rápido el problema: mismo working directory en ambos paneles (zoom al prompt/path idéntico) | `mismo directorio = conflicto` | "Uno escribe arriba del otro. Caos." |
| 8-16s | UI de worktrees de Nestmux: se crea un worktree nuevo desde la interfaz, se elige rama `feature-a`. Zoom al flujo | `worktrees desde la UI. sin comandos.` | "Nestmux crea git worktrees desde la UI: una copia aislada del repo por rama." |
| 16-24s | Se abre un agente (Claude) dentro de ese worktree y se le da una tarea. Zoom a la etiqueta de rama/worktree del panel | `claude → feature-a` | "Claude trabaja en su copia..." |
| 24-32s | Segundo worktree (`fix-login`), segundo agente (Codex), segunda tarea | `codex → fix-login` | "...Codex en la suya." |
| 32-42s | Plano general: ambos paneles avanzando en paralelo, cada uno en su worktree. Pausa de 2s para que se vea | `2 tareas avanzando en paralelo. de verdad.` | "Dos tareas reales avanzando al mismo tiempo, sin tocarse." |
| 42-50s | Diff viewer abierto revisando los cambios de uno de los worktrees | `revisás antes de mergear` | "Y antes de mergear, revisás qué hizo cada uno." |
| 50-55s | Placa final | `worktrees → plan Pro · arrancá gratis · nestmux.com` | "Worktrees está en Pro. Arrancás gratis en nestmux.com." |

**Caption:**
El truco para que dos agentes de IA trabajen en el mismo repo sin pisarse: git worktrees, manejados desde la UI. Cada agente en su copia aislada, vos revisando todo desde una grilla.

Worktrees es parte del plan Pro. El plan Free (3 paneles, todas las AIs) es gratis para siempre → nestmux.com

#git #ia #devs #worktrees #devtools

---

## R3 — Behind the scenes: el equipo construyendo Nest (jueves, sem. 3) — ~50s

**Objetivo:** humanizar. Quiénes son, por qué existe Nest, cómo trabajan. Este reel NO vende features: vende confianza. Único reel del mes con cámara además de pantalla.

**Hook (0-2s):** cámara: alguien del equipo frente a una pantalla llena de paneles de Nestmux. Overlay: `esto lo hicimos porque lo necesitábamos nosotros.`

**Guion escena por escena:**

| t | Qué se ve | Overlay | VO (Gero) |
|---|---|---|---|
| 0-2s | Plano de una pantalla con Nestmux a full + alguien del equipo de espaldas trabajando | `esto lo hicimos porque lo necesitábamos nosotros` | "Nestmux existe porque lo necesitábamos nosotros." |
| 2-10s | Clips cortos de trabajo real: Gero en llamada/escribiendo, código en pantalla, terminal corriendo | `trabajábamos en paralelo para una empresa de EEUU` | "Trabajábamos para una empresa de EEUU, con mil tareas en paralelo, y las herramientas no daban abasto." |
| 10-18s | Presentación rápida del equipo, un clip de 2s por persona trabajando en lo suyo, con su nombre y rol en overlay | `Gero — CEO` / `Matías — CTO` / `Eliseo — CISO` / `Bautista — CMO` | "Somos cuatro: Gero, Matías, Eliseo y Bautista." |
| 18-28s | Pantalla: sesión de trabajo real construyendo Nest — código del proyecto, un panel con un agente ayudando, la app corriendo en modo dev | `sí: usamos nestmux para construir nestmux` | "Y sí: usamos Nestmux para construir Nestmux. Todos los días." |
| 28-38s | Clips de momentos reales: pizarra/notas, risas en llamada, un bug arreglándose, el momento de mergear un PR | `v1.3.1 · macOS, Windows y Linux` | "Lanzamos en Product Hunt en junio. Hoy hay 90 devs usándolo, y recién empezamos." |
| 38-46s | Cámara: Gero a cámara, plano simple, sin producción | `¿qué le agregarías? te leemos` | "Lo estamos construyendo en público. Si lo probás y te falta algo, decínoslo: lo leemos todo." |
| 46-50s | Placa final sobre fondo oscuro | `nestmux.com · gratis` | "Nestmux. Gratis, en nestmux.com." |

**Caption:**
Detrás de Nestmux somos cuatro: Gero, Matías, Eliseo y Bautista. Lo construimos porque trabajábamos en paralelo para una empresa de EEUU y necesitábamos una forma sana de correr varios agentes a la vez.

Hoy lo usan 90 devs y lo seguimos construyendo en público — con Nestmux, obvio.

¿Qué le agregarías? Te leemos en comentarios. nestmux.com

#buildinpublic #startup #techlatam #devs #equipo

---

## R4 — Broadcast Mode: un prompt, varios agentes (jueves, sem. 4) — ~45s

**Objetivo:** cerrar el mes con la feature más espectacular en video: el mismo prompt disparado a varios agentes y las respuestas comparadas lado a lado. Conecta con el posicionamiento de verificación ("casi correcto"). Feature Pro.

**Hook (0-2s):** overlay sobre la grilla quieta: `¿y si le preguntás a 3 AIs a la vez?`

**Guion escena por escena:**

| t | Qué se ve en pantalla | Overlay | VO |
|---|---|---|---|
| 0-2s | Grilla de Nestmux con 3 paneles listos (Claude, Gemini, Codex), quietos | `¿y si le preguntás a 3 AIs a la vez?` | "¿Y si en vez de confiar en una IA, les preguntás a tres?" |
| 2-10s | Se activa Broadcast Mode (zoom al control). Se tipea UN prompt real (ej. "encontrá el bug en esta función y proponé el fix") | `broadcast mode: un prompt → todos los paneles` | "Broadcast Mode: escribís el prompt una vez..." |
| 10-16s | Enter. Los 3 paneles reciben el prompt EN SIMULTÁNEO y empiezan a responder a la vez. Este es EL momento del reel: plano general, sin cortes, 5s | `enviado a los 3. al mismo tiempo.` | "...y les llega a todos al mismo tiempo." |
| 16-28s | Zooms alternados a cada panel mostrando que las respuestas son distintas (uno propone una cosa, otro otra) | `3 respuestas. no dicen lo mismo.` | "Y acá está lo interesante: no responden lo mismo." |
| 28-38s | Lado a lado de dos respuestas divergentes. Overlay con el dato | `66% de los devs: el problema es el código IA "casi correcto"` | "El 66% de los devs dice que su mayor problema es el código IA 'casi correcto'. Compará antes de confiar." |
| 38-45s | Placa final | `broadcast → plan Pro · empezá gratis · nestmux.com` | "Broadcast está en Pro. Empezá gratis en nestmux.com." |

**Caption:**
Un prompt, tres agentes, tres respuestas distintas — y ahí está el punto: el código IA "casi correcto" es la frustración #1 de los devs (66%, Stack Overflow 2025). Compará antes de confiar.

Broadcast Mode es parte del plan Pro. Arrancá gratis con 3 paneles y todas las AIs → nestmux.com

#ia #devs #devtools #programacion #broadcast
