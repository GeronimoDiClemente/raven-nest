# Workflow 2 — Trigger de upgrade por comportamiento (Perfil A)

> **Objetivo:** interceptar al usuario Free en el momento exacto en que toca el techo del plan.
> **Entrada:** evento `paywall_hit` con propiedad `feature_hit` (ver instrumentación en `01-segmentacion.md` §4). Sin ese evento este workflow no puede activarse — es prerequisito técnico.
> **Frequency cap:** máximo 1 entrada al workflow cada 14 días por contacto, aunque pegue el paywall 20 veces. Al entrar acá, WF1 se pausa 72 h.
> **Salida:** `subscription_started` → sale inmediatamente. Unsubscribe → sale de todo.
> **Remitente:** Gero from Nest \<gero@nestmux.com\>.

> ⚠️ REQUIERE DECISIÓN (afecta a todo el workflow): la propuesta estructura los emails 2-4 alrededor de un **trial de 7 días sin tarjeta** y una **oferta de 30 días al 50%**. Ninguna de las dos existe en Stripe hoy. Se incluyen como los pide la propuesta, con la rama alternativa "sin trial" al final del documento. No activar los emails 2-4 hasta decidir.

---

## Email 1 — El momento del paywall

- **Trigger/timing:** `paywall_hit`, envío inmediato (dentro de los 5 minutos — el contexto se enfría rápido).
- **Subject:** You just hit the Free ceiling
- **Subject B:** That button you clicked — here's what it does
- **Preheader:** {{feature_hit}} is a Pro feature. This is what's on the other side.

**Cuerpo (con bloque dinámico según `{{feature_hit}}`):**

```
{{first_name}},

You just tried to use {{feature_hit}} — that's past the Free
line. Here's what it actually does:

[BLOQUE DINÁMICO — elegir según feature_hit]

• broadcast: **Broadcast Mode** sends the same prompt to several
  agents at once. Same task, different models, compare the
  outputs side by side. It's the fastest way to catch the "AI
  that's almost right" problem — you see who got it wrong.

• panel_limit: **Free caps at 3 panels. Pro goes to 12**, with
  11 tiling layouts. Enough to run agents, a plain terminal, a
  dev server and a browser cell in one window.

• worktrees: **Native git worktrees** — create and manage them
  from the UI. Each agent works isolated in its own copy of the
  repo. Two agents, two branches, zero conflicts.

• my_repos: **My Repos** — your GitHub & GitLab repos with CI
  runs visible in one dashboard, next to your terminals.

• [default: otras features] **That's part of Pro** — along with
  12 panels, Broadcast Mode, worktrees, My Repos, voice input,
  snippets, saved workspaces, diff viewer and Spotlight.

[FIN BLOQUE DINÁMICO]

Pro is $20/month ($15/month yearly). Your own API keys — no
token markup from us.

One click starts a 7-day trial, no credit card:
{{url_trial_pro}}

— Gero
```

> ⚠️ REQUIERE DECISIÓN: este trial de 7 días sin tarjeta no existe en Stripe hoy. Fallback: último párrafo → `Unlock it now: {{url_checkout_pro}}`.

- **CTA:** `Start the 7-day trial` → `{{url_trial_pro}}` (fallback: `Upgrade to Pro — $20/mo` → `{{url_checkout_pro}}`)
- **Personalización:** `{{first_name}}`, `{{feature_hit}}` (elige el bloque dinámico y aparece en subject/preheader como nombre legible: "Broadcast Mode", "the 4th panel", "worktrees", "My Repos").

---

## Email 2 — Refuerzo de valor durante el trial

- **Trigger/timing:** día 3 del trial. **Condición:** empezó el trial y no convirtió aún.

> ⚠️ REQUIERE DECISIÓN: depende del trial de 7 días, que no existe en Stripe hoy.

- **Subject:** Getting the most out of {{feature_hit}}
- **Subject B:** Day 3 of 7 — one workflow worth stealing
- **Preheader:** A concrete way to use the feature you unlocked.

**Cuerpo:**

```
{{first_name}},

You're on day 3 of your Pro trial. One concrete workflow for
{{feature_hit}} before it's over:

[BLOQUE DINÁMICO]

• broadcast: Pick a bug you're stuck on. Broadcast the same
  prompt to Claude and Codex, diff their answers in the built-in
  diff viewer. When two models disagree, that's usually where
  your bug is.

• worktrees: Create one worktree per agent from the UI, give
  each a feature branch. Merge when they're done. No more "the
  agent overwrote my working tree".

• panel_limit: Try the layout you couldn't build before: agent +
  agent + plain terminal + browser cell, Ctrl/Cmd+L until the
  grid fits.

• my_repos: Pin your 3 most active repos in My Repos and keep CI
  runs visible while your agents work. Red CI, you know in
  seconds — not when you next open GitHub.

[FIN BLOQUE DINÁMICO]

4 days left: {{deep_link_feature}}

— Gero
```

