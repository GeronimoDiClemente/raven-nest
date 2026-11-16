# Nest: la decisión junto al trabajo

Propuesta de producto, 29 de octubre de 2026. Las ocho pantallas son estudios con datos de ejemplo, no funciones conectadas. [Abrir galería](index.html).

Nest puede convertir Memories en continuidad visible entre agentes: una decisión conserva su origen, cambia de versión cuando corresponde y acompaña la siguiente tarea. No basta con poner un contador de recuerdos. La persona necesita saber qué recibió el agente, si sigue vigente y a qué sesión va a enviarlo.

## Qué ya existe y cuál es el hueco

Revisión acotada del código actual de `feat/memories-settings`, no de la antigua propuesta de arquitectura.

| Base existente | Evidencia en el repo | Hueco de experiencia que propongo cubrir |
|---|---|---|
| Buscar, recuperar, guardar, actualizar y promover memorias; contexto resumido y lectura completa | `electron/memory-mcp/tools.ts`, `electron/memory-reads.ts` | La terminal no presenta un recibo legible de las lecturas de esa sesión. El manifiesto instruye al agente, pero no demuestra que haya aplicado una decisión. |
| Autor/agente, rama, topic key, ID y fecha en registros; exclusión de superseded en búsqueda/contexto | `electron/memory-reads.ts`, `electron/memory-store.ts` | Mostrar procedencia y vigencia en el punto de trabajo. Los números v1/v3 de los bocetos son una convención propuesta; no asumir una API de versiones con ese formato. |
| Sesión asociada a pane y detector de sesiones silenciosas | `electron/memory-sessions.ts` | Llevar salud al workspace. `writing` se deduce de que llegó una sesión —e incluso se concede durante 15 s de gracia—, no de observar una escritura. |
| Estado local, vault, conflictos, sync y sesiones silenciosas | `src/components/MemoriesStatusRow.tsx` | Visibilidad durante el trabajo y señales independientes. No inventar un único verde «todo funciona». |
| Hilo por rama, notas de equipo y grafo | `src/components/TeamThreadPanel.tsx`, `electron/integrations/team-thread-note.ts` | Brief de la rama activa y cambios desde la última visita. No hace falta otro chat ni otro almacén de memoria. |
| Command palette con acceso a Memories y acciones de navegación | `src/components/CommandPalette.tsx` | Buscar registros y preparar una inserción para un pane concreto, sin abandonar las terminales. |
| Welcome con ejemplo Claude → Codex y tour | `src/components/MemoriesWelcome.tsx` | Demostrar una recuperación real en el proyecto del usuario, no repetir el onboarding ilustrativo. |
| Handoff de pipelines, revisión de PR y graph board | `src/components/PaneHeader.tsx`, `src/components/PRReview.tsx`, `src/components/GraphBoard.tsx` | Evidencia previa al PR junto al resultado de un pane libre. No afirmar que Nest carece de revisión u orquestación. |
| Identidad de worktree y agrupación por repo | `src/lib/worktree-path.ts`, `electron/integrations/team-thread-worktrees.ts` | Mostrar la concurrencia sobre el mismo checkout sin inferir autoría de cada archivo. No encontré esa presentación en las superficies revisadas; no equivale a auditar todo el producto. |

## Ocho propuestas, una pantalla por idea

### M1 — Context receipt

**Problema:** al cambiar de agente no sabemos si recibió la decisión actual o solamente vio su título. [Pantalla](memory-receipt.html).

Una tira discreta «2 retrieved · 1 saved» abre el recibo de la sesión. Separa índice, registro completo y guardado; muestra fuente, rama y revisión. «Retrieved» es verificable; «used» no lo es sin evidencia adicional. El ejemplo muestra el registro completo de Geist y otro del que sólo llegó el índice.

**Qué falta:** evento de lectura atribuido a sesión/pane, ID y revisión realmente devueltos, nivel de detalle y momento; evento de guardado equivalente. En los caminos de lectura inspeccionados no hay un recibo durable listo para esta UI. No reconstruirlo a partir de menciones en texto del terminal. Para lecturas sin pane conocido: «External session», sin atribuirlas a otro agente. Los totales deben usar el mismo intervalo y explicar si cuentan registros o llamadas. La propuesta cuenta registros distintos por sesión.

