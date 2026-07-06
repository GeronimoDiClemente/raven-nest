# Instagram — 4 carruseles (Mes 1)

> 1 por semana (martes). Formato 1080×1350. Mismo sistema visual que los posts estáticos: fondo terminal oscuro, mono + acento de marca, chrome de ventana, `nestmux.com` al pie de cada slide.
> Regla de carrusel: slide 1 = hook que se entiende sin contexto; último slide = CTA siempre.

---

## C1 — Antes / después: tu flujo sin Nestmux vs. con Nestmux (martes, sem. 1)

**Tipo:** antes/después (storytelling del producto).

**Caption:**
Así se ve trabajar con 3 agentes de IA antes y después de Nestmux. Deslizá.

El "antes" lo conocés de memoria: ventanas desparramadas, tabs perdidas, contexto que se esfuma cada vez que cambiás de app. El "después" es una sola grilla donde ves todo, todo el tiempo.

Plan Free permanente: 3 paneles, todas las AIs, $0. Descargalo en nestmux.com (macOS, Windows y Linux).

#devs #ia #antesydespues #devtools #productividad

**Slides:**

1. **Hook.** Texto grande: `tu flujo con agentes de IA: antes / después`. Mitad izquierda con ventanas caóticas en gris, mitad derecha una grilla ordenada con glow de acento. Flechita "deslizá →".
2. **Antes, parte 1.** Título: `09:14 — arrancás el día`. Ilustración: 5 ventanas de terminal superpuestas, cada una con un nombre (`claude`, `gemini`, `codex`, `dev server`, `git`). Texto: "Un agente por ventana. Ya perdiste una."
3. **Antes, parte 2.** Título: `11:30 — alt-tab n°47`. Texto: "¿Terminó Claude? ¿En qué puerto quedó el server que levantó Codex? ¿Dónde estaba la tab del log?" Ilustración: signo de pregunta sobre las ventanas apiladas.
4. **El quiebre.** Slide casi vacío, centro: `> ¿y si todo estuviera en una sola ventana?` con cursor. Máximo contraste con los slides anteriores: silencio visual.
5. **Después, parte 1.** Screenshot real de Nestmux con 3-4 paneles activos (Claude, Gemini, Codex + terminal). Título: `una grilla. cada agente en su panel.` Texto: "Sesión, cuenta, historial y entorno propios por panel."
6. **Después, parte 2.** Zoom a detalles reales con callouts de acento: chip de puerto en un panel ("el dev server, detectado solo"), y esquema de layouts ("Ctrl+L cicla 11 layouts sin reiniciar nada").
7. **Después, parte 3.** Título: `y cuando el proyecto crece:` con lista corta: `→ worktrees por agente (Pro)` / `→ broadcast a varios agentes (Pro)` / `→ terminal sharing con tu equipo`. Texto chico: "Escala con vos."
8. **CTA.** `probalo gratis` gigante + `nestmux.com` + "Plan Free permanente · 3 paneles · macOS, Windows y Linux".

---

## C2 — Tutorial visual: git worktrees desde la UI (martes, sem. 2)

**Tipo:** tutorial paso a paso. Feature Pro (aclarado en caption y slide final).

**Caption:**
Dos agentes tocando la misma rama = pisadas garantizadas. La solución tiene nombre desde hace años: git worktrees. Lo que no existía era una forma cómoda de manejarlos.

En Nestmux los creás y gestionás desde la UI, y cada agente trabaja aislado en su propia copia del repo. Tutorial completo en el carrusel.

Worktrees es parte del plan Pro. El plan Free (3 paneles, todas las AIs) es gratis para siempre: nestmux.com

#git #worktrees #ia #devs #tutorial

**Slides:**

1. **Hook.** `2 agentes. 1 repo. 0 conflictos.` grande, con subtítulo `git worktrees desde la UI — tutorial`. Fondo: dos paneles esquemáticos con una rama git dibujada entre ambos.
2. **El problema.** Título: `el problema`. Texto: "Le das una tarea a Claude y otra a Codex. Los dos escriben en el mismo working directory. Uno pisa al otro." Ilustración: dos flechas chocando sobre un archivo.
3. **El concepto.** Título: `worktree = una copia aislada del repo`. Diagrama simple: un repo central y dos carpetas colgando (`feature-a`, `fix-login`), cada una con su rama. Texto: "Mismo repo, directorios separados, ramas separadas."
4. **Paso 1.** `paso 1 — creá el worktree desde la UI`. Screenshot real del flujo de creación de worktree en Nestmux, con el campo de rama resaltado en acento. Texto: "Sin comandos, sin acordarte la sintaxis de `git worktree add`."
5. **Paso 2.** `paso 2 — abrí un agente en ese worktree`. Screenshot del panel del agente corriendo dentro del worktree. Texto: "El agente ve solo su copia. Trabaja tranquilo."
6. **Paso 3.** `paso 3 — repetí con el segundo agente`. Screenshot de la grilla con 2 paneles, cada uno en su worktree, con etiquetas de rama visibles. Texto: "Dos tareas avanzando en paralelo, de verdad."
7. **Paso 4.** `paso 4 — revisá antes de mergear`. Texto: "Mirá los cambios de cada uno con el diff viewer y quedate con lo que está bien. El 'casi correcto' se caza acá." Screenshot o mock del diff viewer.
8. **CTA.** `dejá de frenar a un agente para que trabaje el otro` + "Worktrees está en el plan Pro. Arrancá gratis con 3 paneles:" + `nestmux.com`.

