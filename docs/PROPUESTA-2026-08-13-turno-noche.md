# Propuesta: Turno Noche — que Nest trabaje mientras dormís

> La flota trabaja de noche, en un fierro tuyo, con la PC apagada. A la mañana te espera un diario con la evidencia: lo que pasó los checks se aprobó solo, lo dudoso te espera con un botón. Y todo eso cabe en el teléfono. — Elise, 2026-08-13

## La idea en 30 segundos

Hoy los agentes trabajan solo cuando estás sentado mirándolos. Toda la noche se desperdicia.

**Turno Noche**: antes de irte, le dejás a Nest una lista de tareas ("migrá los tests a vitest", "actualizá las dependencias", "agregá tests a estos 3 archivos"). Nest las ejecuta de noche, cada una con un agente en su propia copia del repo, con límite de gasto y sin permiso para tocar tu rama principal.

**La Gaceta**: a la mañana no te espera un chorro de logs, te espera una portada de diario. Cada tarea es una nota: *"✅ La migración terminó: 214 tests en verde"* con su diff y el resultado de los tests, o *"⏸️ Claude se frenó con una pregunta: ¿mantengo el mock de fetch o migro a MSW?"*. Aprobás, rechazás o respondés — un click cada una.

Y lo que hace que esto no sea "otro overnight más": **corre en tu fierro, no en la nube de nadie.**

---

## 1. Cómo funciona una noche

1. **Encolás tareas** (23:40). Cada una en lenguaje natural, con dos perillas: presupuesto de tokens y tiempo máximo. Nest te muestra el costo estimado antes de aceptar.

2. **Apagás la PC.** No es una forma de hablar: el motor no está en tu laptop, está en tu nido (ver punto 3).

3. **Despacho aislado.** Cada tarea corre en su propio worktree, con el provisioning de presets que ya existe. Los agentes no se pisan entre sí ni tocan tu rama principal.

4. **Guardarraíles duros.** Presupuesto con corte real (Nest ya controla el HOME de los agentes, o sea que puede leer lo que consumen), timeout por tarea, máximo de intentos, y nada se mergea a main.

5. **Checkpoint-freeze.** Si a las 3am el agente pregunta "¿A o B?", Nest no lo deja colgado toda la noche ni inventa la respuesta: **congela la tarea con la pregunta exacta** y pasa a la siguiente. Tu decisión te espera a la mañana.

6. **La Gaceta** (08:05). Cada nota con evidencia verificable y tres botones: aprobar, rechazar (se descarta el worktree y no pasó nada), o que siga con tu respuesta.

---

## 2. Auto-aprobación: que lo obvio no te espere

Si a la mañana hay que revisar 8 tareas a mano, el ahorro se evapora. Por eso el turno se aprueba solo cuando el trabajo se puede verificar sin criterio humano.

**Cómo se decide, con reglas tuyas y visibles** (`.raven/nightshift.json`):

- Los checks del repo pasan (lint, typecheck, tests, build) y la cobertura no bajó.
- No tocó archivos de la lista sensible (auth, migraciones, CI, `package.json`, cualquier cosa que marques).
- El diff está dentro del tamaño que fijaste.
- Ningún secreto nuevo en el diff.
- No se pasó del presupuesto.

Si pasa todo eso: la tarea se aprueba sola, queda commiteada en su rama `nest/<tarea>` y —si lo habilitaste— pushea y abre el PR, así a la mañana ya está esperando review de tu equipo. Si falla cualquier condición: no se aprueba nada, la nota queda en la Gaceta con el motivo exacto ("no auto-aprobé porque tocó `migrations/`").

**Tres cosas para que esto sea seguro y no una ruleta:**

- **Auto-aprobado ≠ mergeado.** Nunca a main; siempre a una rama propia, siempre reversible. El peor caso es una rama descartable.
- **La credencial es acotada.** Si el nido pushea solo, lleva un token que solo puede escribir en ramas `nest/*` — nunca en main, nunca force-push. Y si preferís confianza cero, el nido no lleva ninguna credencial y el push lo hace tu máquina cuando abrís la Gaceta.
- **Se empieza cerrado.** Primer release: auto-aprobación apagada por defecto. La activás cuando ya viste unas cuantas noches y le agarraste confianza.

---

## 3. Con la PC apagada: el nido (`nestd`)

El motor de Nest (worktrees + runner + terminales) empaquetado como daemon de Linux, corriendo en un fierro **tuyo**: un VPS de €4/mes, una Raspberry Pi 5, un mini-PC de $150 o la PC vieja del placard. Tu laptop se apaga; el nido sigue.

**El truco de marca.** El control viaja por el Supabase de Nest, pero **cifrado punta a punta**: las claves solo viven en tus dispositivos (pairing por QR). Nest cartea sobres cerrados que no puede abrir. Es el modelo de Obsidian Sync, Nabu Casa o Tailscale — vender la conveniencia y jamás poder ver los datos.

**Por qué esto es incopiable.** Los 7 jugadores de overnight (Codex, Claude Routines, Cursor, Jules, Devin, Copilot, Terragon†) corren tu código en **su** nube; "tu propia infra" existe solo enrejada en planes Enterprise. Mientras tanto, 15-20% de las empresas prohíben estas herramientas, los sectores regulados están estructuralmente afuera, y Anthropic eliminó ZDR en junio de 2026 — la prueba de que las políticas de retención cambian cuando el vendor quiere. La única garantía durable es que la capa de orquestación *no pueda* leer. **"Tu flota trabaja de noche y ni un byte sale de tu casa" es una frase que Anthropic, OpenAI y GitHub no pueden pronunciar.** Su negocio es exactamente el contrario.

