# Proceso enterprise y calificación de leads

> Documento interno (español). Cómo responde Nest a una oportunidad enterprise — desde el DM de un VP hasta el cierre del pilot.
> Piezas que acompañan este proceso: `01-deck-enterprise.md` (deck) y `02-propuesta-tipo.md` (propuesta).
> Regla de oro: **honestidad sobre la etapa**. Somos 90 usuarios y un v1.3.1 sólido multi-OS. Vendemos un pilot estructurado de 30 días, no madurez enterprise que no tenemos.

---

## 1. Roles: quién hace qué

| Rol | Persona | Responsabilidad |
|---|---|---|
| Comercial (owner del lead) | **Bautista** (bautista@nestmux.com) | Primera respuesta a todo inbound enterprise (<24h hábiles), calificación, envío de deck y propuesta, seguimiento, negociación, cierre. |
| Demo técnica | **Matías** (CTO) | Única persona que da la demo/sesión técnica de 30 min. Agenda: calendly.com/matias-nestmux/new-meeting. |
| Escalamiento | **Gero** (CEO) | Entra solo si el lead pide hablar "con el founder", si el deal supera ~20 seats, o para el cierre final. No responde inbound directo: lo deriva a Bautista con intro cálida. |
| Consulta seguridad | **Eliseo** (CISO) | Bautista lo consulta ANTES de responder cualquier pregunta de seguridad/compliance por escrito. Nunca improvisar respuestas de seguridad. |

**Regla anti-caos:** un solo hilo por cuenta, siempre con Bautista en copia. Si el VP le escribe a Gero por LinkedIn (caso Huawei), Gero responde breve y cálido, y pasa el hilo: *"Bautista runs this with our CTO — he'll take great care of you."*

## 2. El flujo paso a paso

```
Inbound (DM / email / demo request)
  → [0-24h] Bautista responde + 3 preguntas de calificación
  → [Calificado] Link Calendly de Matías + deck adjunto
  → [Sesión 30 min] Matías: setup real, sin pitch (guion §4)
  → [<48h post-call] Bautista envía propuesta tipo (02) personalizada
  → [Pilot 30 días] Kickoff → check-ins semanales → review día 30
  → [Cierre] Contrato anual, piso $60/seat/mes, mín 4 seats
```

**Paso 1 — Primera respuesta (Bautista, <24h hábiles).** Corta, en inglés, sin deck todavía. Agradece, y hace las 3 preguntas de calificación (§3). Objetivo: datos, no venta.

**Paso 2 — Calificación (Bautista).** Con las respuestas, clasificar A/B/C según §3. A y B → paso 3. C → nurturing (workflow 3/4 de email) y plan Team self-serve si aplica.

**Paso 3 — Agendar sesión técnica.** Bautista manda el Calendly de Matías + el deck (PDF del `01-deck-enterprise.md`). Pedir que a la call venga alguien que pueda compartir pantalla con un repo real, y qué OS usa el equipo.

**Paso 4 — Sesión de 30 min (Matías).** Guion en §4. No es una demo enlatada: es configuración real.

**Paso 5 — Propuesta (<48h post-call, Bautista).** `02-propuesta-tipo.md` con todos los placeholders completos, sobre todo `{{use_case}}` con lo que se vio en la call. Validez 30 días.

**Paso 6 — Pilot de 30 días.** Kickoff con Matías, check-ins semanales de 30 min (Bautista + Matías alternados), canal directo (email o el que pida el cliente). Review día 30 contra criterios de éxito.

**Paso 7 — Cierre.** Ver §6.

## 3. Criterios de calificación

Tres preguntas en el primer contacto (en inglés):

1. *How many developers are on the team you'd roll this out to?*
2. *Which AI coding agents does the team use today, and on which OS (macOS/Windows/Linux)?*
3. *Is there something specific driving this now — a rollout, a pain point, a deadline?*

**Scoring:**

| Señal | A (prioridad) | B (trabajable) | C (nurturing) |
|---|---|---|---|
| Tamaño de equipo | 10–50 devs | 4–9 devs | <4 (no llega al mínimo) o >50 (hoy nos queda grande: pilotar con un sub-equipo de 10–50) |
| Stack | Ya usan ≥2 CLIs de agentes (Claude Code, Gemini, Codex, Copilot…) | Usan 1 agente, evaluando más | Solo IDE-AI (Cursor/Copilot in-IDE), sin CLIs |
| Urgencia | Iniciativa activa con dueño y fecha | Interés real sin fecha | "Curiosidad", sin dueño |
| Interlocutor | CTO / VP Eng / EM con budget | Tech lead que influye | Dev individual sin acceso al decisor |

