# Propuesta: Nest en el bolsillo — el puesto de mando de tu flota

> Tu flota trabaja de noche en un fierro tuyo, y vos la comandás desde el teléfono: leés lo que hizo, respondés lo que preguntó, aprobás lo que sirve y despachás lo próximo. El celular no es un IDE chiquito — es el puesto de mando. — Elise, 2026-08-13

## La idea en 30 segundos

Hoy Nest solo existe mientras estás sentado frente a la PC. Si te levantás, la flota se queda quieta; si un agente pregunta algo a las 3am, la tarea queda trabada hasta mañana.

**La propuesta es cerrar ese loop desde el teléfono:**

- Un agente se frena con una pregunta → te llega la notificación → respondés en dos líneas → sigue trabajando.
- Una tarea termina → ves el diff y los tests en la pantalla → aprobás con el pulgar.
- Se te ocurre algo en el colectivo → lo tirás a la cola y se ejecuta esta noche.
- Algo se trabó feo → entrás al pane puntual y le escribís a mano, terminal completa.

Eso es "codear desde el celular" en el único formato que funciona de verdad: **nadie escribe un refactor con el pulgar, pero todos pueden desbloquear un agente con el pulgar.**

---

## 1. Qué es y qué no es

**Qué NO es**: la app de escritorio metida en 6 pulgadas. El valor de Nest en la PC es ver 12 panes a la vez con 33 layouts; eso en un teléfono no entra y no tiene sentido forzarlo. Prometer paridad con el desktop es la forma más rápida de terminar con una app peor que Termius.

**Qué SÍ es**: la misma flota, con otra superficie según dónde estés.

| Dónde | Para qué sirve |
|---|---|
| PC | Trabajar: la grilla, los layouts, el diff viewer, escribir código con los agentes |
| Teléfono | Comandar: leer, decidir, responder, aprobar, despachar — y meter mano en un pane si hace falta |

El celular hereda las **decisiones**, no la grilla.

---

## 2. El motor que hace que el teléfono valga: Turno Noche

Un puesto de mando sin nada que comandar no sirve. Lo que le da contenido es que la flota trabaje cuando vos no estás.

**Turno Noche**: antes de irte le dejás a Nest una cola de tareas ("migrá los tests a vitest", "actualizá las dependencias"). Cada una corre en su propio worktree, con el provisioning de presets que ya existe, con presupuesto de tokens con corte real y sin tocar tu rama principal.

**Checkpoint-freeze**: si a las 3am el agente pregunta "¿A o B?", Nest no lo deja colgado ni inventa la respuesta — congela la tarea con la pregunta exacta y sigue con la próxima. **Esa pregunta congelada es justamente la notificación que te llega al teléfono.**

**La Gaceta**: cada tarea es una nota con su evidencia — *"✅ La migración terminó: 214 tests en verde"* con el diff, o *"⏸️ Se frenó: ¿mantengo el mock de fetch o migro a MSW?"*. En el celular se lee como un feed: deslizás, aprobás, rechazás o respondés.

**Auto-aprobación por reglas**, para que no te esperen 8 revisiones a la mañana. Se aprueba sola la tarea que pasa los checks del repo (lint, typecheck, tests, build), no tocó archivos de tu lista sensible, no metió secretos nuevos y no se pasó del presupuesto. Todo lo demás te espera con el motivo exacto ("no auto-aprobé porque tocó `migrations/`"). Siempre a una rama `nest/*`, nunca a main, y apagada por defecto hasta que le agarres confianza tras unas cuantas noches.

---

## 3. Con la PC apagada: el nido (`nestd`)

Para que el teléfono sirva de verdad, del otro lado tiene que haber algo prendido — y no debería ser tu laptop abierta toda la noche.

**`nestd`**: el motor de Nest (worktrees + runner + terminales) como daemon de Linux, corriendo en un fierro **tuyo**: un VPS de €4/mes, una Raspberry Pi 5, un mini-PC o la PC vieja del placard.

**El control viaja cifrado punta a punta.** El canal pasa por el Supabase de Nest, pero las claves viven solo en tus dispositivos (pairing por QR): Nest cartea sobres cerrados que no puede abrir. Es el modelo Obsidian Sync / Nabu Casa / Tailscale — vender la conveniencia y jamás poder ver los datos.

*(Descartado a propósito: despertar la PC por Wake-on-LAN. Anda en Linux y Mac, pero en Windows moderno es una lotería — justo la plataforma mayoritaria.)*

---

## 4. Por qué esto no lo tiene nadie

Control remoto de agentes ya existe, y hay que decirlo de frente: **Happy tiene 23k estrellas y Anthropic sacó su propia app**. Lo que no existe es esta combinación:

- **Multi-CLI**: Happy es solo Claude; la app de Anthropic es solo Claude. Nest comanda Claude, Codex, Gemini, Copilot y OpenCode desde la misma bandeja.
- **Sobre tu fierro**: los 7 jugadores de overnight (Codex, Claude Routines, Cursor, Jules, Devin, Copilot, Terragon†) corren tu código en **su** nube; "tu propia infra" existe solo enrejada en planes Enterprise. *"Tu flota trabaja de noche y ni un byte sale de tu casa"* es una frase que Anthropic, OpenAI y GitHub no pueden pronunciar — su negocio es exactamente el contrario. Y no es un nicho: 15-20% de las empresas prohíben estas herramientas, los sectores regulados están estructuralmente afuera, y Anthropic eliminó ZDR en junio de 2026, la prueba de que las políticas de retención cambian cuando el vendor quiere.
- **Es una bandeja de aprobación, no un chat**: las otras apps te dan una conversación con un agente. Esta te da el estado de una flota y las decisiones pendientes, con evidencia adjunta.

