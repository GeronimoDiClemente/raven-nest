# Integrations Orchestration Hub — Design Spec

> Status: **approved design** (mockup signed off 2026-08-06). Branch: `feat/integrations`. Language: all product UI/code in **English**.
> Related: `docs/INTEGRATIONS_ORCA_BACKLOG.md` (epics A–D), competitor analysis in memory `competitor-orca`.

## 1. Goal

Turn **Integrations** from a "connect-your-tools marketplace" into the **flagship orchestration surface of NestMux**: one place where you connect your work sources + a bot, and drive a fleet of agents against real tickets — each landing as a window in a workspace linked to the task. The current UI reads as "generic AI / basic"; this redesign gives it an opinionated, ownable look and makes it the product's headline feature.

Inspiration/benchmark: Orca (single-dev agent-fleet governance). Our wedge that Orca structurally lacks: **human team** (presence, flow/health) + **Slack-actionable** + a unified surface. See `competitor-orca`.

## 2. Locked product decisions

1. **Two distinct areas.** *My Repos* = open/manage **workspaces** (unchanged, user likes it). *Integrations* = **orchestrate agents** (this redesign). Integrations moves **out of My Repos** into its **own top-level sidebar section**.
2. **One surface, no Teams/Personal split.** All connections + one task board in a single view. Origin (team org vs personal) is a **label**, never a separate home.
3. **Integrations is the flagship feature** for all tiers. **Custom/bespoke integration development = Enterprise** funnel (built to order, not self-serve).
4. **Everything in English** — UI copy, code, identifiers, comments.
5. **Reuse, don't rewrite.** The engines (H3–H8) exist. This is UI re-focus + wiring, done surgically on `feat/integrations`.

## 3. Architecture — one bus, one primitive

The whole app can speak one language via two things that already exist:

- **Event bus (H8)** — `electron/integrations/event-bus.ts` (`EventBus`), `bus-types.ts` (`DomainEvent` / `Command`), `bus-commands.ts`. Every zone emits/consumes here.
- **Worktree/workspace as the single primitive** — `electron/worktree-store.ts` (`WorktreeMeta`), `electron/worktree-create.ts`, and `SessionPane`/`SessionData` in `src/types.ts`. A "task window" is a real pane/PTY in a real workspace on a real worktree.

Connection points (all already wired or one hop away):
- **↔ My Repos**: the worktree the bot creates lives in a My-Repos repo; the "window" is a real workspace/pane. Clicking a task jumps you into that workspace. A repo in My Repos surfaces its active tickets/PRs (from the ticket-loop).
- **↔ Teams**: a task carries its **scope** (org) as a label; bus events (pr.merged, agent done, ci) feed the existing team flow/health + per-employee analytics. **Presence**: show if a teammate is already in a worktree. Custom dev = Enterprise.
- **↔ the multiplexer**: each "window"/agent is a real pane/PTY; agent status and quota come from there (epics A/B).

## 4. Information architecture

Integrations is a top-level section with a 3-tab segmented control:

- **Hub** — connections + the orchestration board (the daily driver).
- **Recipes** — **reactive** rules (`event → command`). Motor exists (H8 / `recipes.ts`); this tab is the visual editor.
- **Automations** — **scheduled** agents (cron). Depends on epic C (scheduler, not yet built).

One-liner that must stay legible in the UI: *Recipes react to **events**; Automations run on a **clock**.*

A compact **@Nest bot** widget + **Needs you** list + **Activity** feed live in a right rail, visible across tabs. A bottom **status bar** shows per-account model quota + Working/Needs-you counts.

## 5. The Hub view

### 5.1 Connections zone
Chips with brand logo + status LED (connected/soon). No "Installed/Available/Coming soon" grids — status collapses into the LED. `+ Connect` / `+ Connect source`.
- Reuse: `src/components/IntegrationsMarketplace.tsx` (`ConnectControl`: Slack OAuth deep-link, GitHub token reuse, gcal loopback, `ApiKeyForm` for Notion/Jira), `src/integrations/registry.ts`, catalog `src/lib/plugins/builtinCatalog.ts` (Slack/GitHub/Notion/Jira/Google Calendar + Figma/Sentry soon).
- New: brand-logo icon set per integration (colored app-icon squares; see §8), replacing generic icons.

