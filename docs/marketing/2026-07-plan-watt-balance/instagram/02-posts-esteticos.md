# Instagram — 12 posts estáticos (Mes 1)

> 3 por semana (lunes, miércoles, viernes). Diseño limpio, mensajes cortos y directos.
> Todos los datos y features salen del brief (`00-brief-marca-y-datos.md`). Nada inventado.

## Sistema visual (aplicar a TODOS los posts)

- **Formato**: 1080×1350 (4:5, ocupa más pantalla en el feed).
- **Estética**: terminal oscura. Fondo casi negro (`#0A0E14` o el fondo real de la UI de Nestmux — priorizar el de la app para consistencia). Nada de fotos de stock.
- **Tipografía**: monoespaciada (JetBrains Mono o la que use la app) para el texto principal; sans limpia (Inter) para texto secundario.
- **Acento**: UN solo color de acento, el primario de la marca Nest (tomarlo de la UI real de Nestmux y fijarlo en el manual; usar siempre el mismo hex). Se usa para: prompt `>`, cursor, palabras clave, chips.
- **Recursos recurrentes**: prompt `>` antes de los títulos, cursor bloque parpadeante (en estático: cursor sólido al final de la frase), chrome de ventana estilo terminal (3 puntitos arriba a la izquierda), bordes de paneles como en la grilla real.
- **Logo**: wordmark "nestmux" chico, abajo. URL `nestmux.com` abajo a la derecha en todos.
- **Screenshots**: cuando el post lleva captura real, usar la app en tema oscuro, con datos de demo limpios (nada sensible, sin tokens ni emails reales).

---

## SEMANA 1

### P1 — Presentación (lunes, sem. 1)

**Texto EN la imagen:**
```
> claude, gemini, codex y copilot
  en una sola ventana.

nestmux — multi-AI terminal workspace
```

**Indicación visual:** fondo terminal oscuro, chrome de ventana. Debajo del texto, una mini-grilla de 4 paneles dibujada en líneas finas con el logo de cada CLI (o su nombre en mono) dentro de cada panel. Cursor sólido al final de la última línea.

**Caption:**
Cada agente de IA tiene su propia terminal, su propia sesión, su propia cuenta, su propio historial. El problema nunca fue el agente: fue tener todo desparramado en diez ventanas.

Nestmux los pone lado a lado en una sola grilla. Claude, Gemini, Codex, Copilot, OpenCode, o una terminal plana de toda la vida.

Gratis en nestmux.com — plan Free permanente, 3 paneles, todas las AIs. macOS, Windows y Linux.

#devtools #ia #terminal #programacion #devs

---

### P2 — El dolor (miércoles, sem. 1)

**Texto EN la imagen:**
```
alt-tab. alt-tab. alt-tab.

¿en qué ventana estaba Claude?
```

**Indicación visual:** el texto grande arriba. Debajo, siluetas de 6-7 ventanas de terminal superpuestas y desordenadas (solo contornos, en gris oscuro), una levemente resaltada con el color de acento y un `?` encima. Sensación de caos contenido, minimalista.

**Caption:**
Un agente corriendo acá, otro en otra ventana, el dev server en una tab que ya no encontrás, y el contexto perdido en el camino.

Trabajar con varios agentes a la vez no debería sentirse así.

Todo en una grilla, cada uno en su panel. nestmux.com

#devs #programacion #ia #productividad #terminal

---

### P3 — Plan Free (viernes, sem. 1)

**Texto EN la imagen:**
```
> plan free: $0

3 paneles. todas las AIs.
para siempre.
```

**Indicación visual:** fondo oscuro, el `$0` en tamaño gigante con el color de acento. Debajo, 3 paneles dibujados en línea con "claude", "gemini", "codex" en mono. Texto "sin tarjeta. sin trial que vence." chiquito al pie.

**Caption:**
No es un trial. No te pedimos tarjeta. El plan Free de Nestmux es permanente: 3 paneles y todas las AIs soportadas (Claude, Gemini, Codex, Copilot, OpenCode, terminal plana y más).