**Dificultad de copia:** media si se integra bien, baja para el panel aislado. Warp/Cursor pueden construir recibos de sus agentes; la oportunidad de Nest es una misma trazabilidad entre varias CLIs y el historial del proyecto. Ghostty/iTerm2 necesitarían esa integración o podrían conectarse al MCP de Nest. El protocolo abierto facilita también a competidores; el valor está en la continuidad y calidad del historial, no en encerrar datos.

**Riesgo:** falsa confianza. Una memoria devuelta puede ser ignorada, truncada o estar fuera de contexto. Mostrar esos límites en el recibo.

### M2 — Recall in place

**Problema:** consultar una decisión corta el flujo y obliga a copiar desde otra pantalla. [Pantalla](memory-recall.html).

Extender la command palette existente con búsqueda de Memories, fuente y previsualización. El pie fija «Target: 02 · Codex · feat/sidebar» y prepara una inserción editable. No manda el texto ni pulsa Enter. Para sesiones ajenas o compartidas se conservan las reglas de acceso existentes. No convertir la búsqueda local en compartir con el equipo.

**Qué falta:** proveedor de resultados en la palette y un flujo explícito para preparar contexto. Reutilizar búsqueda y lectura; limitar al proyecto activo por defecto, ofrecer globales de manera visible y pedir el cuerpo sólo al seleccionar. Si el pane se cerró o cambió de tarea, volver a elegir destino. Sin resultados: «No matching memories», con salida al buscador completo; error de lectura separado de vacío.

**Dificultad de copia:** baja en los cuatro competidores. No vender ⌘K como una defensa. La ventaja es que el mismo registro conserva procedencia y destino entre agentes; depende del almacén compartido que sustenta M1/M4. Es una mejora de uso de alto valor aunque sea fácil de copiar.

**Riesgo:** adjuntar al pane incorrecto o demasiados datos. Vista previa, destino visible y selección de un registro antes de preparar.

### M3 — Decision beside the question

**Problema:** el agente vuelve a preguntar algo ya decidido y el usuario debe recordar dónde se guardó. [Pantalla](memory-decision.html).

Junto a una pregunta aparece una decisión candidata con motivo, autor, rama y vigencia. «Possible match» evita presentar similitud como verdad. La persona compara contexto y prepara la respuesta; no hay autoaprobación.

**Qué falta:** un disparador explícito «Find related decision» es suficiente para un primer alcance. La sugerencia automática necesita una señal confiable de pregunta, recuperación relevante y evaluación de falsos positivos; el estado `waiting` por sí solo no alcanza. Releer el registro al preparar: si cambió, mostrar la nueva versión; si está superseded, ofrecer la vigente; si desapareció, retirar la sugerencia.

**Dificultad de copia:** media sólo si combina versiones, contexto de rama y correcciones acumuladas entre agentes. Warp/Cursor ya tienen mecanismos de contexto y pueden hacer recomendaciones similares; iTerm2 ya puede observar sesiones. La tarjeta es fácil. La precisión y trazabilidad del corpus son la parte que lleva trabajo.

**Riesgo:** una decisión correcta para main puede ser incorrecta para una exploración. Permitir descartar, sin editar ni promover memoria de forma automática.

### M4 — Branch brief

**Problema:** abrir una rama no explica qué aprendió el otro agente ni qué cambió desde la última visita. [Pantalla](memory-branch.html).

Panel de la rama activa con decisiones, preguntas abiertas y marcador de novedades. Abre el hilo completo que Nest ya produce. Es lectura de un artefacto existente, no un segundo sistema de conversación.

**Qué falta:** acceso desde el workspace, selección contextual de rama y cursor local de última lectura. El brief usa exclusivamente los registros de equipo elegibles que ya filtra `eligibleTeamThreadRecords`. No promover notas privadas para «completar» el resumen. Hilo apagado, sin rama, error y rama sin entradas son estados diferentes.

