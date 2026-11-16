# Informe deep-research: cómo destacar el marketplace de integraciones vs CLIs y competidores

**Fecha:** 2026-07-04 · **Método:** deep-research multi-agente (103 agentes: 5 ángulos de búsqueda → 21 fuentes fetched → 91 claims extraídos → 25 verificados adversarialmente con panel de 3 jueces c/u → 20 confirmados, 5 refutados).
**Pregunta:** ¿Cuál es la mejor manera de que el marketplace de integraciones de Raven Nest (paneles embebidos premium terminal→Slack, OAuth, Jira/GitHub/Notion, Pro-gated) destaque frente a cualquier CLI (Claude Code + MCP, gh CLI, agentes de terminal) y frente a competidores como superset.sh?

## Resumen ejecutivo

La diferenciación defendible combina 4 ejes: **(1)** atacar los dos gaps mayores medidos en devs que usan agentes — verificar output "casi correcto" (66%) y colaboración de equipo (17% de aprobación) — que es exactamente lo que apuntan los paneles terminal→Slack; **(2)** integraciones bespoke curadas que evitan el costo estructural del MCP genérico y coinciden con el uso real (1-2 integraciones core, no catálogos); **(3)** superset.sh compite en orquestación pero es Mac-only y su "marketplace" es solo temas — multi-OS + marketplace real es espacio libre hoy; **(4)** en gating, el patrón Raycast: catálogo accesible, gate en lo premium. **Cautela central:** MCP está cerrando sus brechas rápido (Tool Search ~85% reducción de tokens, code execution, Enterprise-Managed Auth jun-2026) — la ventaja debe construirse sobre UX de verificación/colaboración y curación profunda, NO sobre "MCP es ineficiente".

## Hallazgos confirmados

### 1. Los paneles apuntan a los dos dolores más grandes medidos (confianza: alta, votos 3-0 y 3-0)

Stack Overflow Developer Survey 2025 (~49.000 devs): frustración #1 = "AI solutions that are almost right, but not quite" (66%); #2 = "debuggear código IA consume más tiempo" (45.2%). Y solo el **17.3%** está de acuerdo con "AI agents have improved collaboration within my team" — el impacto peor valorado por ~20 puntos (el siguiente, calidad de código, 37.5%). Una GUI con paneles de revisión + terminal→Slack ataca ambos; ningún CLI puro los resuelve hoy.
*Ojo: "una GUI lo resuelve mejor que un CLI" es inferencia nuestra; la encuesta mide el dolor, no compara superficies.*
Fuente: https://survey.stackoverflow.co/2025/ai

### 2. Los agentes CLI son el competidor que más crece y MCP ya es estándar (alta, 3× 3-0)

JetBrains AI Pulse (ene-2026, n>10.000; fuente contra-interés): Claude Code 18% de uso en el trabajo (6x en un año, empatado con Cursor; Copilot 29% pero estancado); los devs eligen agentes best-of-breed sobre suites integradas. Stack Overflow: GitHub MCP Server 42.8% de adopción entre devs que usan agentes. Conclusión: el marketplace debe **diferenciarse de MCP, no replicarlo**.
Fuentes: https://blog.jetbrains.com/research/2026/04/which-ai-coding-tools-do-developers-actually-use-at-work/ · https://survey.stackoverflow.co/2025/ai

### 3. El MCP naive tiene costo estructural de contexto que la curación evita (alta, 4× 3-0 + 1× 2-1)

