# LinkedIn — Semana 3 (20–24 jul): Colaboración + ecosistema

> 3 posts estáticos + 2 carruseles. Listos para pegar. Autor: Gero, primera persona.

---

## Lunes 20 — POST 7 · Opinión: solo 17,3% cree que los agentes mejoraron la colaboración

**Asset**: opcional, card tipográfica con "17,3%" grande.

```
Los agentes de IA te hacen más rápido a vos. A tu equipo, casi nada: solo el 17,3% de los devs vio mejoras en colaboración.

El dato sale de la encuesta de Stack Overflow 2025 (~49.000 devs). Y me parece EL número más importante del ecosistema hoy, mucho más que cualquier benchmark de modelos.

Pensalo así: llevamos dos años optimizando la productividad individual con IA. Autocompletado, agentes, generación de código. Todo eso hace que cada dev produzca más… en su burbuja.

Pero el software se construye en equipo. Y ahí los agentes hoy generan problemas nuevos:

→ Nadie sabe qué agente está corriendo qué cosa en el repo de quién.
→ El contexto de "por qué el agente hizo esto" vive en la sesión de una sola persona.
→ Ayudar a un compañero a debuggear SU sesión con SU agente es casi imposible a distancia.

En Nest apuntamos exactamente a ese 82,7% insatisfecho. Un ejemplo concreto: terminal sharing en vivo. Generás un código de 8 caracteres, se lo pasás a un compañero, y ve tu terminal en tiempo real. Tu sesión, tu agente, sus ojos. Sin Meet, sin compartir pantalla completa, sin "esperá que te doy permisos".

La productividad individual con IA ya está resuelta o cerca. La colaboración con IA recién empieza.

Si lidereás un equipo que corre agentes, esto es para vos: demo en nestmux.com

#AIAgents #EngineeringManagement #DevTools
```

---

## Martes 21 — CARRUSEL 5 · Terminal sharing en vivo con código de 8 caracteres

**Texto del post:**

```
Pair programming con un agente en el medio, sin compartir pantalla por Meet.

Escena típica de 2026: un dev de tu equipo tiene un agente trabado en algo raro. Quiere que lo mires. Opciones clásicas: screenshot fuera de contexto, o call con pantalla compartida y la resolución hecha puré.

En Nestmux hay una tercera: te pasa un código de 8 caracteres y ves su terminal en vivo. Paso a paso en el carrusel.

Es parte del plan Team. Todo en nestmux.com

#DevTools #RemoteWork
```

**Guion slide por slide (8 slides):**

1. **Compartí tu terminal en vivo. Con un código.** — "Terminal sharing de Nestmux: pair programming en la era de los agentes." *(portada)*
2. **La escena** — "Tu compañero: 'che, el agente me está haciendo algo raro con las migraciones, ¿lo mirás?'. Vos, en tu casa, a 30 km."
3. **Lo de siempre (y por qué falla)** — "Screenshot: sin contexto. Call con pantalla compartida: texto borroso, lag, y ver TODA su pantalla para mirar una terminal."
4. **Paso 1 — Generar el código** — "Desde el panel que quiere compartir, tu compañero genera un código de 8 caracteres. Eso es todo el setup."
5. **Paso 2 — Unirse** — "Vos ingresás el código en tu Nestmux. Su terminal aparece en tu grilla, en vivo."
6. **Lo que ves** — "La sesión real: el historial con el agente, la salida de los comandos, todo en texto nítido. Es una terminal, no un video de una terminal."
7. **Para equipos, no solo emergencias** — "Onboarding de un dev nuevo mirando cómo trabaja un senior con agentes. Review en vivo de una sesión larga. Debugging a cuatro ojos."
8. **CTA** — "Terminal sharing viene con el plan Team ($35/seat/mes). Demo en nestmux.com" *(URL grande)*

**Indicaciones visuales:**
- Slide 2–3: ilustración simple de dos personas / dos pantallas; en la 3, un mockup de video-call pixelado (exagerar el blur del texto).
- Slide 4: screenshot real del código de 8 caracteres generándose (highlight en el código).
- Slide 5–6: pantalla del que se une, con el panel remoto marcado con un borde de color "en vivo".
- Mantener estética terminal oscura de la serie.

---

## Miércoles 22 — POST 8 · "Cómo trabajo yo": mi flujo para revisar código de agentes

**Asset**: screenshot del diff viewer de Nestmux con un diff real (anonimizar nombres de archivos sensibles si hace falta).