**Regla:** A = call esa misma semana. B = call en ≤2 semanas. C = no gastar la agenda de Matías; email nurturing.

**Descalificadores duros (decirlo temprano y con honestidad, ahorra meses):**
- Requisito no negociable de SSO/SAML, SOC 2 o self-hosting **para firmar** (ver objeciones 1 y 4 — si es requisito para el *pilot*, no para la firma, se puede avanzar).
- Quieren que Nest provea/revenda los tokens de los modelos: no es nuestro modelo.
- Piden desarrollo a medida como condición del deal (eso es otra conversación, no este playbook).

## 4. Guion de la sesión de 30 min (Matías) — "sin pitch, solo configuración real"

**Preparación (antes de la call):** Bautista pasa a Matías: tamaño de equipo, agentes que usan, OS, y la respuesta a la pregunta 3. Matías prepara Nest limpio en el OS predominante del cliente.

- **Min 0–3 — Encuadre.** *"No slides today. We're going to set up Nest on your actual stack and you tell me if it holds up."* Confirmar: agentes, OS, cómo trabajan hoy en paralelo.
- **Min 3–8 — Su dolor, en sus palabras.** Dos preguntas y callarse: *"Walk me through what happens when two of your devs have agents working on the same repo."* y *"How do you review agent-generated changes today?"* Anotar frases textuales → van al `{{use_case}}` de la propuesta.
- **Min 8–20 — Setup en vivo.** Con un repo del cliente (o uno público suyo si no pueden compartir):
  1. Abrir grid, levantar 2–3 agentes distintos lado a lado (los que ELLOS usan).
  2. Crear un worktree desde la UI, mandar una tarea real a un agente ahí.
  3. Mostrar el diff viewer sobre lo que hizo el agente: **este es el momento "66% almost right"** — verificás antes de mergear.
  4. Terminal sharing con código de 8 caracteres: que el otro participante de la call se una desde SU máquina. Es el momento wow colaborativo — 17.3%.
  5. Si hay tiempo: Broadcast Mode (mismo prompt a 2 agentes, comparar) y chip de puertos → Browser cell.
- **Min 20–25 — Modelo de datos y costos.** Sin slide: *"Your devs keep their own API keys. The agents run locally in their terminals. Nest doesn't proxy your code to models or resell tokens — flat seat price, no model lock-in."* Responder preguntas de seguridad según §5.1 (¡solo lo aprobado!).
- **Min 25–30 — Next step concreto.** *"Here's what I suggest: a 30-day pilot, 4–10 devs from one team, success criteria we agree on day one, decision at day 30 with no obligation. Bautista sends you the proposal within 48 hours. Who'd own the pilot on your side?"* Conseguir: nombre del pilot owner + fecha tentativa de kickoff.

**Prohibido en la call:** prometer features no shippeadas (Jira/Slack/Notion, SSO, self-hosting), dar fechas de roadmap comprometidas, claims de seguridad no aprobados por Eliseo, y el dato falso de "11.4h revisando vs 9.8h escribiendo".

## 5. Manejo de las 5 objeciones más probables

### 5.1 "¿Qué pasa con la seguridad de nuestro código/datos?"

**Respuesta (lo único aprobado para decir):**
> "Nest is a desktop app. The AI agents run locally in your developers' terminal sessions, using their own provider credentials — Nest doesn't proxy your source code to model providers or resell tokens. What we store in our cloud backend is account, team and workspace metadata. We're an early-stage company: we don't have SOC 2 or a formal security certification yet, and I'd rather tell you that directly than dance around it. For anything deeper, I'll connect you with Eliseo, our CISO, and we'll answer your security questionnaire in writing."

**Cuidado (claims prohibidos del brief):**
- NO afirmar nada sobre cómo se almacenan o protegen tokens/credenciales (hay un pendiente interno conocido al respecto — cualquier claim de seguridad de tokens está prohibido hasta que Eliseo lo apruebe por escrito).
- NO decir "tu código nunca sale de tu máquina" a secas: el terminal sharing transmite contenido de la terminal, y hay metadata en nuestro backend. Precisión > marketing.
- Toda respuesta de seguridad POR ESCRITO pasa por Eliseo antes de enviarse.

### 5.2 "Ya usamos Cursor"

