# LinkedIn — Semana 2 (13–17 jul): Casos de uso en profundidad

> 3 posts estáticos + 2 carruseles. Listos para pegar. Autor: Gero, primera persona.

---

## Lunes 13 — POST 4 · "Cómo trabajo yo": Broadcast Mode para comparar modelos

**Asset**: video corto o GIF (15-30s) de Broadcast Mode: escribir un prompt una vez y verlo aparecer en 3 paneles (Claude, Gemini, Codex) simultáneamente.

```
Dejé de discutir qué modelo es mejor. Ahora les mando el mismo prompt a los tres y que se peleen.

Cada vez que tengo un problema donde no confío ciegamente en la primera respuesta (una migración delicada, un refactor con muchas aristas, un bug que no entiendo), hago esto:

1. Abro tres paneles: Claude, Gemini, Codex.
2. Activo Broadcast Mode.
3. Escribo el prompt UNA vez. Les llega a los tres.
4. Comparo los tres enfoques lado a lado.

Lo que aprendí haciendo esto casi a diario:

→ Muy pocas veces los tres coinciden. Y cuando coinciden, es una señal fuerte de que el enfoque es sólido.
→ Cuando divergen, la divergencia en sí es información: me muestra los trade-offs que yo no había visto.
→ El "segundo mejor" modelo para una tarea suele encontrar el caso borde que el "mejor" se comió.

No es redundancia, es verificación cruzada. El mismo principio que usamos con code review humano, aplicado a agentes.

Broadcast Mode es parte del plan Pro de Nestmux. Si querés verlo andando: nestmux.com

#AIAgents #DevTools #DesarrolloDeSoftware
```

---

## Martes 14 — CARRUSEL 3 · Tutorial Broadcast Mode: un prompt, N agentes

**Texto del post:**

```
Un prompt. Tres agentes. Tres soluciones para comparar en 2 minutos.

Broadcast Mode es probablemente la feature de Nestmux que más sorprende en las demos, y la más simple de explicar: escribís una vez, les llega a todos los paneles que elijas.

Los casos de uso reales van bastante más allá de "comparar modelos". En el carrusel: el paso a paso y 3 usos que quizás no se te ocurrieron.

Probalo con tu propio flujo: nestmux.com

#AIAgents #DevTools
```

**Guion slide por slide (9 slides):**

1. **Broadcast Mode: un prompt, N agentes** — "El tutorial completo en 7 pasos. Y 3 usos que no son los obvios." *(portada)*
2. **Qué es** — "Un modo de Nestmux donde lo que escribís se envía a varios paneles a la vez. Cada agente lo recibe en su propia sesión, con su propio contexto."
3. **Paso 1 — Armá la mesa** — "Abrí los paneles que quieras: Claude, Gemini, Codex, Copilot, OpenCode. Hasta 12 en la grilla. Para empezar, con 3 alcanza."
4. **Paso 2 — Activá Broadcast** — "Un toggle. Los paneles incluidos quedan marcados. Podés dejar paneles afuera (tu terminal plana, por ejemplo)."
5. **Paso 3 — Escribí una sola vez** — "El prompt sale a todos los paneles seleccionados al mismo tiempo. Sin copy-paste, sin alt-tab."
6. **Uso obvio: comparar modelos** — "Mismo problema, tres enfoques. Si coinciden, confianza. Si divergen, acabás de descubrir los trade-offs."
7. **Uso 2: mismo modelo, contextos distintos** — "Tres paneles de Claude sobre tres worktrees distintos. Un solo broadcast: 'corré los tests y reportá'. Status de todo el trabajo paralelo en un comando."
8. **Uso 3: setup masivo** — "Instrucciones de arranque para todos los agentes a la vez: 'leé el CLAUDE.md, no toques migraciones, tests antes de commitear'. Una vez, no cinco."
9. **CTA** — "Broadcast Mode viene con el plan Pro ($20/mes). Descargá y probá el resto gratis: nestmux.com" *(URL grande)*

**Indicaciones visuales:**
- Slide 2: screenshot de la grilla con el input de broadcast resaltado y flechas hacia 3 paneles.
- Slides 3–5: screenshots reales numerados, con el elemento de UI relevante en highlight.
- Slides 6–8: mini-diagramas (1 caja "prompt" → 3 cajas "agente") con etiqueta de cada caso de uso; mantener el mismo esquema visual variando solo las etiquetas.
- Estética terminal oscura consistente con el carrusel 1.

---

## Miércoles 15 — POST 5 · Posicionamiento vs Cursor: complementarios

**Asset**: ninguno obligatorio. Opcional: screenshot de Nestmux con un panel corriendo un agente sobre un repo que también está abierto en Cursor (si se hace, que sea honesto y real).