¿Necesitás más paneles, worktrees o broadcast? Para eso está Pro. Pero para arrancar, con Free ya trabajás distinto.

Descargalo en nestmux.com — macOS, Windows y Linux.

#devtools #gratis #ia #devs #terminal

---

## SEMANA 2

### P4 — Layouts con Ctrl/Cmd+L (lunes, sem. 2)

**Texto EN la imagen:**
```
> Ctrl+L

11 layouts.
tus sesiones no se enteran.
```

**Indicación visual:** una tecla `Ctrl` + `L` dibujada estilo keycap con borde de acento. Al lado, 3 miniaturas de grillas distintas (2×2, 1 grande + 3 chicos, columnas) conectadas con flechitas, mostrando que el mismo contenido rota de layout. Todo lineal, monocromo + acento.

**Caption:**
Cambiar el layout de la grilla no reinicia nada: los agentes siguen corriendo, el historial queda, el contexto no se pierde. Ctrl+L (Cmd+L en Mac) y ciclás entre 11 layouts de tiling hasta encontrar el que va con lo que estás haciendo.

¿Debugging? Un panel gigante. ¿Supervisando agentes? Grilla pareja. Vos elegís.

nestmux.com

#terminal #devtools #productividad #devs #shortcuts

---

### P5 — Detección de puertos (miércoles, sem. 2)

**Texto EN la imagen:**
```
tu agente levantó un dev server.

nestmux ya sabe en qué puerto.
```

**Indicación visual:** captura real (o recreación fiel) de un panel de Nestmux con el chip de puerto visible (ej. `:5173`) resaltado con un círculo o glow del color de acento. Flecha fina del chip hacia una miniatura del Browser cell abierto.

**Caption:**
Le pediste al agente que levante el proyecto. ¿En qué puerto quedó escuchando? Nestmux lo detecta solo — incluso si el proceso se re-parentó — y te muestra un chip con el puerto en el panel.

Click en el chip y se abre en el Browser cell interno. Sin salir de la ventana, sin adivinar puertos.

nestmux.com

#devtools #webdev #ia #devs #terminal

---

### P6 — El dato del "casi correcto" (viernes, sem. 2)

**Texto EN la imagen:**
```
66% de los devs dice que su mayor
frustración es el código IA
"casi correcto".

(Stack Overflow 2025, ~49.000 devs)
```

**Indicación visual:** el `66%` enorme en color de acento, el resto en blanco. Fuente citada chiquita abajo (obligatoria). Sin gráficos: el número es el gráfico.

**Caption:**
El problema ya no es generar código. Es verificarlo.

Por eso Nestmux pone a los agentes lado a lado: corrés el código apenas sale, ves el puerto del dev server en el panel, revisás los cambios con el diff viewer y comparás lo que hizo cada agente sin cambiar de ventana.

Menos fe, más verificación. nestmux.com

#ia #devs #programacion #codereview #devtools

---

## SEMANA 3

### P7 — Terminal sharing (lunes, sem. 3)

**Texto EN la imagen:**
```
> compartí tu terminal en vivo

un código de 8 caracteres.
eso es todo.
```

**Indicación visual:** un código estilo `A7K2-9FQX` grande en mono con el color de acento, dentro de un recuadro punteado tipo "copiá y pegá". Debajo, dos mini-ventanas de terminal conectadas por una línea, con el mismo contenido en ambas.

**Caption:**
"¿Me mirás esto un segundo?" — y en vez de screenshots o llamadas con pantalla compartida pixelada, le pasás un código de 8 caracteres y tu compañero ve tu terminal en vivo.

Terminal sharing es parte de los planes pagos de Nestmux, pensado para equipos que debuggean juntos aunque estén en ciudades distintas.

nestmux.com

#pairprogramming #equipos #devs #remoto #devtools

---

### P8 — vs. Cursor (miércoles, sem. 3)

**Texto EN la imagen:**
```
¿nestmux o cursor?

no somos lo mismo.
somos complementarios.
```