*(Descartado a propósito: despertar la PC sola por Wake-on-LAN. Anda en Linux y Mac, pero en Windows moderno es una lotería — justo la plataforma mayoritaria. El camino es fierro dedicado.)*

---

## 4. En el teléfono

Con el nido andando, el celular se vuelve la superficie natural: **la Gaceta te llega al teléfono**. Notificación cuando una tarea se frena, la nota con su diff, y los botones de aprobar/rechazar/responder. Aprobar el trabajo de la noche desde el colectivo.

Y sí, **terminal remota**: entrar a un pane puntual desde el teléfono cuando algo se trabó y querés meter mano. Honestamente: control remoto de un agente ya existe (Happy tiene 23k estrellas, y Anthropic sacó lo suyo). Lo que no existe es esto:

- Es **multi-CLI**, no la app de un vendor para su propio agente.
- Corre sobre **tu fierro**, con el mismo cifrado punta a punta.
- Y sobre todo: el teléfono acá no es un chat, es **la bandeja de aprobación** — el lugar donde se cierra el loop de la noche.

El terminal en el celular no es el producto; es la última milla de un producto que ya vale sin él.

---

## 5. Por qué Nest puede construirlo (y rápido)

Cerca del 80% del runtime ya está en el repo:

| Pieza necesaria | Ya existe en Nest |
|---|---|
| Correr N agentes aislados en paralelo | Grilla multi-CLI + worktrees con presets |
| Ejecutar comandos en un worktree con timeout y estados | `electron/setup-runner.ts` |
| Leer el consumo de tokens de cada agente | HOME redirigido: los logs viven bajo `~/.raven-nest/accounts/` |
| Correr los checks para auto-aprobar | El mismo `SetupRunner`, con otro trigger |
| Mostrar evidencia (diffs, tests) | Diff viewer + el "✦ AI Review" que ya está |
| Relay en tiempo real | El terminal sharing ya probó el patrón sobre Supabase Realtime |
| Voz (opcional, modo radio) | Whisper ya integrado |

Y sobre el daemon: de los 4 módulos clave (`setup-runner`, `worktree-store`, `preset-store`, `pty-manager`), **3 no importan Electron para nada** y el cuarto casi. Extraer un `nest-core` compartido es cuestión de una semana. Los CLIs corren igual en Linux headless con el mismo patrón de HOME redirigido. Un VPS de 4GB sobra: el modelo computa en la nube del vendor, el fierro solo corre git + node + el CLI.

## 6. Fases

| Fase | Qué entrega | Esfuerzo |
|---|---|---|
| 1 | Modo velador (PC prendida, Nest en la bandeja del sistema): cola de tareas, presupuesto, freeze, Gaceta, auto-aprobación apagada por defecto. Todo escrito contra `nest-core`, no contra Electron. | 4-6 semanas |
| 2 | `nestd`: "instalalo en un Hetzner de €4 o en tu Raspberry en 10 minutos". Pairing por QR, cifrado punta a punta, cola durable (si se cae el relay, el nido sigue solo y sincroniza al volver). | 6-10 semanas |
| 3 | Gaceta en el teléfono + terminal remota, one-click server, flota compartida de equipo. | ~1 trimestre |

Vale plantar bandera ya: anunciar el roadmap cuesta un posteo y la ventana competitiva es de 1 a 2 trimestres.

## 7. Los riesgos, sin maquillar

- **Correr agentes sin nadie mirando es el problema difícil**: CLIs que piden re-login a las 3am, rate limits nocturnos, un agente colgado. Por eso el diseño es conservador: worktrees descartables, corte de presupuesto y el freeze como salida universal ("ante la duda, congelá y seguí"). La primera versión puede hacer 2 o 3 tareas por noche y ya es demo de keynote.
- **Login de los CLIs desde un datacenter**: el OAuth de Claude falla desde IPs de datacenter (issue #21678 — Cloudflare bloquea Hetzner). El camino soportado es transferir los tokens desde tu máquina por el canal cifrado. Hay que validarlo temprano, antes de comprometer la fase 3.
- **Seguridad del pairing**: un bug de auth ahí expone terminales de usuarios. El código actual del sharing (código de 8 caracteres, sin cifrado punta a punta) **no** se reusa como canal: identidad de dispositivo + E2E son requisito de lanzamiento, y conviene presupuestar una revisión de seguridad externa.
- **Tiempo**: amux itera todas las semanas, Coder Agents está gratis en beta hasta septiembre, OpenAI está digiriendo Ona. El hueco de "compute soberano para el indie y el equipo de 3" está vacío hoy, no dentro de un año.

---

## El pitch

> **Apagá la PC: tus agentes siguen trabajando toda la noche en un fierro que es tuyo. Lo que pasa los checks se aprueba solo y te espera como PR; lo dudoso te espera en La Gaceta con la evidencia. Tu código nunca toca una nube ajena — Nest solo cartea sobres cerrados que no puede abrir.**

Si les cierra, arranco escribiendo la spec de la fase 1 en `docs/specs/` con el formato de siempre.
