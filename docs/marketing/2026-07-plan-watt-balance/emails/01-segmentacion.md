# Segmentación de la base + plataforma de email

> Fase 3.2 del plan Watt Balance. Fuente de datos de producto: brief `00-brief-marca-y-datos.md` (v1.3.1, 2026-07-05).
> Objetivo: clasificar cada contacto en exactamente **un** perfil (A/B/C/D) antes de activar cualquier workflow.

---

## 1. Los cuatro perfiles

| Perfil | Quién es | Workflow que recibe | Objetivo del email |
|---|---|---|---|
| **A** | Developer individual con cuenta Free activa | WF1 (onboarding) + WF2 (trigger upgrade) | Conversión Free→Pro |
| **B** | Líder técnico / Engineering Manager | WF3 (nurturing líderes) | Conversión a Team ($35/seat) |
| **C** | CTO / decisor enterprise | WF4 (secuencia enterprise) | Agendar demo (Calendly) |
| **D** | Contacto frío, no usuario activo | WF5 (reactivación) | Primera descarga / primera sesión |

**Regla de precedencia:** si un contacto matchea más de un perfil, gana el de mayor valor: **C > B > A > D**. Un contacto está en un solo workflow a la vez (excepción: A puede estar en WF1 y ser interceptado por WF2, ver reglas en `03-workflow-2`).

---

## 2. Criterios operativos de clasificación

### Fuentes de datos disponibles hoy

1. **Supabase** — `auth.users` (email, fecha de registro, last sign-in) + `profiles` (cuenta GitHub vinculada). No exportar nunca `github_token`.
2. **Stripe** — customer + subscription: define el campo `PLAN` (free / pro / team) y el MRR.
3. **Listas externas** — leads de LinkedIn, Product Hunt (17-jun-2026), eventos, DMs. Viven en CSV/Sheets, sin cuenta en la app.
4. **Eventos in-app** — hoy NO se emiten eventos a ninguna plataforma de email. Hay que instrumentarlos (ver §4). Sin esto, WF2 no puede existir.

### Perfil A — Developer individual (Free activo)

Un contacto es **A** si cumple **todas**:
- Tiene cuenta en Supabase (`auth.users.email` existe).
- `PLAN = free` (no hay subscription activa en Stripe para ese email).
- Actividad reciente: `last_sign_in_at` < 30 días (Supabase). Si es mayor a 30 días, pasa a **D** (dormido).

Campo que se mira: cruce `auth.users` × Stripe customers, atributo sincronizado `LAST_ACTIVE`.

### Perfil B — Líder técnico / EM

Un contacto es **B** si cumple **alguna**:
- Señal in-app: creó un Team o generó un código de terminal sharing (tabla de Teams en Supabase) estando en plan Pro/Free — está intentando trabajar con otros.
- Señal de lead: título en LinkedIn/PH contiene `Engineering Manager`, `Tech Lead`, `Team Lead`, `Lead Engineer`, `Head of Engineering` (clasificación manual o por columna `TITLE` del CSV).
- Respondió el email 5 de WF1 o la pregunta de calificación de WF4 indicando que decide por un equipo.

> ⚠️ REQUIERE DECISIÓN: hoy el onboarding de la app no pregunta el rol. Recomendado agregar una pregunta de 1 click al signup ("I code solo / I lead a team / I run engineering") y sincronizarla como atributo `ROLE`. Sin eso, B se clasifica a mano — viable con la base actual (~90 usuarios + leads), no escala.

### Perfil C — CTO / decisor enterprise

Un contacto es **C** si cumple **alguna**:
- Título C-level o VP (`CTO`, `VP Engineering`, `VP of Engineering`, `Co-founder & CTO`) en la fuente del lead.
- Contacto inbound directo (tipo el DM del VP de Huawei) o pedido de demo/pricing enterprise.
- Empresa identificable con equipo de ~10-50 devs (LinkedIn de la empresa).

Lista **curada a mano** por Bautista (owner comercial, bautista@nestmux.com). Con el volumen actual esto es una lista corta y de alto valor: no automatizar la clasificación, sí la secuencia.

### Perfil D — Contacto frío

