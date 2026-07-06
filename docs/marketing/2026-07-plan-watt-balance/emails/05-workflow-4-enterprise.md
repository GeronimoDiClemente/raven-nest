# Workflow 4 — Secuencia enterprise (Perfil C)

> **Objetivo:** abrir conversación con decisores (CTO / VP Engineering) en empresas de ~10-50 devs. No se vende un plan por email: se consigue una reunión. Enterprise es sales-led, sin checkout.
> **Entrada:** contacto clasificado C **a mano** por Bautista (lista corta y curada, ver `01-segmentacion.md`).
> **Salida:** agenda demo → pipeline manual, sale del workflow. Respuesta a cualquier email → pausa automática (conversación 1:1 la sigue Bautista). Unsubscribe → sale.
> **Remitente:** Bautista \<bautista@nestmux.com\>. Emails **en texto plano**, sin template HTML: a este nivel tienen que parecer escritos a mano (porque casi lo están — la lista es chica, revisar cada envío).
> **Dependencia:** el Email 3 adjunta el deck enterprise, que es entregable de la semana 11 del plan (playbook enterprise). No activar la secuencia completa antes de tener el deck.

---

## Email 1 — Presentación institucional

- **Trigger/timing:** al entrar a la lista C, día 0.
- **Subject:** Nest by RAVEN — who we are, in 60 seconds
- **Subject B:** The company behind the multi-agent terminal
- **Preheader:** Four founders, a shipping desktop product, and one signal we didn't expect.

**Cuerpo:**

```
{{first_name}},

Brief intro, no deck attached.

Nest by RAVEN builds Nestmux: a desktop terminal workspace
(macOS, Windows, Linux) where a dev team runs multiple AI
agents — Claude, Gemini, Codex, Copilot — side by side, each
panel with its own session, account and environment. Git
worktrees per agent, live terminal sharing, GitHub & GitLab
with CI runs in one dashboard.

We're four founders who built it to solve our own workflow
working in parallel for a US company, launched on Product Hunt
this June, and got a signal we didn't expect: a VP at Huawei
reached out cold before we even launched. That told us the
problem isn't just ours.

One relevant detail for a buyer: devs use their own API keys
and CLI subscriptions. We don't resell tokens, so there's no
per-token bill hiding behind the seat price.

I'll follow up with one specific question next week. If this is
already relevant, reply and skip the queue.

— Bautista
CMO, Nest by RAVEN
bautista@nestmux.com
```

- **CTA:** reply (sin botón; texto plano).
- **Personalización:** `{{first_name}}`, `{{company}}` si se quiere abrir con "Saw {{company}} is scaling its platform team" — solo si es verdad y verificado a mano.

---

## Email 2 — Pregunta de calificación

- **Trigger/timing:** día 5. **Condición:** no respondió el Email 1.
- **Subject:** How many AI agents does {{company}} run in parallel today?
- **Subject B:** One question about your team's AI setup
- **Preheader:** One click. It tells me whether I should keep emailing you.

**Cuerpo:**

```
{{first_name}},

One question, one click:

How many AI coding agents does your team run in parallel on a
normal day?

→ [ None yet — evaluating ]
→ [ One per dev, roughly ]
→ [ Several per dev, it's getting messy ]

Clicking is answering. If it's the third one, you're exactly
who we built this for and I'd like 20 minutes. If it's the
first, I'll send you something useful for the evaluation and
otherwise leave you alone.

— Bautista
```

- **CTA:** 3 links de 1 click → tags en Brevo (`ent_qualify_none`, `ent_qualify_one`, `ent_qualify_many`). `ent_qualify_many` dispara notificación interna a Bautista para follow-up manual el mismo día.
- **Personalización:** `{{first_name}}`, `{{company}}`.

---

## Email 3 — Propuesta de demo + deck

- **Trigger/timing:** día 12. **Condición:** no agendó ni respondió.
- **Subject:** 25 minutes with your platform lead in the room
- **Subject B:** Nest for {{company}} — demo + the numbers
- **Preheader:** How teams run and verify parallel agents. Deck attached, demo optional.

