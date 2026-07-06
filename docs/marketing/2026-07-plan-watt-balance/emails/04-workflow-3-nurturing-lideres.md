# Workflow 3 — Nurturing para líderes técnicos (Perfil B)

> **Objetivo:** construir el caso de valor para equipos antes de pitchear el plan Team. B no compra por "cuánto te ahorra a vos" sino por "qué le da al equipo y qué visibilidad le da a él/ella como líder".
> **Entrada:** contacto clasificado como B (ver criterios en `01-segmentacion.md`). Entrada manual o por tag `role_leader`.
> **Salida:** agenda demo (click en Calendly) → pasa a pipeline comercial manual, sale del workflow. `subscription_started` con `plan=team` → sale. Unsubscribe → sale.
> **Remitente:** Bautista \<bautista@nestmux.com\> (rol comercial), firmando con contexto de equipo. Alternativa: Gero si se prefiere voz de founder — decidir y mantener consistencia.
> **Nota de posicionamiento:** el pitch central es **verificación + colaboración** (brief §Posicionamiento). No usar claims prohibidos; los datos de Stack Overflow 2025 (~49k devs) están permitidos.

---

## Email 1 — Editorial, cero pitch

- **Trigger/timing:** al entrar al segmento B, día 0.
- **Subject:** Only 17.3% of devs say AI improved team collaboration
- **Subject B:** AI made your devs faster. Did it make your team faster?
- **Preheader:** Stack Overflow asked ~49k developers. The answers are uncomfortable.

**Cuerpo:**

```
{{first_name}},

Three numbers from the 2025 Stack Overflow survey (~49k
developers) that should bother anyone running a team:

- 66% say their #1 frustration is AI code that's *almost*
  right
- 45% say debugging AI-generated code takes real time
- Only 17.3% believe AI agents improved their team's
  collaboration

So: individual output went up, verification cost went up with
it, and team coordination barely moved. Every dev on your team
is running agents — separately, invisibly, each in their own
window.

No product pitch today. Just the observation: the bottleneck
moved from writing code to verifying it and coordinating who's
doing what with which agent. Worth checking how your team
handles both.

— Bautista
Nest by RAVEN
```

- **CTA:** ninguno fuerte; link opcional `Read the write-up` → `{{url_post_collaboration}}` (post de LinkedIn/blog de la Fase 3.1 — coordinar con calendario de contenido).
- **Personalización:** `{{first_name}}`.

---

## Email 2 — Caso de uso para equipos de 3-10 devs

- **Trigger/timing:** día 7.
- **Subject:** How a 5-dev team runs agents without stepping on each other
- **Subject B:** Parallel agents, one repo, zero collisions
- **Preheader:** Worktrees per agent, live terminal sharing, CI in sight. The concrete setup.

**Cuerpo:**

```
{{first_name}},

The concrete setup we see working for teams of 3-10 devs
running AI agents daily:

**1. One worktree per agent.** Nest creates and manages git
worktrees from the UI. Each agent works isolated in its own
copy of the repo — two devs can point agents at the same repo
without trashing each other's working tree.

**2. Verification side by side.** Up to 12 panels per window,
built-in diff viewer. Reviewing what an agent did happens next
to the agent, not in a separate tool three alt-tabs away.

**3. Live terminal sharing with an 8-character code.** A dev
hits a wall with an agent, shares the terminal, the lead sees
the exact session — history, environment, everything. Debugging
AI output together instead of over screenshots.

**4. CI visible where the work happens.** My Repos shows
GitHub & GitLab repos and CI runs in one dashboard.

The value for you as lead: you can actually *see* how your team
works with agents, instead of finding out at review time.

— Bautista
```

- **CTA:** `See it in 2 minutes` → `{{url_video_demo}}`
- **Personalización:** `{{first_name}}`; si se conoce `{{team_size}}`, usarlo en el subject ("How a {{team_size}}-dev team...").

---

## Email 3 — Pitch del plan Team

- **Trigger/timing:** día 14.
- **Subject:** The Team plan, in plain numbers
- **Subject B:** $35/seat. Your devs bring their own API keys.
- **Preheader:** Everything in Pro, plus a real team workspace. Minimum 2 seats.

**Cuerpo:**

```
{{first_name}},

The commercial part, kept short:

**Nest Team — $35/seat/month** (or $26/seat/month billed
yearly, 25% off). Minimum 2 seats.

What each seat gets:
- Everything in Pro: 12 panels, Broadcast Mode, git worktrees
  from the UI, My Repos, diff viewer, snippets, voice input
- A real team workspace
- Live terminal sharing by 8-character code

What it costs beyond the seat: nothing from us. Every dev uses
their own API keys and CLI subscriptions — Nest doesn't resell
tokens, so there's no usage bill that scales behind your back.

Works on macOS, Windows and Linux, so nobody on the team is
left out.

Pricing details: {{url_pricing}}

— Bautista
```

- **CTA:** `See Team pricing` → `{{url_pricing}}`
- **Personalización:** `{{first_name}}`, `{{team_size}}` si existe ("For {{team_size}} devs that's ${{team_size_x26}}/month billed yearly" — calcular en el template).

---

## Email 4 — Demo sin pitch

- **Trigger/timing:** día 21. **Condición:** no agendó demo ni convirtió.
- **Subject:** 30 minutes, no pitch — we set it up with you
- **Subject B:** Bring your repo, leave with it running
- **Preheader:** A working session, not a sales call. Your repo, your team's setup.

**Cuerpo:**

```
{{first_name}},

Last email in this thread.

Offer: 30 minutes with us, screen shared, and we set Nest up
on your actual repo — worktrees, panels, sharing between two
of your devs. Not a sales deck; there isn't one. You leave
with a working setup, and if it's not for your team, you tell
us why and we both learned something.

Pick a slot: {{url_calendly}}

If the timing's wrong, reply with "later" and I'll come back
in a couple of months instead of dripping emails at you.

— Bautista
```

- **CTA:** `Book 30 minutes` → `{{url_calendly}}` (https://calendly.com/matias-nestmux/new-meeting)
- **Personalización:** `{{first_name}}`. Reply "later" → tag `nurture_paused_90d` (re-entrar al workflow en 90 días).

---

## KPIs del workflow y cómo medirlos

| Métrica | Objetivo | Cómo se mide |
|---|---|---|
| Open rate | >40% | Brevo, por email (segmento B es chico: leer números absolutos, no solo %). |
| CTR | >8% | Brevo, clicks únicos / entregados. |
| Demos agendadas | métrica primaria real (el objetivo de B no es trial, es conversación) | Bookings en Calendly con UTM `wf3-e4`, registrados a mano en el pipeline de Bautista. |
| Conversión a Team | medir por cohorte | `subscription_started` con `plan=team` dentro de 60 días de entrar al workflow. |

Nota: el objetivo ">5% conversión a trial" de la propuesta aplica a workflows de upgrade (WF1/WF2); acá el norte es demos agendadas por cada 100 contactos B que completan la secuencia.
