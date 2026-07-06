# Brief de marca y datos verificados — Nest by RAVEN

> Fuente única de verdad para todo el material de marketing (Fase 3 de la propuesta Watt Balance).
> Datos extraídos del repo el 2026-07-05 (v1.3.1). **No inventar números ni features que no estén acá.**

## Producto

**Nest by RAVEN** ("Nestmux") — Multi-AI Terminal Workspace, v1.3.1.
Desktop app (Electron) para macOS, Windows y Linux. Sitio: https://nestmux.com

**Pitch de una línea:** Un multiplexor de terminal construido para agentes de IA y para cómo los equipos realmente shippean código: Claude, Gemini, Codex, Copilot y más, lado a lado en una sola ventana, cada panel con su propia sesión, cuenta, historial y entorno.

## Features reales (v1.3.1)

- **Grid multi-IA**: hasta 12 paneles, 11 layouts de tiling, Ctrl/Cmd+L cicla layouts sin reiniciar sesiones. AIs soportadas: Claude, Gemini, Codex, Copilot, OpenCode, terminal plano, comando custom, Browser cell.
- **Git worktrees nativos**: crear/gestionar worktrees desde la UI; cada agente trabaja aislado en su copia.
- **My Repos**: dashboard personal de repos, GitHub & GitLab, CI runs visibles.
- **Teams**: workspace de equipo real; terminal sharing en vivo por código de 8 caracteres.
- **Broadcast Mode**: mandar el mismo prompt a varios agentes a la vez (Pro).
- **Detección de puertos por panel**: chip con el puerto que escucha cada proceso, aun si el dev server fue lanzado por el agente y se re-parentó; click abre el Browser cell interno.
- **Voice input** (requiere whisper local), snippets, workspaces guardados, diff viewer, Spotlight, MCP write.
- **Tutorial interactivo** (v1.3): 3 tours guiados sobre la UI real (Worktrees, My Repos, Teams).
- **Instalación del CLI del agente desde el banner** (v1.3.1): un click, log en vivo, abre el panel al terminar.
- **Auto-updates** en las 3 plataformas. Pagos por Stripe activos.
- **Costo por usuario casi cero**: cada dev usa sus propias API keys / suscripciones de CLI. Nest no revende tokens.

## Pricing real (fuente: src/lib/stripe.ts — NO usar los "$20/$35/$60" de la propuesta como 3 planes)

| Plan | Precio | Notas |
|---|---|---|
| Free | $0 permanente | 3 paneles, todas las AIs. Sin broadcast, voice, sharing, snippets, workspaces, worktrees, Spotlight, diff viewer, My Repos, Actions, GitHub/GitLab, MCP write, Teams. |
| Pro | $20/mes o $180/año ($15/mes, −25%) | Todo desbloqueado (12 paneles, broadcast, worktrees, My Repos, integraciones), sin Teams. |
| Team | $35/mes/seat o $312/año/seat ($26/mes, −25%) | Todo + Teams. Mínimo 2 seats. |
| Enterprise | Sales-led, piso $60/seat/mes facturación anual, mínimo 4 seats | Sin checkout; demo por Calendly (https://calendly.com/matias-nestmux/new-meeting). Contacto: bautista@nestmux.com |

## Tracción (fuente: propuesta Watt Balance, jun-2026)

- 90 usuarios activos, ~9 pagando (~10% conversión). MRR ~$180.
- 40.000 impresiones en LinkedIn con un solo post.
- DM espontáneo de un VP de Huawei antes del lanzamiento.
- Lanzamiento en Product Hunt: 17 de junio de 2026.
- Meta 12 meses: ~$70.000 USD run-rate.

## Equipo

Gero (CEO/fundador) · Matías (CTO/co-fundador) · Eliseo (CISO) · Bautista (CMO).
Origen: construyeron la herramienta para resolver su propio día a día trabajando en paralelo para una empresa de EEUU.

## Posicionamiento (fuente: deep-research 2026-07-04, docs/design/integrations/2026-07-04-research-destacar-vs-clis.md)

- **Pitch central = verificación + colaboración**, NO "somos más eficientes que MCP" (MCP cierra esas brechas rápido).
- Dolores medidos (Stack Overflow 2025, ~49k devs): #1 "AI casi correcto" (66%), #2 debuggear código IA (45%). Solo 17.3% cree que los agentes mejoraron la colaboración del equipo → ahí apunta Nest.
- **vs Cursor**: "No somos lo mismo. Somos complementarios." (encuadre oficial para la objeción más frecuente).
- **vs superset.sh**: mismo núcleo, pero superset es Mac-only (README: Windows/Linux untested) y su marketplace es solo temas. Nest = multi-OS real. *Revalidar antes de publicar comparativas.*
- Modelo de gating estilo Raycast: catálogo/producto accesible, gate en profundidad (Pro/Team).

## Voz y tono

- Gero habla como developer, no como CMO. Directo, técnico, sin jerga de marketing.
- El contenido es **demostración, no publicidad**: mostrar el producto funcionando.
- Contar el crecimiento en tiempo real (datos propios: impresiones, conversiones) como credibilidad.
- Español rioplatense en redes (LinkedIn/Instagram, audiencia latam); **inglés en emails** (base de usuarios internacional post-Product Hunt).

## Claims PROHIBIDOS (refutados en el deep-research — no usar)

- "Los devs pasan 11.4h/semana revisando código IA vs 9.8h escribiendo".
- "MCP exige setup técnico no trivial que una GUI elimina".
- Cualquier claim de seguridad de tokens (hay un pendiente interno de github_token en texto plano).
- No prometer integraciones Jira/Slack/Notion como si ya existieran: el marketplace de integraciones está en desarrollo (rama feat/integrations, hito 1). La propuesta menciona "Teams, Jira, GitHub y Slack nativos" — lo real hoy: GitHub/GitLab + Teams propio. No vender lo que no shippeó.