```
"¿Y esto no es lo mismo que Cursor?" Me lo preguntan todas las semanas. No. Y está bien que no.

La respuesta corta: no somos lo mismo. Somos complementarios.

La respuesta larga:

Cursor es un editor. Vivís adentro escribiendo código, con la IA asistiéndote a VOS. Es excelente en eso.

Nestmux es un multiplexor de terminal para agentes. Es el lugar donde corrés y supervisás a los agentes que trabajan SOLOS: Claude Code, Gemini, Codex, Copilot CLI, cada uno en su panel, con su sesión, su cuenta y su entorno.

Son dos momentos distintos del mismo día:

→ Cuando el que escribe sos vos, con asistencia: editor.
→ Cuando delegaste el trabajo y tu rol es orquestar y verificar: Nestmux.

De hecho, buena parte de nuestros usuarios usa Cursor. Yo mismo tengo el editor abierto en un monitor y Nestmux en el otro. No compiten por el mismo lugar en tu flujo: compiten por momentos distintos de tu atención.

El mercado de herramientas de IA para devs no es un torneo de eliminación directa. Es un stack. Y elegís cada capa por separado.

¿Ustedes cómo tienen repartido el stack hoy? Editor con IA, agentes en terminal, ¿ambos? Me interesa leer setups reales.

#DevTools #AIAgents #Cursor
```

---

## Jueves 16 — CARRUSEL 4 · Port detection: del prompt al browser sin salir de la app

**Texto del post:**

```
Tu agente levantó un dev server. ¿En qué puerto? Nestmux ya lo sabe.

Es una feature chica que resuelve una molestia enorme del trabajo con agentes: le pedís "levantá el proyecto y probá el login", el agente ejecuta, y ahora vos tenés que adivinar en qué puerto quedó escuchando… si el proceso no se re-parentó en el camino.

En Nestmux cada panel muestra un chip con el puerto que escucha su proceso. Click en el chip → se abre el browser adentro de la app, apuntando ahí.

El flujo completo, slide por slide. Demo en nestmux.com

#DevTools #AIAgents
```

**Guion slide por slide (8 slides):**

1. **Del prompt al browser, sin salir de la app** — "Port detection por panel: la feature chica que más uso por día." *(portada)*
2. **La escena** — "Le pedís al agente: 'levantá el dev server y arreglá el bug del login'. El agente lo hace. Ahora empieza tu mini-búsqueda del tesoro."
3. **El problema real** — "¿Puerto 3000? ¿5173? ¿El agente usó otro porque el default estaba ocupado? Peor: muchos dev servers se re-parentan y el proceso ya ni es hijo de tu terminal."
4. **Lo que hace Nestmux** — "Cada panel detecta qué puerto escucha su proceso, incluso si fue lanzado por el agente y se re-parentó. Aparece como un chip en el panel."
5. **Click en el chip** — "Se abre un Browser cell adentro de Nestmux, apuntando a ese puerto. Tu app corriendo, al lado del agente que la levantó."
6. **Por qué importa** — "Verificás lo que hizo el agente en el momento, con la salida del agente y la app a la vista en la misma grilla. Sin alt-tab, sin adivinar URLs."
7. **Bonus: varios servers a la vez** — "3 worktrees, 3 agentes, 3 dev servers. Cada panel con su chip, cada uno abrible en su Browser cell. Cero confusión de cuál es cuál."
8. **CTA** — "Probalo con tu proyecto: nestmux.com" *(URL grande)*

**Indicaciones visuales:**
- Slide 3: ilustración de terminal con "???" sobre varios puertos posibles.
- Slide 4: screenshot real con zoom fuerte al chip de puerto (esta imagen es LA imagen del carrusel, que sea nítida).
- Slide 5: screenshot del Browser cell abierto junto al panel del agente.
- Slide 7: grilla con 3 paneles + 3 chips visibles, cada uno con un highlight de color distinto.

---

## Viernes 17 — POST 6 · La señal del VP de Huawei

**Asset**: ninguno (post narrativo). NO mostrar el DM real ni nombre de la persona.

```
Antes de lanzar, me escribió por DM un VP de Huawei. No lo busqué yo.

Todavía no habíamos lanzado en Product Hunt. Nestmux era un producto que estábamos mostrando en público mientras lo construíamos, nada más. Y un día, mensaje directo: un VP de Huawei, interesado en lo que estábamos armando.

No les voy a vender que eso se convirtió en un contrato. No (todavía). Pero me dejó dos aprendizajes que aplican a cualquiera construyendo un producto dev:

1. Construir en público funciona como canal enterprise. No hicimos outbound, no teníamos deck, no teníamos ni pricing enterprise cerrado. El contenido mostrando el producto real hizo el trabajo que ningún cold email hace: llegó solo a alguien con presupuesto y un problema.

2. Las señales llegan antes de que estés listo. Ese DM nos obligó a hacernos preguntas de empresa grande (proceso de venta, seguridad, soporte) cuando éramos cuatro personas con una app. Incómodo, pero es la mejor clase de incómodo.

El problema que resolvemos (equipos corriendo múltiples agentes de IA en paralelo, sin una capa común para orquestarlos) existe igual en un equipo de 4 y en uno de 4.000. La diferencia es quién te escribe primero.

¿Alguien más construyendo en público recibió señales enterprise que no salió a buscar? Me interesa saber si es patrón o suerte. Los leo.

#BuildInPublic #Enterprise #DevTools
```