**Respuesta (encuadre oficial del brief):**
> "Perfect — keep it. We're not the same thing; we're complementary. Cursor is where a developer edits. Nest is where the team dispatches multiple agents in parallel, isolates each one in its own git worktree, verifies the diffs, and shares live sessions across the team. Your devs don't switch editors; they get the team layer around the agent CLIs they already run next to Cursor."

**Señal de calificación:** si TODO su flujo de IA vive dentro del IDE y no usan ningún CLI de agentes, son C por ahora (§3). No forzar.

### 5.3 "Esto lo hacemos gratis con tmux"

**Respuesta:**
> "Some of your devs probably do — ours did too, that's why we built this. Three things tmux won't give you: git worktrees managed from the UI so each agent works isolated and you review diffs before merge; live terminal sharing with an 8-character code so a senior can watch a junior's agent session without a screen-share call; and one identical experience across macOS, Windows and Linux with zero per-dev config. tmux scales with your most patient developer. Nest makes the whole team's baseline the power-user setup — the 30-day pilot is exactly the test: if tmux really covers it, you'll know by day 30 and you walk away."

No pelear la objeción en abstracto: invitarla al pilot. Es la objeción que mejor se autodestruye con uso real.

### 5.4 "¿Compliance? ¿Self-hosting / on-prem?"

**Respuesta honesta:**
> "Straight answer: no. Today Nest is a cloud-backed desktop app — no self-hosted or on-prem option, no SOC 2, no SSO/SAML yet. We're an early-stage company and I'm not going to pretend otherwise. What I can offer: the agents and your code run locally on your developers' machines with their own keys, we'll answer your security review in writing, and enterprise design partners have real input on what we build next — if self-hosting or SSO is the blocker between us and a signed deal, that's exactly the signal that moves it up our roadmap. If it's a hard legal requirement before even a pilot, we're probably not your tool *yet* — and I'll tell you that instead of wasting your quarter."

**Interno:** registrar CADA pedido de SSO/SOC2/self-hosting en un log (cuenta, seats potenciales, si fue blocker). Ese log es el business case del roadmap enterprise.

### 5.5 "$60/seat/mes es caro" (vs Team a $35)

**Respuesta:**
> "Two things are in that number. First, what's not in it: Nest never charges for model usage — your AI spend stays exactly where it is, with your providers, and you keep the freedom to switch models any day. Nest is a flat, predictable seat cost with zero token markup. Second, Enterprise at this stage means the founding team onboards your team personally, you get a direct line to the people who wrote the code, and real influence on the roadmap — that's what the $25 over the self-serve Team plan buys. And the floor is $60 with a 4-seat minimum: for a 10-dev team that's $7,200 a year — compare that against one week of one senior debugging 'almost right' agent output across the team."

**Reglas de negociación:** el piso de $60/seat/mes anual NO se perfora. Mínimo 4 seats NO se perfora. Variables permitidas: precio/estructura del pilot (pagado y acreditable — default —, o gratis con kickoff firmado y pilot owner nombrado), duración del pilot, y seats iniciales vs. expansión a 90 días. Si solo pueden pagar $35/seat: plan Team self-serve, sin vergüenza — es una buena puerta de entrada.

## 6. Qué pedir al cierre (de cada interacción)

Nunca terminar una interacción sin un compromiso concreto con fecha:

| Momento | Qué se pide |
|---|---|
| Primera respuesta al inbound | Respuesta a las 3 preguntas de calificación. |
| Al calificar A/B | Booking del Calendly de Matías, con fecha, y quién asiste (idealmente el decisor + un tech lead con repo). |
| Fin de la demo (min 25–30) | (1) Nombre del **pilot owner** del lado del cliente, (2) tamaño del pilot team (4–10), (3) fecha tentativa de kickoff. |
| Al enviar la propuesta | Confirmación por escrito de pilot owner y fecha de kickoff antes del vencimiento (30 días). |
| Review día 30 del pilot | La decisión, en la misma call: expandir a N seats anual, o cierre honesto del pilot. Si piden "tiempo para pensarlo": fecha concreta de decisión ≤2 semanas y qué información les falta. |
| Cierre | Firma + factura anual. Gero entra a la call de firma si el deal es ≥20 seats. |

**Higiene de pipeline:** cada lead enterprise con estado (Nuevo → Calificado → Demo → Propuesta → Pilot → Cerrado ganado/perdido) y motivo de pérdida textual. Con el volumen actual alcanza una hoja de cálculo compartida; el hábito importa más que la herramienta.