**Dificultad de copia:** media. Warp/Cursor pueden sumar briefs; Ghostty/iTerm2 pueden abrir las notas exportadas. Lo que cuesta reconstruir es el hilo coherente entre autores, ramas, revisiones y cierres a lo largo del trabajo real. Los enlaces a evidencia deben sobrevivir al cambio de agente.

**Riesgo:** mezclar lo privado con lo compartido o esconder decisiones antiguas relevantes. El filtro Team only queda visible y siempre existe acceso al hilo completo.

### M5 — Memory health

**Problema:** «no recordó» puede significar memoria deshabilitada, bridge sin sesión, lectura fallida o cloud offline; hoy hay que salir del trabajo para distinguirlos. [Pantalla](memory-health.html).

Una línea global abre cuatro estados separados: almacén local, bridge por pane, escrituras observadas si existen y sincronización. El boceto no muestra escrituras observadas porque no aporta un evento que las pruebe. Cloud offline no bloquea una lectura local disponible.

**Qué falta:** presentar los hooks/estados existentes en el workspace y hacer visible qué se midió. Durante carga usar «Checking»; durante la gracia de conexión «Starting», no afirmar «Writing». Deshabilitado voluntario es neutral. Un problema de bridge dirige a inspeccionar esa conexión, no a reconectar la cuenta o cambiar settings sin diagnóstico.

**Dificultad de copia:** baja. Los cuatro pueden mostrar estado; Nest puede hacerlo más útil con un diagnóstico común a sus CLIs, almacenamiento local y sincronización. Es infraestructura de confianza, no una barrera competitiva por sí sola.

**Riesgo:** fatiga de avisos y falsos verdes. Mostrar degradación sostenida con la gracia existente y distinguir falta de señal de fallo confirmado.

### M6 — First real reuse

**Problema:** el tour promete continuidad, pero el usuario puede no presenciarla nunca. [Pantalla](memory-first-reuse.html).

Después de una recuperación completa real en otra sesión, una tarjeta enlaza «Claude saved» con «Codex retrieved», la decisión y su recibo. No dice «applied», no inventa minutos ahorrados y no interrumpe la terminal. El ejemplo está rotulado como dato de muestra en la barra de revisión.

**Qué falta:** M1, criterio persistente para mostrarlo una sola vez y dismiss. Antes de que ocurra, el onboarding puede invitar a guardar una decisión real; no sembrar datos falsos ni mostrar éxito por abrir otra terminal. Si sólo se recuperó el índice, esperar la lectura completa.

**Dificultad de copia:** baja para la tarjeta, media para probar el cruce de agentes con fuentes. Warp/Cursor pueden reproducir el patrón; las terminales pueden hacerlo mediante una integración. La ventaja se demuestra con un historial ya útil, no con una animación.

**Riesgo:** celebrar una lectura inútil. Medir apertura del recibo y continuidad posterior, no cantidad bruta de memorias guardadas.

### W1 — Result with evidence

**Problema:** un agente callado o un pane con salida nueva no indica que el cambio sea revisable. [Pantalla](workspace-evidence.html).

Al lado del resultado: archivos cambiados, pruebas y build con el snapshot comprobado, revisión pendiente y decisión relacionada. El ejemplo muestra un build exitoso que quedó desactualizado por cambios posteriores. Acceso a diff y preparación de handoff reutiliza las capacidades existentes.

**Qué falta:** asociar evidencias verificables al árbol de trabajo exacto, no sólo a HEAD, porque puede haber cambios sin commit. Conservar comando, exit code, timestamp y referencia al resultado; aceptar «Not run» y «Unknown». El agente puede aportar una nota, pero se distingue de evidencia observada. No agregar merge automático.

**Dificultad de copia:** baja para diff/tests, media para enlazar evidencia y decisiones entre agentes durante un handoff. Cursor/Warp compiten directamente aquí; iTerm2 tiene herramientas de orquestación; Ghostty puede hospedar CLIs que produzcan estos artefactos. No es una categoría exclusiva de Nest.

**Riesgo:** resultados viejos. Si el árbol cambia, marcar la evidencia como stale y no pintar el trabajo como aprobado. Recomendación: explorar después de hacer visible Memories, no construir otro panel de PR.

### W2 — Shared worktree awareness