Anthropic (creador de MCP, autocrítica nov-2025): cargar todas las definiciones de tools por adelantado + pasar resultados intermedios por el modelo escala mal (~50k tokens extra por un transcript de 2h que fluye dos veces). Mediciones independientes: 7 servers = 33.7% de una ventana de 200k (issue #11364 de Claude Code: 67.3k tokens); GitHub MCP solo ~17.6k-55k; hasta 72% en setups de 3 servers; "40-50% del contexto solo en tool metadata" (CTO de Merge).
**Caveat crítico:** ya existen mitigaciones CLI-side (Tool Search ~85% de reducción, code execution, progressive disclosure) — es una limitación del patrón por defecto, no algo que SOLO una GUI resuelve. No basar el pitch acá.
Fuentes: https://www.anthropic.com/engineering/code-execution-with-mcp · https://thenewstack.io/how-to-reduce-mcp-token-bloat/ · https://intuitionlabs.ai/articles/claude-skills-vs-mcp

### 4. El uso real favorece pocas integraciones profundas (media, 2× 3-0)

"Most developers have only one or two core MCP servers that they make use of" (Tom Moor, head of eng de Linear, MCP con 250k+ usuarios). "Most MCP servers simply wrap APIs and aren't built for agentic workflows" (Alex Salazar, CEO Arcade.dev). Corrobora Anthropic (150k→2k tokens al abandonar wrapping naive) y un análisis de 1.899 servers (wrappers = 5.3x más invocaciones por tarea). → Valida **4 paneles bespoke profundos** sobre catálogo genérico. Confianza media: observaciones de ejecutivos, no encuestas.
Fuentes: https://thenewstack.io/how-to-reduce-mcp-token-bloat/ · https://www.anthropic.com/engineering/code-execution-with-mcp

### 5. OAuth diferencia hoy, pero la ventana se cierra (media, 2× 2-1 + 1× 3-0)

El modelo por defecto de MCP obliga a autorizar cada server individualmente (reconocido por los maintainers), y el patrón "managed agents" de Anthropic (tokens en vault, nunca alcanzables desde el sandbox) es replicable por una app orquestadora frente a CLIs con tokens en JSON en disco. **PERO** MCP estabilizó Enterprise-Managed Authorization en jun-2026 (SSO + JWT ID-JAG, cero consent screens por servidor; Okta, Anthropic, Microsoft, Atlassian, Linear, Figma ya lo soportan) — queda vigente para devs individuales (el target probable de Nest). E irónicamente Nest hoy guarda `github_token` plano en Supabase: este eje es **aspiracional hasta resolver ese pendiente**.
Fuentes: https://blog.modelcontextprotocol.io/posts/enterprise-managed-auth/ · https://www.anthropic.com/engineering/managed-agents · https://code.claude.com/docs/en/security

### 6. superset.sh valida el modelo y deja libre el terreno del marketplace (alta, 3× 3-0 + 1× 2-1)

Verificado al 2026-07-04 (repo activo, v1.13.0 del 2026-07-03): mismo núcleo que Nest (10+ agentes en paralelo con worktrees, local-first, diff/editor, browser, puertos, MCP tooling), pero README dice "macOS (Windows/Linux untested)", sin builds Windows, y su marketplace es **solo temas JSON**. → Multi-OS + marketplace de integraciones real siguen siendo diferenciadores válidos. **Caveat:** un tercero (runpane.com) menciona AppImage Linux desde feb-2026 y Windows "coming soon" — **revalidar antes del launch**.
Fuentes: https://github.com/superset-sh/superset · https://superset.sh/compare/superset-vs-conductor · https://superset.sh/marketplace

### 7. Gating: catálogo abierto, profundidad Pro (media, 3-0, un solo caso)

Raycast (verificado 2026-07-04): TODO el marketplace de 2.000+ extensiones (incl. GitHub, Jira, Linear, Notion) es gratis y open-source; el Pro ($8-10/mes) gatea conveniencia y features de equipo. Aplicación a Nest: **gatear la profundidad (paneles bespoke, features de team), no el acceso al catálogo**. Es UN caso (launcher, no orquestador): informativo, no prueba. superset gatea por seats ($40/user/mo Team) sin marketplace pago.
Fuente: https://www.raycast.com/pricing

## Claims refutados (NO usar en el pitch)

| Claim | Voto |
|---|---|
| "Los devs pasan 11.4h/semana revisando código IA vs 9.8h escribiendo" | 0-3 |
| "MCP exige setup técnico no trivial que una GUI elimina" | 1-2 |
| "Loguearse una vez con todos los conectores automáticos se percibe como 'mágico'" (mal atribuido) | 0-3 |
| "Superset se diferencia por soportar múltiples CLIs vs Conductor" (claim de marketing, no verificable) | 0-3 |
| "El pitch de Superset es genérico vía terminal" (formulación no sostenida por la fuente) | 0-3 |

## Preguntas abiertas

1. **¿Hay demanda medible por el flujo terminal→Slack específicamente**, o el 17% refleja que los devs no esperan que los agentes toquen colaboración? Falta validación directa (entrevistas/waitlist) del panel estrella.
2. **¿Willingness-to-pay por integraciones vs orquestación?** Ningún dev-tool encontrado monetiza con éxito paneles de integración Pro-gated: ¿espacio virgen o señal de que no funciona?
3. **¿Cuánto dura la ventana técnica vs MCP**, dado que Tool Search + code execution + EMA cerraron token bloat y fricción OAuth en <12 meses?
4. **¿Estado real del Windows/Linux de superset.sh?** README dice "untested"; un tercero reporta AppImage desde feb-2026 y Windows "coming soon".

## Fuentes principales (calidad)

Primarias: survey.stackoverflow.co/2025/ai · blog.jetbrains.com (AI Pulse 2026) · anthropic.com/engineering (code-execution-with-mcp, managed-agents) · blog.modelcontextprotocol.io (enterprise-managed-auth) · github.com/superset-sh/superset · superset.sh (compare, marketplace) · raycast.com/pricing
Secundarias/blogs: thenewstack.io (token bloat) · intuitionlabs.ai · lunar.dev · deploystack.io · speakeasy.com · rywalker.com · runpane.com · dodopayments.com · dev.to (JetBrains marketplace) · github.com/Kong/insomnia (discussion 6590)
Descartadas por no confiables: junia.ai · getmonetizely.com

## Implicaciones para el spec (aplicadas en `2026-07-04-marketplace-integraciones-v2-design.md`)

- Pitch por integración = verificación + colaboración, no eficiencia vs MCP.
- Catálogo y detail-pages visibles para todos; gate Pro en "Conectar".
- 4 paneles bespoke profundos > catálogo amplio.
- Argumento Enterprise: los agentes hoy no mejoran la colaboración (17%) — integración custom terminal→herramienta interna es exactamente eso.
- Antes del launch: revalidar Windows de superset + validar demanda terminal→Slack + resolver github_token plano si el pitch incluye seguridad de tokens.
