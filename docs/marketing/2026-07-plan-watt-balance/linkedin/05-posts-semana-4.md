# LinkedIn — Semana 4 (27–31 jul): Modelo + visión

> 3 posts estáticos + 2 carruseles. Listos para pegar. Autor: Gero, primera persona.

---

## Lunes 27 — POST 10 · Opinión: no revendemos tokens (modelo de costos)

**Asset**: ninguno obligatorio (post de texto).

```
Nuestro costo por usuario es casi cero. Y no es un truco: es una decisión de diseño.

Cuando les cuento el modelo de Nest a otros founders, la reacción suele ser la misma: "¿cómo que no revenden tokens?".

La mayoría de las herramientas de IA para devs funciona así: vos pagás la suscripción, ellos pagan la inferencia, y su margen vive en la diferencia. Eso los mete en una tensión fea: cada prompt tuyo les cuesta plata, así que tienen incentivos para limitarte el uso, degradar el modelo por atrás, o subirte el precio cuando la cuenta no cierra.

En Nestmux cada dev usa sus propias API keys y sus propias suscripciones de CLI. Claude, Gemini, Codex, Copilot: tu cuenta, tu facturación, tu relación directa con el proveedor.

Lo que pagás en Nest (Pro a $20/mes, Team a $35 por seat) es por el workspace: la grilla de hasta 12 paneles, worktrees desde la UI, broadcast, diff viewer, terminal sharing. No por tokens con markup.

Consecuencias prácticas:

→ Nunca vamos a degradarte el modelo para cuidar nuestro margen. No hay margen de inferencia que cuidar.
→ Si mañana sale un modelo mejor, lo usás mañana. No dependés de que lo integremos a nuestra facturación.
→ Nuestros incentivos apuntan a una sola cosa: que el workspace te sirva tanto que quieras pagarlo.

Creo que en un par de años este va a ser el modelo estándar de las herramientas de IA para devs. Hoy todavía es la excepción.

El plan Free no vence nunca: nestmux.com

#DevTools #SaaS #AIAgents
```

---

## Martes 28 — CARRUSEL 7 · 12 paneles, 11 layouts: cómo ordeno el caos

**Texto del post:**

```
12 terminales abiertas suena a caos. Con el layout correcto, es una línea de montaje.

La pregunta escéptica que más recibo: "¿quién puede prestarle atención a 12 paneles a la vez?". Respuesta: nadie. Y no se trata de eso.

Se trata de que la atención vaya rotando según el momento del día, y de que el layout acompañe esa rotación sin que tengas que reiniciar nada. Para eso hay 11 layouts de tiling y un atajo: Ctrl+L.

Mi sistema completo para no volverme loco, slide por slide. Probalo: nestmux.com

#DevTools #Productividad
```

**Guion slide por slide (9 slides):**

1. **12 paneles sin volverte loco** — "Layouts, atajos y el sistema que uso para orquestar agentes sin perder la cabeza." *(portada)*
2. **Primero, lo obvio** — "No mirás 12 paneles a la vez. Igual que un DJ no escucha 12 canales a la vez: mezcla. El layout es tu mixer."
3. **Ctrl+L: el atajo que ordena todo** — "Cicla entre 11 layouts de tiling sin reiniciar ninguna sesión. Los agentes siguen laburando mientras vos reorganizás la vista."
4. **Layout de mañana: la grilla pareja** — "Todos los paneles del mismo tamaño. Modo supervisión: un vistazo y sabés el estado de cada agente."
5. **Layout de trabajo profundo: uno grande, resto chicos** — "Cuando un problema requiere TU atención, ese panel se agranda y el resto queda de reojo. Los demás agentes no se enteran."
6. **Workspaces guardados** — "Tu combinación de paneles + layout + entorno, guardada. Mañana a la mañana: un click y está todo como lo dejaste."
7. **Spotlight para no buscar a mano** — "¿12 paneles y no sabés en cuál estaba aquello? Spotlight: buscás, saltás. Como el del sistema operativo, pero adentro de tu workspace."
8. **Snippets para lo repetido** — "Los prompts y comandos que escribís 10 veces por día, guardados y listos para disparar. Menos tipeo, menos errores."
9. **CTA** — "Free: 3 paneles para arrancar. Pro: los 12 + todo lo de este carrusel. nestmux.com" *(URL grande)*

**Indicaciones visuales:**
- Slide 2: metáfora visual del mixer de DJ (simple, esquemática, no stock photo).
- Slides 3–5: screenshots reales del MISMO workspace en layouts distintos, para que se note que las sesiones no cambian (mismo contenido en los paneles).
- Slide 6–8: screenshots con highlight del elemento (selector de workspace, Spotlight abierto, panel de snippets).
- Serie visual consistente con los carruseles anteriores (fondo oscuro, acento de marca).

---

## Miércoles 29 — POST 11 · Opinión: la capa neutral (ningún modelo gana en todo)

**Asset**: opcional, screenshot de una grilla con Claude, Gemini, Codex y Copilot corriendo a la vez.