---

## 5. Cómo se construye sin abrir una segunda empresa

Una app nativa son dos stores, dos ciclos de release y un stack nuevo — mucho para un equipo de 3 con la cadencia actual. Por eso:

**Arrancar como PWA responsive sobre el mismo relay.** Mismo stack React que ya usan, cero tiendas, cero review de Apple, se prueba mañana desde cualquier teléfono. La nativa se justifica después, y en realidad se justifica por una sola cosa: notificaciones push confiables. Si la PWA se usa todos los días, ahí sí vale el envoltorio nativo.

Y el resto ya está construido:

| Pieza necesaria | Ya existe en Nest |
|---|---|
| Relay en tiempo real hacia otra pantalla | El terminal sharing ya probó el patrón sobre Supabase Realtime |
| Correr N agentes aislados | Grilla multi-CLI + worktrees con presets |
| Ejecutar comandos con timeout y estados (los checks de auto-aprobación) | `electron/setup-runner.ts` |
| Leer el consumo de tokens de cada agente | HOME redirigido: los logs viven bajo `~/.raven-nest/accounts/` |
| Mostrar evidencia (diffs, tests) | Diff viewer + el "✦ AI Review" que ya está |
| Motor portable a un daemon Linux | De los 4 módulos clave (`setup-runner`, `worktree-store`, `preset-store`, `pty-manager`), 3 no importan Electron y el cuarto casi — extraer un `nest-core` es ~1 semana |

## 6. Los límites, que acá son parte del diseño

- **Desde el teléfono no se mergea a main.** Aprobar con el pulgar en el subte y mergear son cosas distintas; el móvil aprueba trabajo en ramas `nest/*`, el merge sigue siendo una decisión de escritorio (o del PR, con el review del equipo).
- **El pairing es requisito de lanzamiento, no una mejora.** El código actual del sharing (código de 8 caracteres, sin cifrado punta a punta) **no** se reusa como canal: identidad de dispositivo + E2E van desde el día uno, y conviene presupuestar una revisión de seguridad externa. Un bug de auth acá expone terminales de usuarios.
- **El teléfono muestra evidencia, no confianza ciega**: cada aprobación va con su diff y el resultado de los tests a la vista.

## 7. Fases

| Fase | Qué entrega | Esfuerzo |
|---|---|---|
| 1 | Turno Noche local (PC prendida, Nest en la bandeja del sistema): cola, presupuesto, freeze, Gaceta, auto-aprobación apagada por defecto. Escrito contra `nest-core`, no contra Electron. | 4-6 semanas |
| 2 | **Puesto de mando móvil (PWA)**: la Gaceta en el teléfono, responder preguntas congeladas, aprobar/rechazar, despachar tareas a la cola, y terminal de un pane como escape hatch. Pairing con identidad de dispositivo + E2E. | 4-6 semanas |
| 3 | `nestd`: "instalalo en un Hetzner de €4 o en tu Raspberry en 10 minutos", cola durable, y con eso la PC se apaga de verdad. Después: app nativa por las push, y flota compartida de equipo. | 6-10 semanas |

Vale plantar bandera antes de terminar: anunciar el roadmap cuesta un posteo y la ventana competitiva es de 1 a 2 trimestres.

## 8. Los riesgos, sin maquillar

- **Correr agentes sin nadie mirando es el problema difícil**: CLIs que piden re-login a las 3am, rate limits nocturnos, un agente colgado. Por eso el diseño es conservador — worktrees descartables, corte de presupuesto y el freeze como salida universal ("ante la duda, congelá y seguí"). Una primera versión que haga 2 o 3 tareas por noche ya es demo de keynote.
- **Login de los CLIs desde un datacenter**: el OAuth de Claude falla desde IPs de datacenter (issue #21678 — Cloudflare bloquea Hetzner). El camino soportado es transferir los tokens desde tu máquina por el canal cifrado. Validarlo antes de comprometer la fase 3.
- **Terminal en un teléfono es incómoda por definición**: por eso el móvil se diseña para decidir, con la terminal como escape hatch. Si el 80% del uso móvil termina siendo tipear en la terminal, el diseño estaría mal y habría que corregirlo.
- **Tiempo**: amux itera todas las semanas, Coder Agents está gratis en beta hasta septiembre, OpenAI está digiriendo Ona. El hueco de compute soberano para el indie y el equipo de 3 está vacío hoy, no dentro de un año.

---

## El pitch

> **Apagá la PC. Tu flota sigue trabajando toda la noche en un fierro que es tuyo, y vos la comandás desde el teléfono: lo que pasó los checks te espera aprobado, lo dudoso te espera con la evidencia y un botón. Tu código nunca toca una nube ajena — Nest solo cartea sobres cerrados que no puede abrir.**

Si les cierra, arranco escribiendo la spec de la fase 1 en `docs/specs/` con el formato de siempre.
