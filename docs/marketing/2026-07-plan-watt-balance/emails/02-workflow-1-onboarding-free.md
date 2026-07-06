# Workflow 1 — Onboarding de usuario Free nuevo (Perfil A)

> **Objetivo:** llevar al usuario nuevo a su primer momento de valor (2+ agentes corriendo en paralelo) en las primeras 48 h, y plantarle el techo del plan Free antes del día 10.
> **Entrada:** evento `signed_up` (alta en Supabase).
> **Salida (exit rules):** `subscription_started` → sale del workflow y NO recibe emails pendientes. Unsubscribe → sale de todo. Si dispara `paywall_hit`, WF2 lo intercepta y WF1 pausa 72 h (no mandar dos emails el mismo día).
> **Remitente:** Gero from Nest \<gero@nestmux.com\>.

---

## Email 1 — Bienvenida

- **Trigger/timing:** `signed_up`, envío inmediato (hora 0).
- **Subject:** Your terminal just got roommates
- **Subject B:** Welcome to Nest — the 2-minute version
- **Preheader:** Claude, Gemini and Codex side by side. One window, one workspace.

**Cuerpo:**

```
Hey {{first_name}},

Thanks for installing Nest. Quick version of what you just got:

A terminal multiplexer built for AI agents. Claude, Gemini, Codex,
Copilot — side by side in one window, each panel with its own
session, account, history and environment.

One thing to do today: open Nest and add a second panel with a
different agent. That's the moment it clicks.

Here's the whole thing in 2 minutes:
{{url_video_demo}}

If anything breaks, reply to this email. I read every one.

— Gero
Co-founder, Nest by RAVEN
```

- **CTA:** `Watch the 2-min demo` → `{{url_video_demo}}`
- **Personalización:** `{{first_name}}`. Si `SIGNUP_SOURCE = product_hunt`, agregar primera línea: "Saw you came from Product Hunt — welcome."

---

## Email 2 — Primer agente en paralelo

- **Trigger/timing:** día 2. **Condición:** no emitió `session_started` con 2+ paneles (si el evento de conteo de paneles no está instrumentado, enviar a todos los que no clickearon el Email 1).
- **Subject:** Have you run two agents at once yet?
- **Subject B:** The 3-step checklist for your first parallel run
- **Preheader:** Split the grid, pick two AIs, watch them work. ~90 seconds.

**Cuerpo:**

```
{{first_name}},

The whole point of Nest is running agents in parallel. If you
haven't yet, here's the 90-second path:

1. Open Nest and hit Ctrl/Cmd+L to cycle layouts — sessions
   don't restart when the grid changes.
2. Add a second panel and pick a different agent (Claude next
   to Codex is a good first pair).
3. Give each one a different task. When an agent starts a dev
   server, the port shows up as a chip on the panel — click it
   to open the built-in browser.

That's it. Two agents, two tasks, one window.

— Gero
```

- **CTA:** `Open Nest and split the grid` → `{{deep_link_new_panel}}`
- **Personalización:** `{{first_name}}`. Si `OS = windows/linux/mac`, ajustar `Ctrl` vs `Cmd` en el texto.

---

## Email 3 — Tip técnico

- **Trigger/timing:** día 5.
- **Subject:** The port chip trick most people miss
- **Subject B:** One shortcut, 11 layouts, zero restarts
- **Preheader:** Two small features that make parallel agents actually usable.

**Cuerpo:**

```
{{first_name}},

Two things in Nest that people find by accident and then use
every day:

**Port detection per panel.** When any process in a panel starts
listening on a port — even a dev server your agent launched and
re-parented — a chip with the port appears on that panel. Click
it and the app opens the page in an internal Browser cell. No
alt-tabbing to check what the agent actually built.

**Ctrl/Cmd+L cycles through 11 tiling layouts** without
restarting a single session. Wide layout for reviewing, grid for
running, single for focus.

Try both today: {{deep_link_layouts}}

— Gero
```

- **CTA:** `Cycle your layout` → `{{deep_link_layouts}}`
- **Personalización:** `{{first_name}}`, `OS` para el shortcut.

---

## Email 4 — El techo del plan Free

- **Trigger/timing:** día 10. **Condición:** `PLAN = free`.
- **Subject:** What's behind the Pro line
- **Subject B:** Free gets you 3 panels. Here's what 12 looks like.
- **Preheader:** Broadcast, worktrees, My Repos — the stuff Free doesn't have.

**Cuerpo:**

```
{{first_name}},

Straight talk about the Free plan: it's 3 panels, all AIs,
forever. No time bomb.

What it doesn't have:

- **12 panels** instead of 3
- **Broadcast Mode** — same prompt to several agents at once,
  compare the outputs
- **Git worktrees from the UI** — each agent works isolated in
  its own copy of the repo, no stepping on each other
- **My Repos** — your GitHub & GitLab repos and CI runs in
  one dashboard
- Plus voice input, snippets, saved workspaces, diff viewer,
  Spotlight, live terminal sharing

Pro is $20/month, or $15/month if you pay yearly. You bring
your own API keys, so that's the entire cost — we don't resell
tokens.

Try Pro free for 7 days, no credit card: {{url_trial_pro}}

— Gero
```

> ⚠️ REQUIERE DECISIÓN: este trial de 7 días sin tarjeta no existe en Stripe hoy. Mientras no exista, reemplazar el último párrafo por: `See what Pro unlocks: {{url_pricing}}` y el CTA por el checkout directo.

- **CTA:** `Start the 7-day trial` → `{{url_trial_pro}}` (fallback sin trial: `See Pro pricing` → `{{url_pricing}}`)
- **Personalización:** `{{first_name}}`, `{{plan}}` (solo enviar si `free`).

---

## Email 5 — ¿Qué te frenó?

- **Trigger/timing:** día 21. **Condición:** `PLAN = free` (no convirtió).
- **Subject:** One question, one click
- **Subject B:** What stopped you?
- **Preheader:** No pitch. Just tell me which one it is.

**Cuerpo:**

```
{{first_name}},

You've had Nest for three weeks and stayed on Free. Totally
fine — but I'd like to know why, because it decides what we
build next.

One click, that's the whole survey:

→ [ Too expensive ]
→ [ 3 panels is enough for me ]
→ [ Missing a feature I need ]
→ [ I stopped using Nest ]

(Each is a link — clicking is answering.)

If it's a missing feature, reply and tell me which one. I read
every answer.

— Gero
```

- **CTA:** 4 links de 1 click; cada uno taggea al contacto en Brevo (`churn_reason_price`, `churn_reason_no_need`, `churn_reason_feature`, `churn_reason_inactive`). El tag `churn_reason_inactive` mueve el contacto al Perfil D (WF5) a los 30 días.
- **Personalización:** `{{first_name}}`.

---

## KPIs del workflow y cómo medirlos

| Métrica | Objetivo | Cómo se mide |
|---|---|---|
| Open rate | >40% | Estadísticas de la automation en Brevo, por email. Ojo: Apple MPP infla opens — usar CTR como métrica de decisión. |
| CTR | >8% | Clicks únicos / entregados, por email, en Brevo. |
| Activación (proxy de valor) | — | % de receptores del Email 2 que emiten `session_started` en las 48 h siguientes. |
| Conversión Free→Pro | >5% de la cohorte que recibe Email 4 | Evento `subscription_started` (webhook Stripe→Brevo) dentro de los 14 días post-Email 4, cruzado con UTM `wf1-e4` en el checkout. |

Revisión semanal durante la Fase 3; el subject ganador del A/B se fija cuando haya ≥200 envíos por variante (con la base actual, esperar volumen antes de declarar ganador).