### 5.2 Board (the center)
Two views over the same data, toggle `▤ Table` / `▦ Worktrees`:
- **Table** (dense, Linear-style): `Task · Source · Status · Agent · Worktree · Workspace`. Sub-tabs `All / Mine / PRs / Issues`.
- **Worktrees**: grouped `Pinned` / `In progress (n)` cards; each card = title + repo badge + branch + agent avatars + status dot + workspace link.
- Data sources: **H3** `ticket-loop.ts` (tickets + inferred state todo/in_progress/in_review/done), **H4** `worktree-signals.ts` (ci.failed / changes.requested / review.requested), `worktree-store.ts` (`setupState`), `SessionPane` (running agent/CLI). Bridges in `src/types.ts` (`TicketsBridge`, `SignalsBridge`).
- Status glyphs: `Needs You` (amber), `Working` (yellow, pulsing), `Done` (green), `Idle` (grey, hidden by default), `To do`.

### 5.3 Connected layer (scope / presence / jump)
- **Scope chip** per task: org (e.g. `RAVEN`) or `Personal`, **derived from the repo owner** (GitHub org vs user) — zero extra input. **Contextual**: render only when the user has ≥2 scopes; hidden for single-context users (no noise).
- **Scope filter** (`All · <Org> · Personal`) — filters the board; not separate tabs.
- **Presence**: show a teammate present in a worktree ("Ana is here") so people don't collide — sourced from team presence (Supabase/Teams). Org-scoped tasks only.
- **Jump**: click scope chip → popover. Org → "Open team → flow & health, presence" (into Teams). Personal → "Open in My Repos".