```
Elegir "el mejor modelo" es la pregunta equivocada. La pregunta es cuál para qué tarea.

Cada semana sale un benchmark nuevo coronando a un modelo distinto. Y cada semana veo equipos re-discutiendo su "estandarización": ¿nos casamos con Claude? ¿con Codex? ¿con Gemini?

Después de un año corriendo todos a diario, mi respuesta es: con ninguno. Y con todos.

En la práctica los modelos tienen personalidades. Uno es mejor para refactors largos con mucho contexto. Otro para explicar código ajeno. Otro para tareas mecánicas a alta velocidad. Y eso además cambia con cada release: la tabla de posiciones de hace 3 meses ya no sirve.

Casarte con un solo proveedor de IA en 2026 es como haberse casado con un solo browser en 2005: una decisión que se toma por comodidad y se paga por años.

Por eso Nestmux es deliberadamente neutral. No tenemos un modelo propio ni comisión por ninguno: Claude, Gemini, Codex, Copilot y OpenCode corren lado a lado, cada uno con tu propia cuenta. Si mañana aparece un modelo mejor, tu workspace no cambia: cambia lo que corre adentro de un panel.

Las herramientas pasan. Los workflows quedan. Nosotros elegimos construir el workflow.

¿Tu equipo se estandarizó en un solo modelo o usa varios? ¿Y quién tomó esa decisión: los devs o el presupuesto? Los leo.

#AIAgents #DevTools #EngineeringManagement
```

---

## Jueves 30 — CARRUSEL 8 · Free vs Pro, sin humo: qué desbloquea cada plan

**Texto del post:**

```
Te muestro exactamente qué hace el plan Free y dónde está el techo. Sin letra chica.

Odio los pricing pages que te enterás de las limitaciones cuando ya estás adentro. Así que acá va el desglose honesto de Nestmux: qué tenés gratis para siempre, qué desbloquea Pro, y para quién es cada cosa.

Spoiler: si trabajás con UN agente a la vez, probablemente el Free te alcance. Y está bien.

Empezá por el Free y decidí después: nestmux.com

#DevTools #AIAgents
```

**Guion slide por slide (9 slides):**

1. **Free vs Pro, sin humo** — "El desglose honesto de qué incluye cada plan de Nestmux. Incluyendo lo que NO." *(portada)*
2. **Free: $0, para siempre** — "No es un trial disfrazado. No vence, no pide tarjeta, no se degrada a los 14 días."
3. **Qué trae el Free** — "3 paneles simultáneos con TODAS las AIs: Claude, Gemini, Codex, Copilot, OpenCode, terminal plana. El núcleo del producto, completo."
4. **Dónde está el techo** — "El techo es el paralelismo y el tooling alrededor: sin broadcast, sin worktrees desde la UI, sin diff viewer, sin My Repos, sin workspaces guardados, sin voice, sin Spotlight."
5. **Pro: $20/mes (o $180/año, sale $15/mes)** — "Para el dev que orquesta: 12 paneles, Broadcast Mode, worktrees desde la UI, diff viewer, My Repos con GitHub y GitLab, workspaces, snippets, Spotlight, voice input."
6. **¿Free o Pro? La pregunta clave** — "¿Cuántos agentes corren en paralelo en tu día normal? ¿1? Free. ¿3 o más, en features distintas? Pro se paga solo con el primer conflicto de branch que evitás."
7. **¿Y para equipos?** — "Team: $35/seat/mes (mínimo 2). Todo lo de Pro + workspace de equipo y terminal sharing en vivo por código. Enterprise: sales-led, con demo."
8. **Nuestro modelo, en una línea** — "No revendemos tokens: usás tus propias API keys. Pagás por el workspace, no por inferencia con markup."
9. **CTA** — "Arrancá por el Free y subí solo si lo necesitás: nestmux.com" *(URL grande)*

**Indicaciones visuales:**
- Slides 3–5: tabla/checklist visual con ✓ y ✗ (los ✗ del Free bien visibles, la honestidad es el gancho del carrusel).
- Slide 6: árbol de decisión mínimo (1 pregunta → 2 flechas).
- Slide 7: dos cards compactas (Team / Enterprise), sin saturar de texto.
- Precios en tipografía grande, siempre los reales: $0 / $20 / $180 anual / $35 seat.

---

## Viernes 31 — POST 12 · Cierre de mes: construir en público, números reales

**Asset**: opcional, captura del gráfico de analytics de LinkedIn del mes (impresiones/seguidores).

```
Un mes posteando en público. Estos son los números, incluso los que no me gustan.

Hace 4 semanas arranqué a publicar acá con cadencia real: 3 posts y 2 carruseles por semana, contando cómo construimos Nest. Este es el cierre honesto del mes 1.

Lo que ya sabíamos y confirmé:
→ El contenido que mejor funciona es demostración, no publicidad. Los posts mostrando el producto andando y los números reales le ganan por paliza a cualquier post "de marca".
→ Contar los números incómodos (90 usuarios, ~$180 de MRR) generó más conversaciones privadas con gente relevante que cualquier post optimista.

Lo que me sorprendió:
→ La objeción #1 en comentarios y DMs sigue siendo "¿no es lo mismo que Cursor?". El post donde la respondí de frente fue de los que más conversación real trajo. Nota mental: responder objeciones en público, siempre.
→ EMs y tech leads escriben por DM, no comentan. El engagement visible subestima lo que pasa abajo del agua.

Lo que viene en el mes 2:
→ Misma cadencia. Los números de tracción actualizados, suban o bajen.
→ Más casos de uso de equipo: ahí está el 82,7% de devs que no ve mejoras de colaboración con IA, y ahí apuntamos.

Gracias a los que comentaron, compartieron y sobre todo a los que probaron Nestmux y reportaron cosas rotas. Eso último vale oro.

Pregunta para cerrar el mes: ¿qué parte de cómo trabajamos con agentes te gustaría que muestre en detalle en agosto? Los leo en comentarios.

#BuildInPublic #DevTools #AIAgents
```
