# Workflow 5 — Reactivación de contactos fríos (Perfil D)

> **Objetivo:** convertir contactos dormidos (leads de PH/LinkedIn/eventos sin cuenta, o cuentas sin actividad >30 días) en usuarios activos en 30 días.
> **Entrada:** contacto clasificado D. Dos sub-audiencias con el mismo copy pero CTA distinto: **D1** nunca instaló (`{{url_download}}`), **D2** instaló y abandonó (`{{deep_link_new_panel}}` + fallback a download).
> **Salida:** `session_started` → sale de WF5 y entra a WF1 como usuario nuevo (D1) o recibe solo los emails 2-3 de WF1 (D2). Unsubscribe → sale de todo. Sin ningún open/click al final de la secuencia → tag `cold_suppressed`, no volver a enviar (protege la reputación del dominio).
> **Remitente:** Gero from Nest \<gero@nestmux.com\>.
> **Higiene previa:** validar la lista (bounces) antes del primer envío y mandar en tandas para calentar el subdominio `mail.nestmux.com`.

---

## Email 1 — El lanzamiento

- **Trigger/timing:** al entrar al segmento, día 0.
- **Subject:** Nestmux launched. This is what it does.
- **Subject B:** Your terminals, your AI agents, one window
- **Preheader:** 10 seconds of GIF beats 3 paragraphs. Look.

**Cuerpo:**

```
{{first_name}},

You crossed paths with Nest at some point — here's what
actually shipped.

[GIF: grid con Claude + Codex + terminal + browser cell
corriendo en paralelo, Ctrl+L ciclando layouts — producir
para este email, ~10s en loop]

Nestmux: a desktop terminal workspace where AI agents run side
by side — Claude, Gemini, Codex, Copilot — each panel with its
own session, account and environment. macOS, Windows, Linux.

Free plan: 3 panels, all AIs, permanent. Your own API keys, so
there's no bill from us.

{{url_download}}

— Gero
Co-founder, Nest by RAVEN
```

- **CTA:** `Download Nest — Free` → `{{url_download}}` (D2: `Open Nest` → `{{deep_link_new_panel}}`)
- **Personalización:** `{{first_name}}`; si `SIGNUP_SOURCE = product_hunt`: "You found us on Product Hunt back in June."

---

## Email 2 — Diferenciación

- **Trigger/timing:** día 3. **Condición:** no emitió `session_started`.
- **Subject:** No, it's not another AI coding assistant
- **Subject B:** Cursor writes your code. Nest is where your agents run.
- **Preheader:** The one-sentence answer to "isn't this just X?"

**Cuerpo:**

```
{{first_name}},

The question everyone asks: "isn't this just Cursor / another
AI assistant?"

No — and they're not competitors. Cursor is an editor that
writes code with you. Nest is the workspace where you *run and
verify* agents — several of them, in parallel, in real terminal
sessions. Plenty of people use both. We're complementary, not
a replacement.

What you can't do elsewhere in one window:

- Run Claude, Gemini, Codex and Copilot side by side, each with
  its own account, history and environment
- Give each agent its own git worktree from the UI, so they
  don't trash each other's work
- See which port each panel's process is listening on — even
  servers your agent launched — and open it in a built-in
  browser with one click

Free, 3 panels, forever: {{url_download}}

— Gero
```

- **CTA:** `Try it free` → `{{url_download}}`
- **Personalización:** `{{first_name}}`.

---

## Email 3 — Prueba social

- **Trigger/timing:** día 7. **Condición:** no emitió `session_started`.
- **Subject:** 90 developers run their agents in Nest
- **Subject B:** What actual users say after week one
- **Preheader:** Real numbers, real quotes, no case-study theater.

**Cuerpo:**

```
{{first_name}},

Where Nest is at, with real numbers because you'd smell
inflated ones:

- 90 active developers since the Product Hunt launch in June
- A single LinkedIn post about it did 40,000 impressions
- Before we even launched, a VP at Huawei DMed us cold asking
  about it

What users say:

> "{{quote_1}}"
> — {{quote_1_author}}

> "{{quote_2}}"
> — {{quote_2_author}}

Small tool, early days, growing in public. If you want to see
what the fuss is about: {{url_download}}

— Gero
```

> ⚠️ REQUIERE DECISIÓN: los quotes no existen todavía como asset. Hay que recolectar 2-3 testimonios reales (reviews de PH, DMs, replies) **con permiso explícito del autor** antes de activar este email. No inventar quotes ni parafrasear DMs sin autorización.

- **CTA:** `See for yourself` → `{{url_download}}`
- **Personalización:** `{{first_name}}`, `{{quote_1}}`, `{{quote_2}}` + autores.

---

## Email 4 — Última llamada: descarga directa

- **Trigger/timing:** día 14. **Condición:** no emitió `session_started`. Último email de la secuencia.
- **Subject:** Two minutes to your first parallel agent
- **Subject B:** Last one — install, split, run
- **Preheader:** Download, open, add two panels. That's the whole onboarding.

**Cuerpo:**

```
{{first_name}},

Last email in this series — after this we leave your inbox
alone.

The entire onboarding, honestly:

1. Download (macOS / Windows / Linux): {{url_download}}
2. Open Nest, add a panel, pick an agent. If its CLI isn't
   installed, the banner installs it for you in one click,
   live log included.
3. Add a second panel with a different agent. Done — you're
   running agents in parallel.

Free plan, 3 panels, no card, no trial clock. Your own API
keys, so the only thing you're spending is two minutes.

{{url_download}}

— Gero
```

- **CTA:** `Download Nest` → `{{url_download}}` (D2: `Pick up where you left off` → `{{deep_link_new_panel}}`)
- **Personalización:** `{{first_name}}`, `OS` si se conoce (linkear el instalador directo de su plataforma).

---

## KPIs del workflow y cómo medirlos

| Métrica | Objetivo | Cómo se mide |
|---|---|---|
| Open rate | >40% (esperar menos en base fría; <20% sostenido = problema de lista o de dominio) | Brevo, por email y por sub-audiencia D1/D2. |
| CTR | >8% | Brevo, clicks únicos / entregados. |
| Reactivación (métrica primaria) | % de la cohorte que emite `session_started` en 30 días | Evento `session_started` en Brevo cruzado con membresía del segmento; descargas atribuidas por UTM `wf5-*` en `{{url_download}}`. |
| Higiene | Bounce <2%, spam complaints <0.1% | Dashboard de deliverability de Brevo; si se supera, pausar el workflow y limpiar la lista. |

Nota: la conversión a pago NO es KPI de este workflow — un D reactivado entra a WF1/WF2 y convierte ahí. Medir la cadena completa (D → activo → Pro) por cohorte mensual en la revisión de KPIs del día 90.