---

## C3 — Comparativa: ¿Nestmux o Cursor? (martes, sem. 3)

**Tipo:** comparativa. Encuadre oficial del brief: "No somos lo mismo. Somos complementarios." Tono respetuoso, cero agresión al otro producto.

**Caption:**
La pregunta que más nos hacen: "¿esto reemplaza a Cursor?"

No. Y no queremos que lo haga. Tu editor es donde escribís código; Nestmux es donde corrés y supervisás a tus agentes de CLI. En el carrusel te mostramos dónde termina uno y empieza el otro — y por qué usarlos juntos es la jugada.

nestmux.com — plan Free permanente, 3 paneles, todas las AIs.

#cursor #ia #devtools #comparativa #devs

**Slides:**

1. **Hook.** `¿nestmux o cursor?` grande, y debajo en acento: `pregunta equivocada.` Flechita "deslizá →".
2. **La respuesta corta.** `no somos lo mismo. somos complementarios.` centrado, slide limpio. Texto chico: "Va en serio. No es humildad de marketing."
3. **Qué hace tu editor.** Título: `tu editor (Cursor, VS Code, el que sea)`. Lista: "→ escribir y editar código / → autocompletado y chat sobre tu archivo / → tu lugar de trabajo de siempre". Ilustración: un recuadro con líneas de código.
4. **Qué hace Nestmux.** Título: `nestmux`. Lista: "→ tus agentes de CLI (Claude, Gemini, Codex, Copilot, OpenCode) lado a lado / → cada panel con su sesión, cuenta e historial / → hasta 12 paneles, 11 layouts". Screenshot real de la grilla.
5. **Dónde se encuentran.** Título: `el flujo completo`. Diagrama horizontal: `delegás tareas a tus agentes (nestmux)` → `verificás: diff viewer, puertos, código corriendo (nestmux)` → `pulís el resultado (tu editor)`. Texto: "Delegar, verificar, terminar."
6. **El diferencial concreto.** Título: `lo que solo pasa en la grilla`. Lista: "→ ver 3 agentes trabajar al mismo tiempo / → chip con el puerto de cada dev server / → compartir tu terminal en vivo con un código de 8 caracteres". 
7. **Para quién.** Título: `usalos juntos si...`. Lista: "→ delegás tareas a más de un agente / → revisás más código IA del que escribís a mano / → trabajás con otros devs y quieren ver lo mismo".
8. **CTA.** `no elijas. sumá.` + `nestmux.com` + "Gratis: 3 paneles, todas las AIs. macOS, Windows y Linux."

---

## C4 — Lista útil: 7 features de Nestmux que quizás no conocías (martes, sem. 4)

**Tipo:** lista útil para devs. Sirve también como recap del mes.

**Caption:**
Un mes mostrando Nestmux y todavía quedan features en el tintero. Acá van 7 — algunas gratis, otras Pro — que hacen la diferencia en el día a día.

¿Cuál usás más? ¿Cuál no conocías? Te leemos en comentarios.

Descargalo gratis en nestmux.com — plan Free permanente, 3 paneles, todas las AIs.

#devtools #tips #ia #devs #terminal

**Slides:**

1. **Hook.** `7 features de nestmux que quizás no conocías` con numeritos `01–07` en columna al costado, estilo índice de archivo.
2. **01 — Ctrl/Cmd+L.** `cambiá de layout sin matar nada`. Texto: "11 layouts de tiling. Tus sesiones ni se enteran." Mini-diagrama de 3 grillas distintas.
3. **02 — Chip de puertos.** `el puerto de cada panel, detectado solo`. Texto: "Aunque el server lo haya levantado el agente. Click y se abre en el Browser cell interno." Screenshot del chip.
4. **03 — Broadcast Mode (Pro).** `un prompt, todos los agentes`. Texto: "Mandá el mismo prompt a varios paneles a la vez y comparé respuestas lado a lado." Diagrama: un prompt con flechas a 3 paneles.
5. **04 — Voice input.** `dictale el prompt`. Texto: "Hablás, transcribe, ejecutás. Requiere whisper instalado localmente (`pip install openai-whisper`)." Ícono de micrófono en acento.
6. **05 — Spotlight + snippets.** `tus comandos, a un atajo de distancia`. Texto: "Buscá lo que sea con Spotlight y guardá tus prompts repetidos como snippets."
7. **06 — My Repos.** `tus repos de GitHub y GitLab, con CI a la vista`. Texto: "Dashboard personal: repos y estado de los CI runs sin abrir el navegador." Screenshot de My Repos.
8. **07 + CTA.** `07 — workspaces guardados`: "Armá tu grilla ideal una vez, volvé a ella siempre." Y cierre: `probalos vos → nestmux.com` (gratis, macOS/Windows/Linux).