**Indicación visual:** dos recuadros lado a lado, mismo peso visual (nada de "nosotros ganamos"): uno dice `tu editor` y el otro `tus agentes`. Un símbolo `+` entre ambos en color de acento. Sobrio, sin logos de terceros.

**Caption:**
Nos lo preguntan todas las semanas, así que va la respuesta oficial: no venimos a reemplazar tu editor.

Cursor (o el editor que uses) es donde escribís código. Nestmux es donde corrés y supervisás a tus agentes de CLI: Claude, Gemini, Codex, Copilot, lado a lado, cada uno con su sesión y su entorno.

Usalos juntos. Ese es el punto.

nestmux.com

#cursor #ia #devtools #devs #programacion

---

### P9 — Build in public (viernes, sem. 3)

**Texto EN la imagen:**
```
> build in public

90 usuarios activos
40.000 impresiones con un solo post
lanzamos en Product Hunt el 17/06
```

**Indicación visual:** estética de log de terminal: cada línea con un `✓` en color de acento, como si fuera la salida de un script. Al pie: `> siguiente objetivo: cargando...` con cursor.

**Caption:**
Números reales, sin inflar: 90 usuarios activos, 40.000 impresiones en LinkedIn con un solo post, y un DM espontáneo de un VP de Huawei antes de lanzar.

Construimos Nestmux para resolver nuestro propio día a día trabajando en paralelo, y lo estamos convirtiendo en empresa a la vista de todos. Los números del mes que viene también los vas a ver acá.

nestmux.com

#buildinpublic #startup #techlatam #devs #ia

---

## SEMANA 4

### P10 — Tutorial interactivo (lunes, sem. 4)

**Texto EN la imagen:**
```
no leas docs.

3 tours guiados
sobre la app real.
```

**Indicación visual:** captura de la UI de Nestmux con un tooltip/paso del tutorial interactivo visible y resaltado. Un badge `1/3` en color de acento. Si no hay captura limpia, recrear el tooltip sobre un mock de la grilla.

**Caption:**
Lo nuevo de la v1.3: un tutorial interactivo con 3 tours guiados — Worktrees, My Repos y Teams — que corren sobre la UI real, no sobre screenshots.

Abrís la app, seguís los pasos, y en minutos ya estás trabajando. Nadie se lee la documentación un viernes.

nestmux.com

#onboarding #devtools #ia #devs #ux

---

### P11 — Instalación del CLI en un click (miércoles, sem. 4)

**Texto EN la imagen:**
```
¿no tenés el CLI instalado?

un click. log en vivo.
panel abierto al terminar.
```

**Indicación visual:** recreación del banner de instalación de Nestmux con un botón resaltado en acento, y debajo 3-4 líneas de log de instalación en verde/gris estilo terminal, terminando en `✓ done`.

**Caption:**
Abriste Nestmux pero todavía no tenés instalado el CLI de tu agente. Antes: salir, buscar el comando, pelear con el PATH. Ahora (v1.3.1): un click en el banner, ves el log de instalación en vivo, y cuando termina se te abre el panel listo para usar.

La fricción de arranque, eliminada.

nestmux.com

#devtools #cli #ia #devs #dx

---

### P12 — Cierre de mes / CTA (viernes, sem. 4)

**Texto EN la imagen:**
```
> todos tus agentes. una ventana.

descargalo gratis
nestmux.com
```

**Indicación visual:** el post más limpio del mes: fondo oscuro, la frase, la URL en color de acento tamaño grande, y los íconos de las 3 plataformas (macOS, Windows, Linux) en línea abajo. Cursor sólido final.

**Caption:**
Un mes mostrándote Nestmux. Ahora te toca a vos.

→ Plan Free permanente: 3 paneles, todas las AIs, $0.
→ macOS, Windows y Linux, con auto-updates.
→ Cada dev usa sus propias API keys y suscripciones: no revendemos tokens.

Descargalo en nestmux.com y contanos qué te pareció. Los mejores setups los compartimos en historias.

#devtools #ia #terminal #devs #gratis