**Cuerpo:**

```
{{first_name}},

Attached is the short deck we use with engineering leadership:
how teams run multiple AI agents in parallel with isolation
(git worktrees per agent), verification built in (diff viewer,
side-by-side panels) and actual visibility for leads (live
terminal sharing, CI in one dashboard).

The commercial frame, so there are no surprises in the call:
enterprise starts at $60/seat/month, billed annually, minimum
4 seats. Devs bring their own AI keys — no usage bill on top.

If it's worth 25 minutes, pick a slot and bring whoever owns
developer tooling: {{url_calendly}}

— Bautista

[Adjunto: {{url_deck_pdf}}]
```

- **CTA:** `Book the demo` → `{{url_calendly}}` (https://calendly.com/matias-nestmux/new-meeting)
- **Personalización:** `{{first_name}}`, `{{company}}`. Deck: `{{url_deck_pdf}}` — entregable de la semana 11, bloqueante.

---

## Email 4 — Caso de uso por industria

- **Trigger/timing:** día 20. **Condición:** no agendó.
- **Subject:** How this plays out for a team like yours
- **Subject B:** {{industry}} teams and parallel agents — the specific fit
- **Preheader:** One concrete scenario for {{company}}, then I'll stop guessing.

**Cuerpo:**

```
{{first_name}},

One concrete scenario instead of another feature list:

{{industry_snippet}}

[Ejemplo del snippet — redactar a mano por contacto, la lista
es corta. Patrón: "A team your size typically has N devs each
running an agent on a shared monolith. The failure mode is X.
With one worktree per agent and shared terminal sessions, X
becomes Y."]

If I'm guessing wrong about how your team works, correct me in
one line and I'll answer with something actually relevant.

— Bautista
```

- **CTA:** reply.
- **Personalización:** `{{first_name}}`, `{{industry_snippet}}` — **escrito a mano por contacto**. No automatizar esto: con una lista de decenas de contactos, 10 minutos por email rinden más que cualquier template.

---

## Email 5 — Último intento: piloto

- **Trigger/timing:** día 30. **Condición:** no agendó ni respondió nada.
- **Subject:** Last one from me — a 30-day pilot for your team
- **Subject B:** Closing the loop on Nest
- **Preheader:** Full team, 30 days, no commitment. Then I stop emailing.

**Cuerpo:**

```
{{first_name}},

Closing the loop — this is the last email in this sequence.

The offer: a 30-day pilot of Nest for your full team. Real
onboarding with us, worktrees and sharing configured on your
repos, no commitment at the end. If after 30 days it didn't
change how your team works with agents, we part ways and
you've lost nothing but the install time.

If yes: {{url_calendly}}
If never: reply "no" and I'll close the file properly.

— Bautista
```

> ⚠️ REQUIERE DECISIÓN: este piloto de 30 días no existe como mecánica hoy (no hay flujo en Stripe ni proceso definido de provisioning temporal de seats Team/Enterprise). Definir con Matías cómo se otorga y se revoca el acceso antes de activar este email.

- **CTA:** `Set up the pilot` → `{{url_calendly}}`
- **Personalización:** `{{first_name}}`. Reply "no" → tag `ent_closed_lost` + nota de motivo en el pipeline.

---

## KPIs del workflow y cómo medirlos

| Métrica | Objetivo | Cómo se mide |
|---|---|---|
| Open rate | >40% | Brevo; con lista de decenas de contactos, mirar números absolutos y aperturas por contacto. |
| CTR / respuesta | >8% (acá cuentan también las replies, no solo clicks) | Clicks en Brevo + replies registradas a mano por Bautista. |
| Reuniones agendadas | métrica primaria (el objetivo es conversación, no trial) | Calendly con UTM `wf4-*` + registro en pipeline. |
| Calificación de la base | 100% de la lista C con tag `ent_qualify_*` o `ent_closed_lost` al día 45 | Tags en Brevo. |

Nota: el KPI ">5% conversión a trial" de la propuesta no aplica a este workflow (no hay trial ni checkout enterprise); el equivalente es reuniones agendadas / contactos que completaron la secuencia.