### 5.4 Right rail
- **@Nest bot** (compact): avatar + connected status (Slack; Telegram soon) + one-line role + an "Ask it something… ⌘K" affordance. No large card.
- **Needs you** list: tasks awaiting your action, each with its destination workspace ("open in Race-merge →").
- **Activity** feed: what the bot orchestrated (grabbed ticket → opened window in ws X; merged → #dev + Calendar).

### 5.5 Status bar
Per-account model quota meters (epic A) + `Needs you` / `Working` / worktree counts. Mono, green bars.

## 6. The @Nest bot (orchestration intents)
Built on **H7** Socket Mode (`electron/integrations/slack-socket.ts`, `slack-envelopes.ts`, wiring in `electron/main.ts`, `SlackMentionsBridge`). Today it receives mentions/actions and routes to the renderer. Extend the intent handling so the bot can:
- Grab a ticket → create worktree (via `ticketLoop.startWork` + `worktree-create`) → open a window/pane in a linked workspace.
- Report back to the rail Activity + Slack (via existing `notify` command).
- Ask the human for the important calls (permission gates) → surfaces as `Needs you`.
Telegram is a **future** second transport of the same bot (out of scope for Phase 0).

## 7. Move-to-workspace / create-worktree picker
From a task's Workspace cell (or a Needs-you card): a popover to either **move the task into a workspace you're already in**, or **create a new worktree** with:
- **Suggested name** derived from the ticket (editable) — reuse `electron/integrations/branch-name.ts` (already tested).
- **Matching repo** pre-selected (the repo the ticket belongs to). "Saved in the matching repo."
- Confirm → `worktree-create` + open window.

## 8. Design system (the "not generic AI" bar)
From the visual research (Orca/Superset): the distinctive look comes from an **opinionated design system**, not plugins/themes.
- **Surfaces** by luminance, hairline borders: `--bg #000` → chrome `#0a0a0b` → card `#111214` → line `#1c1d21`. Floating window (radius + 1px border + shadow). Subtle **ambient green halo** + faint dot grid.
- **Green accent = medium** `oklch(65% .13 157)`, used **sparingly** (status/selection/focus/quota/LED). Chosen intensity: **Medium** — primary buttons are green **outline** (per Gero); avoid green-filled everything.
- **Typography**: Inter for prose; **mono (IBM Plex Mono / Cascadia) for all metadata** — IDs, branch names, `+N -N`, timestamps, tabular numbers.
- **Brand logos** per integration and per agent (colored app-icon squares / avatars), not generic icons.
- **Status glyphs**, **command palette (⌘K)** with ⌘-hints, optional **shortcut HUD**, bottom **meter status bar**.
- Reference tokens live in the approved mockup (scratchpad `integrations-hub.html`). Production tokens align to `src/styles/global.css` and the `nest-ui` skill; the green-rebrand tokens currently live in `feat/login-redesign` and must be reconciled at merge.

## 9. Recipes tab
Visual editor over the existing bus recipes: `electron/integrations/recipes.ts` (`defaultRecipes`, `loadRecipes`, `saveRecipes`, `StoredRecipe`), persisted to `<ravenHome>/.raven-nest/recipes.json`. Each row: `when` (event) → `command` pills + on/off + edit. Seed with current defaults (pr.merged→notify+logOutcome, ci.failed→notify, changes.requested, review.requested, session.opened→setPresence) plus new hooks from epics A/B (`quota.threshold`, `agent.needs_input`).

## 10. Automations tab
Scheduled agents (**epic C**, `docs/INTEGRATIONS_ORCA_BACKLOG.md`). Needs a new scheduler (`electron/integrations/scheduler.ts`, cron/RRULE, `automations.json`) that reactivates the declared-but-unimplemented `scheduleBlock` command / `block.started` event. Each run: ephemeral headless worktree → run prompt → summary → notify + logOutcome. UI: list with name, schedule, repo, agent, next run, on/off, prompt, last-run. **This tab ships with epic C, not Phase 0.**

## 11. What is removed / replaced
- **`src/components/TeamIntegrationsView.tsx`** (Teams → integrations): removed. Integrations no longer lives in Teams; the "contact enterprise" wall becomes the Enterprise custom-dev funnel.
- **Integrations leaves `MyReposPanel`** → own top-level section. My Repos keeps only repos/workspaces.
- The noisy `Installed / Available / Coming soon` grids → status becomes the chip LED.

## 12. Surgical mapping (reuse-first)
| Hub piece | Reuse | New |
|---|---|---|
| Connections | `IntegrationsMarketplace`, `ConnectControl`, `registry.ts`, `builtinCatalog.ts` | brand-logo set; chip styling |
| Board data | `ticket-loop.ts` (H3), `worktree-signals.ts` (H4), `worktree-store.ts`, `SessionPane`; bridges in `types.ts` | `OrchestrationBoard.tsx` (table + worktrees), status-glyph system |
| Connected layer | Teams presence (Supabase), repo owner (GitHub) | scope chip + filter + presence + jump popover |
| Bot | H7 `slack-socket.ts` / `slack-envelopes.ts`, `SlackMentionsBridge` | orchestration intents; compact rail widget |
| Picker | `worktree-create.ts`, `branch-name.ts`, `startWork` | move/create popover with suggested name + matching repo |
| Recipes | `recipes.ts`, `event-bus.ts`, `bus-commands.ts` | recipes editor UI |
| Automations | bus `scheduleBlock`/`block.started` (declared) | `scheduler.ts` (epic C) + UI |
| Section shell | sidebar nav, `MyReposPanel` patterns | top-level Integrations section |

## 13. Phasing
- **Phase 0 (this spec)** — the Hub redesign + connected layer + bot intents + picker + Recipes editor, wired to existing engines. Ships the flagship surface.
- **Then, per `INTEGRATIONS_ORCA_BACKLOG.md`**: A (quota bar) → B (Needs-You status inference) → C (Automations/scheduler) → D (fan-out / race-and-merge). Each gets its own spec+plan.

## 14. Testing
Follow the repo pattern: engines in `electron/__tests__/**` (vitest node, dependency-injection, no Electron), component tests in `src/__tests__/components/**` (jsdom). New pure logic (scope derivation, board projection, branch suggestion wiring) unit-tested; new components tested for render + interactions. Keep the suite green (currently ~499 tests).

## 15. Out of scope (conceded)
Mobile companion app, SSH/VPS remote worktrees, 30+ CLI marketplace parity, Telegram bot transport (later). Watch-list: if Orca ships human collaboration or a managed cloud that runs agents without the desktop, revisit.

## 16. Open questions
1. Where exactly does the top-level "Integrations" entry sit in the sidebar relative to My Repos / Teams?
2. Presence data source granularity — is per-worktree presence already available from Teams/Supabase, or does it need a new channel?
3. Do we reconcile the green-rebrand tokens from `feat/login-redesign` now (cherry-pick) or at a later merge?
