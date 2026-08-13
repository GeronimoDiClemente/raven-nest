# Propuesta: 3 mejoras para controlar lo que gastan y producen los agentes

> Otras tres features chicas, mismo formato que la propuesta anterior: qué problema resuelve, qué propongo, y cómo se haría sobre el código actual. — Elise, 2026-08-13

Si las tres anteriores eran sobre **ver qué hacen** los agentes, estas son sobre **qué te cuestan, qué calidad entregan y qué basura dejan atrás**.

---

## 1. Panel de costos y límites — `M`

**El problema.** Hoy Nest no muestra nada de tokens ni de plata: ni por pane, ni por rama, ni sumado. Cada CLI lo lleva por su cuenta y nadie los suma. Y Nest multiplica el consumo por diseño — el broadcast manda el mismo prompt a todos los panes abiertos sin preguntar nada. Los dos dolores que más se repiten entre usuarios de agentes son la factura sorpresa y comerse el rate limit de Claude a mitad del día.

**La propuesta.** Un chip por pane (al lado de los chips de puerto) con tokens y costo estimado de la sesión, acumulado por worktree y por rama. Medidor de la ventana de límites de Claude en la status bar. Y un aviso antes del broadcast del estilo "esto va a 6 panes, calculás quemar ~X". Opcional después: presupuesto con alerta.

**Cómo.** Todo se lee **on-device** de los logs que cada CLI ya escribe; los datos crudos no salen de la máquina. Detalle importante: como Nest redirige el HOME de los panes de IA a la carpeta de la cuenta (`electron/pty-manager.ts`, `env.HOME = accountDir`), los logs de Claude generados desde Nest quedan en `~/.raven-nest/accounts/<cli>/<cuenta>/`, no en el `~/.claude` global — el colector tiene que recorrer esas carpetas. El colector va en main siguiendo el patrón de `electron/metrics-collector.ts`, que ya tiene armado el árbol repo → worktree → pane. El chip copia `PortChip`. Empezar solo con Claude y dejar la interfaz de providers abierta.

**Por qué esta.** Es la única que ningún competidor puede copiar: hay que estar hosteando todas las terminales para sumar el gasto de Claude, Codex y Gemini juntos y atribuirlo por rama. Claude nunca va a medirte Codex.

---

## 2. Checks automáticos cuando el agente termina — `M`

**El problema.** Hoy te enterás de que el agente rompió algo cuando ya commiteaste, pusheaste y GitHub Actions te avisa (`src/lib/ci/`). Correr lint/tests localmente después de cada tarea de agente es disciplina manual, y con varios panes abiertos no la mantiene nadie.

**La propuesta.** Un pipeline configurable por repo (lint, typecheck, tests, build) que corre en el worktree cuando el agente llega a un punto de parada. Semáforo verde/rojo en el header del pane. Si sale rojo, un botón "que lo arregle" que le manda el output del fallo como prompt al mismo agente.

**Cómo.** El motor ya está construido: `electron/setup-runner.ts` ya ejecuta comandos configurables dentro de un worktree, con timeout, estados running/done/failed, log en vivo por IPC y hasta redacción de secretos — hoy solo se dispara al crear el worktree desde los presets de `.raven/presets/*.json`. Esto es el mismo runner con otro schema (`.raven/gates.json`) y otro trigger. Lo único nuevo de verdad es el trigger: "el agente terminó" no existe hoy como concepto y hay que definirlo (un CLI interactivo no cierra su proceso al terminar una respuesta) — si sale el semáforo de la propuesta anterior, es su transición a *terminó*; si no, alcanza con un botón manual y el mismo valor.

**Nota.** De acá cae casi gratis el "AI Error Explain" que ya figura en `docs/ROADMAP.md` (Phase 2).

---

## 3. Limpieza de worktrees + puertos sin pelea — `S`

**El problema.** Tres cosas chicas que rozan al que usa worktrees en serio:
- No hay limpieza: los worktrees viejos se acumulan ocupando gigas y hay que borrarlos de a uno (`worktree:remove`); `pruneMissing` solo limpia entradas del store, no libera disco.
- No hay reserva de puertos: el preset declara `declaredPorts` y en runtime se detectan los usados, pero nada impide que dos dev servers arranquen sobre el mismo puerto y uno falle.

**La propuesta.** (a) Una vista de limpieza: worktrees ordenados por último uso, con tamaño en disco, y borrado en lote con checkbox. (b) Al crear el worktree, asignarle un puerto libre e inyectarlo como variable de entorno del preset, así cada rama levanta en el suyo.

**Cómo.** El cálculo de tamaño en disco ya existe (`metrics-collector.refreshDisk`, con desglose), y la detección de puertos ocupados también (`electron/port-monitor.ts`) — las dos partes son UI y cableado sobre piezas que ya están. Es la más chica de las tres, cuestión de días.

---

## Por qué estas tres

- Las tres se apoyan en código que ya existe (el runner de presets, el colector de métricas, el monitor de puertos); ninguna suma dependencias.
- El panel de costos es el argumento de venta más difícil de copiar que tiene Nest hoy, y es coherente con local-first: nada sale de la máquina.
- Ninguna toca la memoria de contextos (§5 de la guía) ni se pisa con la spec del editor integrado del PR #20.

Si alguna les cierra, la escribo como spec en `docs/specs/` con el formato de siempre.