Un contacto es **D** si cumple **alguna**:
- Email en lista externa (PH, LinkedIn, evento, referido) **sin** cuenta en Supabase.
- Cuenta creada pero sin ninguna sesión de app registrada (registró y nunca abrió).
- Ex-A con `LAST_ACTIVE` > 30 días.

Excluir: cualquier email sin opt-in verificable. No enviar a listas raspadas — mata la reputación del dominio antes de empezar.

---

## 3. Plataforma: Brevo vs Kit → **Brevo**

| Criterio | Brevo | Kit (ex ConvertKit) |
|---|---|---|
| Triggers por comportamiento de producto | **Events API nativa** (`track_event` desde backend) → dispara automations. Exactamente lo que WF2 necesita. | Automation por tags/forms; eventos custom requieren API + workarounds. Pensado para creators, no para eventos de producto. |
| Stripe | Se integra vía webhook propio → evento `subscription_started` en Brevo. Suficiente. | Integración Stripe orientada a vender productos de creador, no a leer el estado de subscription de un SaaS. |
| Transaccional + marketing | Ambos en una cuenta (SMTP/API transaccional incluido). | Solo marketing. |
| Pricing | Por **emails enviados**, contactos ilimitados — ideal para una base grande y fría (miles de contactos, pocos envíos). | Por **cantidad de suscriptores** — pagás por contactos dormidos que todavía no activaste. |
| Deliverability / dominio dedicado | Warm-up y dominio propio soportados en planes pagos. | OK, pero sin ventaja. |

**Decisión: Brevo.** El sistema entero depende de triggers comportamentales (paywall hits) y de no pagar por miles de contactos fríos. Kit gana solo si esto fuera un newsletter de creator — no lo es.

Setup mínimo:
- Dominio de envío: `mail.nestmux.com` (subdominio, para no arriesgar la reputación del dominio raíz). SPF + DKIM + DMARC antes del primer envío.
- Remitente: `Gero from Nest <gero@nestmux.com>` para WF1/2/5, `Bautista <bautista@nestmux.com>` para WF3/4.

---

## 4. Instrumentación requerida (backend → Brevo)

Eventos a emitir (Brevo `track_event`), con el email del usuario como identifier:

| Evento | Cuándo | Propiedades |
|---|---|---|
| `signed_up` | Alta en Supabase | `signup_source` |
| `session_started` | Apertura de la app | — |
| `paywall_hit` | Usuario Free toca una feature Pro/Team | `feature_hit` ∈ `panel_limit` (4.º panel), `broadcast`, `worktrees`, `my_repos`, `teams`, `spotlight`, `diff_viewer`, `snippets`, `voice`, `workspaces`, `sharing`, `mcp_write` |
| `subscription_started` | Webhook de Stripe `checkout.session.completed` | `plan`, `interval` |
| `subscription_canceled` | Webhook de Stripe | `plan` |

Atributos de contacto sincronizados (job diario Supabase→Brevo): `FIRSTNAME`, `PLAN`, `ROLE`, `LAST_ACTIVE`, `SIGNUP_DATE`, `SIGNUP_SOURCE`, `OS`.

---

## 5. Diccionario de placeholders usado en todos los workflows

| Placeholder | Qué es |
|---|---|
| `{{first_name}}` | Nombre (fallback: "there") |
| `{{plan}}` | free / pro / team |
| `{{feature_hit}}` | Feature Pro que gatilló el paywall |
| `{{deep_link_new_panel}}` / `{{deep_link_broadcast}}` / `{{deep_link_worktrees}}` / `{{deep_link_my_repos}}` / `{{deep_link_layouts}}` | Deep links a la app (protocolo `nestmux://` — a definir con Matías) |
| `{{url_download}}` | https://nestmux.com (descarga) |
| `{{url_pricing}}` | https://nestmux.com/pricing |
| `{{url_checkout_pro}}` / `{{url_checkout_pro_annual}}` | Checkout Stripe con UTM |
| `{{url_calendly}}` | https://calendly.com/matias-nestmux/new-meeting |
| `{{url_video_demo}}` | Video de 2 min del caso de uso principal — **hay que producirlo** (entra en el calendario de contenido de la Fase 3.1) |

Todos los links llevan UTM: `utm_source=email&utm_medium=lifecycle&utm_campaign=wf{n}-e{n}`.