```
Regla personal: ningún diff de un agente se mergea sin que lo haya leído en contexto.

Suena obvio. Casi nadie lo cumple. Porque cuando un agente te tira 14 archivos modificados y "ya está, tests pasando", la tentación de confiar es enorme. Y ahí es donde el código "casi correcto" (la frustración #1 de los devs según Stack Overflow 2025) se te mete al repo.

Mi flujo concreto, todos los días, en Nestmux:

1. El agente termina. No mergeo. Abro el diff viewer y leo el cambio completo, archivo por archivo, en la misma ventana donde corrió el agente.

2. Leo con una pregunta en la cabeza: no "¿esto funciona?" sino "¿esto es lo que yo hubiera aceptado de un junior en un PR?". Cambia mucho lo que ves.

3. Si algo no me cierra, no lo arreglo yo: se lo devuelvo al agente en el mismo panel, con el contexto de la sesión intacto. "En el archivo X, ¿por qué elegiste Y?" A veces la explicación me convence. A veces la pregunta sola hace que el agente encuentre su propio error.

4. Si el cambio es delicado, segundo modelo como segunda opinión: otro panel, otro agente, "revisá este diff y decime qué riesgos ves".

El tiempo que "pierdo" leyendo diffs es una fracción del que perdía debuggeando sorpresas en producción.

El diff viewer viene con el plan Pro. Probá el flujo completo: nestmux.com

#AIAgents #CodeReview #DevTools
```

---

## Jueves 23 — CARRUSEL 6 · Onboarding: de cero a tu primer agente en 5 minutos

**Texto del post:**

```
Instalar una herramienta dev no debería llevar una tarde. Esto lleva 5 minutos.

Una de las cosas en las que más trabajamos en la v1.3 fue el arranque: que entre "descargué Nestmux" y "tengo un agente corriendo en mi repo" haya la menor fricción posible.

Dos piezas lo hacen posible: la instalación del CLI del agente con un click desde la app (con log en vivo), y un tutorial interactivo que corre sobre la UI real, no sobre screenshots.

El camino completo, slide por slide. Son 5 minutos de verdad: nestmux.com

#DevTools #AIAgents
```

**Guion slide por slide (9 slides):**

1. **De cero a tu primer agente en 5 minutos** — "El onboarding de Nestmux, paso a paso, sin trampa." *(portada)*
2. **Minuto 0 — Descargar** — "nestmux.com → instalador para Mac, Windows o Linux. Auto-updates incluidos: instalás una vez, se actualiza solo."
3. **Minuto 1 — Abrir un panel** — "Elegís tu AI: Claude, Gemini, Codex, Copilot, OpenCode. O una terminal plana. El plan Free trae 3 paneles con todas las AIs."
4. **¿No tenés el CLI del agente instalado?** — "Acá se caía todo antes: salir de la app, buscar la doc, instalar por terminal. Ahora: banner → un click."
5. **Minuto 2 — Instalación con log en vivo** — "La app instala el CLI y te muestra el log en tiempo real. Cuando termina, abre el panel sola. Sin tocar nada."
6. **Minuto 3 — Login del agente** — "Usás TU cuenta y TUS API keys o suscripción. Nestmux no revende tokens ni se mete en el medio: cada panel autentica con lo tuyo."
7. **Minuto 4 — Tutorial interactivo** — "3 tours guiados sobre la UI real: Worktrees, My Repos y Teams. No es un video: es la app enseñándote la app."
8. **Minuto 5 — Tu primer prompt** — "Agente corriendo en tu repo, en tu panel, con tu contexto. Eso era todo."
9. **CTA** — "Gratis, sin tarjeta, sin vencimiento: nestmux.com" *(URL grande)*

**Indicaciones visuales:**
- Numerar los minutos bien grandes (0–5) como elemento gráfico conductor del carrusel.
- Slide 4–5: screenshots reales del banner de instalación y del log en vivo (esta es la secuencia estrella).
- Slide 7: screenshot del tutorial interactivo con un tooltip del tour visible.
- Slide 9: fondo limpio, solo URL + "Free forever".

---

## Viernes 24 — POST 9 · Retro del lanzamiento en Product Hunt

**Asset**: screenshot de la página de Product Hunt de Nestmux del día del lanzamiento.

```
Hace un mes lanzamos en Product Hunt. Esto es lo que haría distinto.

El 17 de junio salimos con Nestmux en PH. Un mes después, con la cabeza fría, la retro honesta:

Lo que funcionó:
→ Lanzar con producto real, no con landing + waitlist. v1.3 funcionando en Mac, Windows y Linux, pagos activos, auto-updates. La gente que llegó pudo USAR el producto ese mismo día, y eso se nota en la conversión: ~10% de los activos paga.
→ El momentum previo en LinkedIn. El post de 40k impresiones no fue el día del lanzamiento: fue antes. PH amplificó una conversación que ya existía, no la creó.

Lo que haría distinto:
→ Preparar el "día después". Teníamos todo listo para el martes 17 y poco sistematizado para el resto del mes. El tráfico de PH es un pico; el trabajo real es convertir ese pico en sistema. Es literalmente lo que estamos armando ahora.
→ Onboarding más pulido ANTES del pico, no después. Buena parte de las mejoras de arranque de la v1.3.x salieron de ver dónde se trababa la gente que llegó de PH. Hubiera preferido aprenderlo con 10 usuarios, no con el pico.

La conclusión que me llevo: Product Hunt no es una estrategia de lanzamiento, es un evento dentro de una. El error es tratarlo como la estrategia.

¿Lanzaste en PH o estás por hacerlo? Preguntame lo que quieras en comentarios, respondo todo.

#ProductHunt #BuildInPublic #SaaS
```