- **CTA:** `Open it in Nest` → `{{deep_link_feature}}` (resuelve a `{{deep_link_broadcast}}`, `{{deep_link_worktrees}}`, etc. según `feature_hit`)
- **Personalización:** `{{first_name}}`, `{{feature_hit}}`.

---

## Email 3 — El trial termina mañana

- **Trigger/timing:** día 6 del trial. **Condición:** no convirtió.

> ⚠️ REQUIERE DECISIÓN: depende del trial de 7 días, que no existe en Stripe hoy.

- **Subject:** Your Pro trial ends tomorrow
- **Subject B:** Tomorrow: back to 3 panels
- **Preheader:** No pressure — just so you know exactly what changes.

**Cuerpo:**

```
{{first_name}},

Heads up: your Pro trial ends tomorrow. No pressure play here —
just clarity on what changes if you do nothing:

- Panels go back to 3 (your sessions are safe, extra panels
  just close)
- Broadcast Mode, worktrees, My Repos, snippets, voice,
  Spotlight and diff viewer lock again
- Free stays free, forever. Nothing gets deleted.

If Pro earned its keep this week: $20/month, or $180/year
($15/month, 25% off).

{{url_checkout_pro}}

Either way, thanks for actually trying it.

— Gero
```

- **CTA:** `Keep Pro — $20/mo` → `{{url_checkout_pro}}` · CTA secundario: `Or $15/mo billed yearly` → `{{url_checkout_pro_annual}}`
- **Personalización:** `{{first_name}}`.

---

## Email 4 — Oferta única post-trial

- **Trigger/timing:** día 8 (trial vencido + 1 día). **Condición:** no convirtió. Se envía **una sola vez en la vida del contacto**.

> ⚠️ REQUIERE DECISIÓN: este descuento de 30 días al 50% no existe en Stripe hoy (requiere crear un coupon con redención única y expiración). Además fija un precedente de descuentos — decidir si Nest quiere entrenar a la base a esperar ofertas.

- **Subject:** One-time offer, expires Friday
- **Subject B:** 50% off your first month — once, and never again
- **Preheader:** Your trial ended. This is the only discount we'll ever send you.

**Cuerpo:**

```
{{first_name}},

Your trial ended and you didn't convert. Fair. Last thing from
me on this:

**50% off your first 30 days of Pro** — $10 instead of $20.
One time. Expires {{offer_expiry_date}}. We won't send another
discount after this, that's a promise, not a tactic.

{{url_checkout_pro_discount}}

If price isn't the issue, just reply and tell me what is.

— Gero
```

- **CTA:** `Claim 50% off` → `{{url_checkout_pro_discount}}` (checkout Stripe con coupon aplicado)
- **Personalización:** `{{first_name}}`, `{{offer_expiry_date}}` (fecha de envío + 3 días).

---

## Rama alternativa SIN trial (usable hoy, sin cambios en Stripe)

Mientras el trial no exista: **solo Email 1** (con fallback a checkout directo) + un Email 2' al día 4:

- **Email 2' — día 4 post-paywall, si no convirtió.** Subject: `Still bumping into the Free ceiling?` / B: `The math on Pro` — Preheader: `$15/month yearly. Your API keys. That's the whole bill.`

```
{{first_name}},

You hit the Free limit on {{feature_hit}} a few days ago and
you're still on Free.

The math, since you'll do it anyway: Pro is $180/year — $15 a
month. Nest doesn't resell tokens, you bring your own API keys,
so that's the entire bill for 12 panels, Broadcast, worktrees
and My Repos.

If 3 panels genuinely covers you, ignore me. If not:
{{url_checkout_pro_annual}}

— Gero
```

- **CTA:** `Go Pro yearly — $15/mo` → `{{url_checkout_pro_annual}}`

---

## KPIs del workflow y cómo medirlos

| Métrica | Objetivo | Cómo se mide |
|---|---|---|
| Open rate | >40% | Stats de automation en Brevo por email (usar CTR para decidir, MPP infla opens). |
| CTR | >8% | Clicks únicos / entregados, Brevo. |
| Conversión a trial | >5% de quienes reciben Email 1 | Evento `trial_started` (webhook Stripe → Brevo) atribuido por UTM `wf2-e1`. **Solo medible si el trial existe.** |
| Conversión trial→pago (si hay trial) | benchmark propio, medir | `subscription_started` sobre `trial_started`. |
| Conversión directa (rama sin trial) | >5% de quienes reciben Email 1 | `subscription_started` en los 7 días post-Email 1, UTM `wf2-*`. |

Este es el workflow de mayor intención de todo el sistema: si acá el CTR no supera 8%, el problema es el copy del bloque dinámico o el pricing, no el canal.
