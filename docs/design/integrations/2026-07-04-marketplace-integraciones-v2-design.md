# Marketplace de integraciones V2 — Design spec

**Fecha:** 2026-07-04 · **Branch:** `feat/integrations` · **Estado:** diseño aprobado por Gero (mockups incluidos)
**Reemplaza/extiende:** `2026-06-01-marketplace-integraciones-design.md` (Slice 1, ya codeado — esta V2 se construye ENCIMA, no lo tira)

## 1. Visión

Cada integración es **la app adentro de Nest**, no un feed de notificaciones. En cada panel el usuario puede **leer, escribir y actuar** (mandar un mensaje, transicionar una issue, aprobar una PR, comentar una página) sin salir de Nest. Son **código bespoke premium** (NO MCP genérico), Pro-gated server-side contra Supabase.

**Primera tanda:** Slack (flagship), Jira, GitHub, Notion.

### Fundamentos (deep-research 2026-07-04, claims verificados)

- El dolor #1 medido en devs con agentes es verificar output "casi correcto" (66%) y el peor impacto es colaboración de equipo (17% de aprobación). Los paneles atacan exactamente eso: *ver lo que hizo el agente y compartirlo con el equipo sin cambiar de ventana*.
- Los devs usan 1-2 integraciones core, no catálogos amplios → **profundidad bespoke sobre amplitud genérica**.
- El pitch NO es "MCP es ineficiente" (Tool Search/code execution/EMA lo están corrigiendo a nivel protocolo). El pitch es **UX de verificación + colaboración + curación profunda**.
- superset.sh (competidor directo) es Mac-only y su marketplace es solo temas → multi-OS + marketplace real es espacio libre hoy. Revalidar su estado Windows antes del launch.
- Gating (patrón Raycast): **catálogo y detail-pages visibles para todos; el gate Pro cae en "Conectar"**, no en mirar.
- Refutados — NO usar en pitch/copy: "11.4h/semana revisando código IA", "el setup de MCP es no trivial".
- Abierto: validar demanda real del flujo terminal→Slack (entrevistas/waitlist) y willingness-to-pay por paneles Pro-gated (nadie lo monetiza aún: espacio virgen o señal).

## 2. IA / Placement (decidido con Gero)

- Entrada al marketplace: **"+" discreto abajo del nav** (sin la palabra "Integraciones"). Logo-first, matte/dark premium. Logos apagados/monocromo → toman color al conectarse.
- Al **conectar**, la integración se **promueve a ítem propio del menú** (logo + nombre + badge "NUEVO" la primera vez), en la sidebar de My Repos (personal) o Teams (si el team la contrató).
- Click en el ítem → **vista de la integración en el área de contenido, con la sidebar siempre visible** (como cambiar de sección).
- Detail-page (click en logo del marketplace): hero (logo, categoría, "✦ Integración nativa de Nest", CTA), tagline, "Qué podés hacer" (capabilities), "Permisos que pide", card "Incluido en Pro" con mensaje de confianza (token cifrado local, mensajes no pasan por nuestros servidores).
- CTA según tier: Pro → "Conectar <servicio>"; Free → "Probá Pro para conectar" (la página se ve completa igual).

**Mockups aprobados** (en `docs/design/integrations/mockups/`, abrir en el browser): `marketplace-shell-v3.html`, `detail.html`, `oauth-flow.html`, `slack-view.html`, `jira-view.html`, `github-view.html`, `notion-view.html`.

## 3. Arquitectura: shell común + adapters

Los 4 mockups comparten el mismo patrón de layout. Eso se convierte en la arquitectura del renderer:

```
IntegrationPanelShell (React, común)
├── ContextColumn            ← columna izquierda del panel
│   ├── PanelHeader          (logo, workspace/cuenta conectada)
│   ├── SearchBox
│   ├── WorktreeContextCard  ← "Worktree actual → <entidad>" (EL diferenciador)
│   └── SectionList          (secciones + ítems, definidos por el adapter)
├── ContentArea              ← detalle (render del adapter)
└── ComposeBar               (común: input + acción de terminal + submit)
    └── TerminalAttachAction ← "Adjuntar/guardar output del terminal"
```

Cada integración implementa un **adapter** con interfaz única:

```ts
interface IntegrationAdapter {
  id: 'slack' | 'jira' | 'github' | 'notion'
  // datos
  fetchSections(ctx: WorktreeContext): Promise<Section[]>      // columna izquierda
  fetchDetail(itemRef: ItemRef): Promise<DetailModel>          // área de contenido
  resolveWorktreeEntity(ctx: WorktreeContext): Promise<ItemRef | null>  // branch → issue/PR/canal/página
  // acciones
  actions(item: DetailModel): PanelAction[]                    // transicionar, aprobar, merge, comentar…
  compose(target: ItemRef, body: ComposeBody): Promise<void>   // body puede incluir TerminalOutputBlock
  // ciclo de vida
  oauth: OAuthConfig                                           // scopes, authorize URL, edge function
  poll: { intervalMs: number }                                 // refresh acorde a rate limits del servicio
}
```