**Problema:** dos agentes pueden trabajar en el mismo checkout sin que la persona lo advierta. [Pantalla](workspace-ownership.html).

Lista de panes que comparten la ruta canónica y sus tareas. Las fronteras «header» y «sidebar» son notas declaradas, no autoría inferida. Comparar cambios ayuda a decidir quién continúa. No se pausa, bloquea ni mata ninguna sesión.

**Qué falta:** superficie de concurrencia usando la identidad existente de worktree, con normalización coherente. Git status muestra cambios del checkout, no quién los produjo. Sin telemetría atribuible no decir «Claude edits file X». Agentes en worktrees distintos que tocan el mismo archivo son otro riesgo: no llamarlos «shared checkout».

**Dificultad de copia:** baja para detectar rutas, media para conservar responsabilidades y acuerdos por rama usando Memories. Warp/Cursor pueden hacerlo; Ghostty/iTerm2 podrían integrar una vista equivalente. El valor diferencial sería convertir un acuerdo de trabajo en contexto recuperable por el siguiente agente, no un candado visual.

**Riesgo:** advertencias ruidosas en colaboración intencional. Mostrar como información de coordinación, con opción de declarar el reparto, sin sugerir conflicto confirmado.

## Comparación: qué se puede defender honestamente

No hay evidencia para afirmar que «nadie lo puede copiar fácil». Los cuatro productos evolucionan y varias piezas ya existen. Estas son las bases documentadas consultadas, no una auditoría de todas sus capacidades:

- **Cursor:** reglas de proyecto, usuario y equipo aportan contexto persistente y reutilizable. No presentar «recordar instrucciones» como algo exclusivo. [Documentación oficial de Rules](https://cursor.com/docs/rules).
- **Warp:** AI Objects incluye reglas y servidores MCP para herramientas y fuentes externas. Nest no gana por tener un panel de contexto ni por usar MCP. [Documentación oficial de AI Objects](https://docs.warp.dev/knowledge-and-collaboration/warp-drive/ai-objects/).
- **iTerm2:** AI Chat admite chats ligados a sesiones y orquestación sobre varias sesiones, bajo permisos. No describirlo como una terminal sin IA ni atribuir a Nest exclusividad de observar agentes. [Documentación oficial de AI Chat](https://iterm2.com/documentation-ai-chat.html).
- **Ghostty:** documenta ventanas, tabs, splits y protocolos para aplicaciones de terminal. Eso no prueba ausencia de memoria mediante CLIs o integraciones. [Documentación oficial de features](https://ghostty.org/docs/features).

**Inferencia de producto:** la defensa potencial es una combinación operativa: memoria portable y con fuentes, relaciones entre decisiones, revisiones y ramas, continuidad entre agentes y diagnóstico de fallos. Su valor crece con el uso correcto y con integraciones fiables. La UI es copiable; el historial útil toma tiempo. El MCP y la exportación son ventajas de portabilidad, pero también reducen la exclusividad de la interfaz Nest.

## Orden recomendado y criterio de éxito

1. **A1 + H1 + S1**, más **M2 + M5**: resolver orientación, recuperación y confianza usando bases existentes. Medir tiempo hasta localizar una decisión y preparar el contexto correcto; errores de destino; casos en que el diagnóstico distingue bridge de cloud. Sin prometer porcentajes de ahorro.
2. **M1 + M4**: recibos atribuibles y brief de rama. Primero definir eventos y revisiones; después los contadores. Medir registros con procedencia completa, lecturas atribuibles y uso del brief durante handoffs.
3. **M3 + M6**: sugerencias y primera recuperación real, apoyadas en evidencia de M1. Medir falsos positivos y descartes. No autoenviar respuestas.
4. **W1 + W2**: validar con sesiones paralelas reales. W2 puede tener un alcance inicial pequeño; W1 requiere una definición sólida de evidencia y snapshot para no crear confianza falsa.

No sumaría todos los paneles a la vez. Un único dock contextual admite receipt, branch brief o evidence según la acción; M2 aparece a demanda; M5 vive en la barra inferior. No convertir Memories en un feed de actividad permanente ni añadir otro grafo a las terminales: el workspace dedicado ya cubre exploración profunda.
