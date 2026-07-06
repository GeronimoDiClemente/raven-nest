# LinkedIn — Semana 1 (6–10 jul): Presentación + datos propios

> 3 posts estáticos + 2 carruseles. Listos para pegar. Autor: Gero, primera persona.

---

## Lunes 6 — POST 1 · Origen: por qué construimos Nestmux

**Asset**: screenshot de Nestmux con 4-6 paneles activos (Claude, Gemini, Codex visibles a la vez). Que se lea que son AIs distintas.

```
Nestmux no nació de un pitch deck. Nació de un quilombo real.

Con Matías trabajábamos para una empresa de EEUU, con varias tareas en paralelo. Y el flujo era siempre el mismo:

→ una terminal con Claude en una feature
→ otra ventana con Gemini debuggeando otra cosa
→ Codex en una tercera
→ alt-tab, alt-tab, alt-tab, ¿dónde estaba el server que levantó el agente?

Los agentes de IA eran buenos. El workspace para manejarlos, un desastre.

Así que construimos el que necesitábamos: un multiplexor de terminal pensado para agentes de IA. Claude, Gemini, Codex, Copilot y más, lado a lado en una sola ventana. Cada panel con su propia sesión, su cuenta, su historial y su entorno.

Le pusimos Nestmux. Hoy va por la v1.3.1, corre en Mac, Windows y Linux, y lo usan 90 devs.

No lo construimos para venderlo. Lo construimos para usarlo. Venderlo vino después.

Si tu escritorio también es un cementerio de terminales: nestmux.com. El plan Free no vence nunca.

#DevTools #AIAgents #BuildInPublic
```

---

## Martes 7 — CARRUSEL 1 · "Cómo trabajo yo con Nestmux": mi setup diario

**Texto del post (acompaña al carrusel):**

```
Mi pantalla a las 9 AM: 5 agentes de IA trabajando. Yo, revisando.

Me preguntan seguido cómo es trabajar "con varios agentes a la vez" en el día a día. No es magia ni caos: es un setup bastante aburrido que repito todas las mañanas.

Lo documenté slide por slide. Es exactamente mi flujo real, con las teclas que uso y en qué orden abro cada cosa.

Si querés probarlo con tu propio repo: nestmux.com

#DevTools #AIAgents
```

**Guion slide por slide (9 slides):**

1. **Cómo trabajo yo con Nestmux** — "Mi setup real de todas las mañanas. Sin humo: teclas, paneles y orden exacto." *(portada, logo Nest chico abajo)*
2. **9:00 — Abro mi workspace guardado** — "No armo el layout de cero cada día. Nestmux guarda workspaces: un click y vuelven mis paneles, en su lugar, con su entorno."
3. **Panel 1: Claude, la feature grande** — "El trabajo profundo del día. Claude corre en su propio panel, con su propia sesión y su propia cuenta. No comparte nada con los demás."
4. **Panel 2: Gemini, el bug de ayer** — "Otra AI, otro contexto, otro problema. Si Claude se traba con algo, a veces el mismo prompt en Gemini destraba."
5. **Panel 3: Codex, tareas mecánicas** — "Renombrar, migrar, escribir tests repetitivos. Trabajo que no requiere que yo piense, pero sí que alguien lo haga."
6. **Panel 4: terminal plano** — "Git, greps, lo mío. Porque no todo lo hace un agente, y no pienso salir de la ventana para hacerlo."
7. **Ctrl+L: cambio de layout sin reiniciar nada** — "11 layouts de tiling. A la mañana, grilla pareja para monitorear. A la tarde, un panel gigante y el resto chicos. Las sesiones nunca se cortan."
8. **El chip del puerto** — "Un agente levantó el dev server. El panel me muestra en qué puerto escucha, aunque el proceso se haya re-parentado. Click → se abre el browser adentro de la app."
9. **CTA** — "Todo esto en una ventana. Plan Free permanente en nestmux.com" *(pantalla final con URL grande)*

**Indicaciones visuales para diseño:**
- Cada slide 2–6: screenshot real del panel correspondiente, recortado, con zoom en lo relevante (nombre de la AI visible).
- Slide 7: GIF no aplica en carrusel → usar 2 capturas del mismo workspace en layouts distintos, lado a lado con flecha "Ctrl+L".
- Slide 8: zoom fuerte al chip de puerto con un círculo/highlight.
- Tipografía grande, fondo oscuro (estética terminal), un color de acento consistente con la identidad de Nest.

---

## Miércoles 8 — POST 2 · Datos en tiempo real: 40k impresiones, 90 usuarios

**Asset**: screenshot de las analytics de LinkedIn del post de 40k impresiones (número visible).

