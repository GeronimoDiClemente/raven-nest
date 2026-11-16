# Nest — Ronda 3: movimiento con significado

Abrir [index.html](index.html). Cinco HTML con animación real (Web Animations API), sobre los panes y headers de32px de la entrega corregida. UI en inglés. Cada pantalla reproduce una secuencia al abrir; Replay la repite, Pause la detiene y Repeat preview habilita un ciclo opcional de6 segundos. La galería es estática para no ejecutar cinco animaciones fuera de vista.

| Idea | Qué comunica | Presupuesto por evento | Riesgo |
|---|---|---|---|
| [D1 · Working](working.html) | Actividad sin inventar porcentaje | 3 puntos de3px, transform/opacity, 3 repeticiones escalonadas, termina antes de3.6s | Ruido si se anima en todos los panes. Recomiendo sólo el pane enfocado. |
| [D2 · Needs you](needs-you.html) | Apareció una necesidad de atención | Un chip, 520ms, translateY4px + scale.96→1 + opacity | No convertir waiting inferido en petición confirmada. |
| [D3 · Unread](unread.html) | Hay salida nueva para leer | Un chip, 420ms, translateY−3px + opacity | Unread no significa éxito ni pruebas aprobadas. |
| [D4 · Memory receipt](memory.html) | La sesión recibió una memoria completa | Una línea en footer reservado, 640ms, translateX−8px + opacity | Requiere atribución observable; recuperar no demuestra aplicar. |
| [D5 · Pane arrival](pane.html) | Una identidad ocupa el próximo hueco | Sólo header, 320ms, translateY−4px + opacity | El prototipo reserva el hueco. La inserción real tiene costo de layout, aunque no se anime. |

## Qué elegiría

D2 + D3 como base: cambios breves que llaman la atención una sola vez y dejan un estado estático legible. D4 suma el diferencial de Memories cuando existan recibos por sesión. D1 sólo en el pane activo; D5 opcional, después de medir el costo de insertar panes reales. No añadir rebotes, barridos luminosos, partículas ni pulsos sobre el borde completo.

D5 representa la llegada mediante la cabecera; no simula ni implementa el nacimiento de un PTY. El hueco y el contenido de terminal son estables en el HTML. En producción se inserta el pane una vez y se anima únicamente su identidad, sin interpolar dimensiones del grid ni escalar la terminal.

## Costo y batería

Los presupuestos de la tabla son límites de duración y cantidad de elementos, **no mediciones de CPU, GPU, FPS o batería**. Sólo se animan transform y opacity; no color, sombras, filtros, dimensiones ni texto del terminal. El browser decide la composición: esto reduce la probabilidad de repintados costosos, no garantiza cero pintura en cualquier GPU. La aparición inicial y cambios de texto/clase sí tienen un costo puntual de pintura/layout.

No hay requestAnimationFrame, intervalos ni polling. Sin Repeat no se agenda ningún timer de repetición. Repeat usa un único timeout de6s que se cancela al ocultar la página, pausar o activar movimiento reducido. No hay will-change permanente ni fill forwards que mantenga capas después del efecto. Se cancelan animaciones anteriores antes de cada replay.

`visibilitychange` pausa las animaciones WAAPI en curso y elimina el timer. Al volver a visible reanuda el momento pendiente sin recuperar ciclos perdidos. Esto sigue el criterio de `src/lib/intervalo-visible.ts`: visibilidad, no foco. El prototipo usa visibilityState del documento; la integración Electron debería usar el gate de visibilidad ya existente en Nest, porque ocultación por otras ventanas y minimización dependen de la plataforma.

`prefers-reduced-motion: reduce` muestra directamente el estado final y no crea animaciones ni timers. También responde si la preferencia cambia con la página abierta. El checkbox Reduce motion permite probarlo localmente y nunca puede anular una preferencia reducida del sistema. La información se expresa en texto persistente, no depende del movimiento.

## Integración propuesta

- D1: estado working + pane enfocado + ventana visible. No animar un heartbeat por cada token.
- D2: transición a waiting, una sola vez; conservar la semántica actual de pane-state.
- D3: transición de leído a unread, no cada chunk de salida. Al leer, quitar el chip sin una celebración adicional.
- D4: evento de lectura completa con pane/session, ID y revisión devueltos. No disparar por un título del índice ni por una mención en el transcript.
- D5: alta real del pane; el layout se resuelve una vez. Sin desplazamiento animado de terminales existentes.

No conectar los ciclos de demostración con datos reales: el loop sirve para revisar el efecto. Los hechos de producto deben actualizarse aunque se pause el adorno. La pausa cosmética no debe retrasar notificaciones ni estados reales.

## Validación y reproducción

Desde el repo:

```sh
node design/codex/delight/build.cjs
node design/codex/delight/verify.cjs
```

Build local sin dependencias nuevas. Playwright usa Chrome instalado. Se comprueban seis páginas offline, enlaces y logos, headers de32px, overflow del documento, movimiento real, propiedades de los keyframes, pausa de tiempos de animación y cancelación de timer al simular documento oculto, pausa manual, preferencia reducida del sistema y control manual, y texto del terminal sin cambios. [Resultados](verification.json). Una [captura de Memories](review-memory.png) sirve para revisar la piel; para ver movimiento abrir el HTML.

No se midió ahorro energético ni se verificó ocultación nativa de macOS. No se ejecutó build de Electron: sólo se autorizó escribir en design/codex/. La entrega reutiliza la base derivada de Superdesign y agrega comportamiento determinista propio; no hizo falta otra generación remota ni gastar créditos. No son cambios al producto, ni una afirmación de exclusividad frente a otras terminales.