- El fetch corre en el **main process** (tokens nunca tocan el renderer); el renderer recibe modelos ya resueltos vía IPC (`plugins:panel:*`).
- `WorktreeContext` = repo + branch + PID tree del pane activo; `resolveWorktreeEntity` mapea branch→entidad por convención (`RAV-231-...` → issue; branch → PR abierta; canal `#feat-integrations`; página taggeada con el branch) con fallback manual (el usuario la elige y se persiste).
- Reusa el Slice 1 tal cual: `PluginsStore`, credential store cifrado (`safeStorage`, write atómico), `runPluginAction`, IPC, OAuth con state nonce, catálogo remoto + `BUILTIN_CATALOG` fallback.

## 4. Flujo OAuth (mockup `oauth-flow.html`)

1. Click "Conectar" → modal en Nest ("Autorizá Raven Nest en tu navegador" + spinner + Cancelar + nota de confianza) y se abre el **navegador del sistema** (no webview).
2. Consent del servicio con scopes mínimos. El canje code→token pasa por la **Edge Function** (server-side, valida state nonce; el client secret nunca vive en la app).
3. Deep-link de vuelta → toast "Conectado", la integración se promueve al menú, CTA "Abrir <servicio>".

Errores: timeout de espera (reintentar/cancelar), state nonce inválido (abortar + log), revocación remota detectada en fetch (panel pasa a estado "Reconectar").

## 5. Alcance real por integración (v1 del panel)

Restricciones de API mandan; cada panel promete solo lo que su API sostiene.

| | Columna contexto | Detalle | Acciones | Diferenciador worktree | Restricción clave |
|---|---|---|---|---|---|
| **Slack** | Canales + no-leídos + DMs | Hilo del canal (refresh periódico) | Mandar/responder, buscar | Canal del branch a mano | `conversations.history` 1 req/min (fuera del Slack Marketplace) → panel útil, NO tiempo real |
| **Jira** | Mi trabajo / Sprint / Recientes | Issue: descripción, comentarios | Transicionar estado, comentar | Issue detectada del branch (`RAV-123-…`) | API REST v3 estándar |
| **GitHub** | Tus PRs / Review pedida | PR: checks CI, archivos, diff stat | Aprobar, pedir cambios, merge, comentar | PR abierta del branch actual | Ya hay token GitHub en la app (ojo §7) |
| **Notion** | Páginas vinculadas al repo / Recientes | Página legible (blocks render) | Comentar, guardar bloque | Página vinculada al worktree (RFC/spec del feature) | Render de blocks acotado a tipos comunes |

Común a los 4: **"Adjuntar/guardar output del terminal"** — el output del pane activo, formateado (code block), como mensaje/comentario/bloque.

## 6. Gate Pro y funnel Enterprise

- **Ver**: catálogo + detail-pages abiertos a todos los tiers.
- **Conectar/usar**: requiere Pro, validado **server-side contra Supabase** en cada arranque de sesión de panel (no un toggle local salteable). Sin pricing por integración ahora; solo el gate.
- **Team/Enterprise**: teaser visible para todos + CTA "Contactar Enterprise" (Raven hace integraciones custom como servicio, tier Enterprise). Tablas `plugin_requests` / `enterprise_leads` (Slice 3). El argumento de venta: los agentes hoy no mejoran la colaboración (17%) — una integración custom terminal→herramienta-interna es exactamente eso.

## 7. Seguridad

- Tokens de integraciones: **Electron `safeStorage` en main process** (ya implementado en Slice 1). Nunca en Supabase, nunca en el renderer.
- **NO repetir** el error del `github_token` plano en Supabase (pendiente crítico del CLAUDE.md). El panel GitHub debe usar un token local cifrado; si reusa el OAuth existente, migrar ese almacenamiento antes.
- Scopes mínimos por servicio, listados en la detail-page (transparencia = parte del pitch).
- Multi-OS: `safeStorage` usa keychain (Mac) / DPAPI (Win) / libsecret (Linux) — documentar el comportamiento en los tres (regla de la casa).

## 8. Estrategia de desarrollo (proceso largo, probable en local)

Cada hito termina con algo corrible con `npm run dev`:

1. **Shell + adapter mock** — `IntegrationPanelShell` con un `MockAdapter` (datos fake): valida layout, navegación, promoción al menú, gate Pro. Sin OAuth ni API reales.
2. **Slack real (flagship)** — Slack App real + Edge Function + adapter Slack sobre el shell. Primer panel end-to-end.
3. **GitHub** — reusa token/plumbing existente; segundo adapter valida que la abstracción aguanta.
4. **Jira + Notion** — adapters restantes.
5. **Gate Pro server-side + migración Supabase** (Task 10 diferida del Slice 1).
6. **Funnel Enterprise** (Slice 3: teaser, `plugin_requests`, `enterprise_leads`).

El plan detallado por tasks sale de writing-plans sobre este spec.

## 9. Fuera de alcance (por ahora)

- Pricing por integración / paneles de pago individuales (solo gate Pro).
- Catálogo abierto a terceros (el modelo manifest ya lo contempla; runtime sigue curado/built-in).
- Tiempo real (websockets) en Slack — la API no lo permite fuera del Marketplace; refresh periódico.
- Gestión admin de integraciones del team (evolución del teaser Enterprise).