```
Un post: 40.000 impresiones. Nuestra realidad: 90 usuarios y ~$180 de MRR.

Voy a contar el crecimiento de Nest en público, con números reales. Empiezo por los incómodos.

→ 40.000 impresiones con un solo post en LinkedIn.
→ 90 usuarios activos.
→ ~9 pagando. 10% de conversión.
→ MRR: unos $180.

¿La lectura fácil? "40k impresiones y solo 90 usuarios, qué embudo horrible."

¿La lectura que me interesa? De la gente que llegó al producto y lo probó, 1 de cada 10 sacó la tarjeta. Para una herramienta dev con plan Free permanente, esa conversión me dice que el dolor es real. El problema no es el producto: es cuánta gente correcta lo vio.

Y una cosa más: nuestro costo por usuario es casi cero, porque cada dev usa sus propias API keys. No revendemos tokens. Así que no estamos quemando plata para sostener esos 90.

Voy a postear estos números todos los meses, suban o bajen.

¿Qué métrica les gustaría que abra en detalle el mes que viene? Los leo en comentarios.

#BuildInPublic #SaaS #DevTools
```

---

## Jueves 9 — CARRUSEL 2 · Worktrees: 3 agentes, 3 features, 0 conflictos

**Texto del post:**

```
3 agentes tocando el mismo repo a la vez suena a desastre. No lo es.

El truco no es de IA, es de git: worktrees. Cada agente trabaja en su propia copia del repo, en su propia rama, sin pisarse con los demás.

El problema era que manejar worktrees a mano (crear, ubicar, limpiar) es lo suficientemente molesto como para que casi nadie lo haga. Por eso en Nestmux se crean y gestionan desde la UI.

En el carrusel: el flujo completo, paso a paso, con 3 features reales andando en paralelo.

Demo completa en nestmux.com

#Git #AIAgents #DevTools
```

**Guion slide por slide (10 slides):**

1. **3 agentes. 3 features. 0 conflictos.** — "Cómo hacer que varios agentes de IA trabajen el mismo repo en paralelo sin pisarse. Paso a paso." *(portada)*
2. **El problema** — "Le das una feature a un agente. Mientras labura, querés arrancar otra. Pero los dos tocan el mismo working directory: archivos a medio editar, branch equivocada, caos."
3. **La solución existe hace años: git worktrees** — "Un worktree es una copia del repo en otra carpeta, con su propia rama. Mismo historial, cero interferencia."
4. **¿Por qué nadie los usa?** — "Porque a mano son un plomo: `git worktree add ../repo-feature-x -b feature-x`, acordarse de las rutas, limpiar después. La fricción mata al hábito."
5. **Paso 1 — Crear el worktree desde la UI** — "En Nestmux: repo → nuevo worktree → nombre de la rama. Listo. Sin comandos, sin pensar rutas."
6. **Paso 2 — Un agente por worktree** — "Abrís un panel de Claude apuntado al worktree A, Gemini al B, Codex al C. Cada uno cree que tiene el repo entero para él. Y lo tiene."
7. **Paso 3 — Vos supervisás desde la grilla** — "Los tres paneles a la vista en un solo layout. Ves qué está haciendo cada uno sin cambiar de ventana."
8. **Paso 4 — Revisar antes de mergear** — "Diff viewer integrado: leés lo que cada agente cambió, en contexto, antes de que toque tu rama principal."
9. **El resultado** — "Tres features avanzando en paralelo, cada una en su rama, mergeables por separado. Tu `main` ni se enteró."
10. **CTA** — "Worktrees desde la UI está en el plan Pro. Demo en nestmux.com" *(URL grande)*

**Indicaciones visuales:**
- Slide 2: ilustración simple de 2 flechas chocando sobre un ícono de carpeta (el conflicto).
- Slide 3-4: terminal estilizada mostrando el comando crudo (para el contraste con la UI).
- Slides 5–8: screenshots reales de Nestmux (modal de worktree, grilla con 3 paneles, diff viewer). Numerar los pasos grande en cada slide.
- Slide 9: diagrama de 3 ramas saliendo de main, cada una con el logo de una AI.

---

## Viernes 10 — POST 3 · Opinión: el 66% y el problema de "casi correcto"

**Asset**: ninguno obligatorio (post de texto). Opcional: card tipográfica con "66%" grande.

```
El 66% de los devs dice que la IA entrega código "casi" correcto. "Casi" es la palabra más cara del software.

El dato es de la encuesta de Stack Overflow 2025, sobre ~49.000 desarrolladores. La frustración #1 con herramientas de IA no es que fallen: es que casi aciertan. Y la #2 (45%) es debuggear ese código después.

Un error obvio lo descartás en 5 segundos. Un "casi correcto" pasa el vistazo, pasa el linter, a veces pasa los tests… y explota en producción o te come una tarde de debugging.

Mi conclusión después de un año trabajando con agentes todos los días: el cuello de botella ya no es generar código. Es verificarlo.

Y sin embargo, el 90% de las herramientas nuevas compiten por generar más rápido. Casi ninguna te ayuda a responder la pregunta que importa: ¿esto que escribió el agente está bien?

Por eso en Nest la apuesta va por otro lado: que puedas ver qué hace cada agente mientras lo hace, leer cada diff en contexto antes de mergear, y comparar salidas de distintos modelos cuando desconfiás de una.

Generar es barato. Confiar es caro.

¿A ustedes qué les pasa más seguido: código IA que falla evidente, o código IA que "casi"? Los leo.

#AIAgents #DesarrolloDeSoftware #DevTools
```
