# Enterprise Deck — Nest by RAVEN (v1.3.1)

> Slide-by-slide content for the enterprise deck (CTOs / VP Engineering).
> Language: English. Attach as PDF in Workflow 4 (enterprise sequence, email 3) and send after any inbound enterprise signal.
> Source of truth: `../00-brief-marca-y-datos.md`. Do not add claims that are not in the brief.
> Honest-stage rule: we sell a working v1.3.1 product and a structured 30-day pilot — not enterprise maturity we don't have yet.

---

## Slide 1 — Title

**Nest by RAVEN**
*The Multi-AI Terminal Workspace for engineering teams*

- One window. Every AI agent your team already uses — Claude, Gemini, Codex, Copilot, OpenCode — side by side.
- Built for how teams actually ship code.
- nestmux.com · macOS · Windows · Linux

**Design note:** Full-bleed screenshot of a real 6-panel grid running different agents (blurred code if needed). Logo top-left, one line of text. No stock imagery — the product is the visual.

---

## Slide 2 — The problem: AI made individuals faster. It didn't make teams faster.

- Every developer on your team now runs one or more AI coding agents daily.
- But agents run in isolated terminals, on isolated branches, with zero shared visibility.
- The result: parallel chaos — duplicated work, unreviewable diffs, "who told the agent to do that?"

**Design note:** Simple diagram: 5 developer icons, each with an agent bubble, no lines connecting them. Dark background, one accent color.

---

## Slide 3 — The data (Stack Overflow Developer Survey 2025, ~49k developers)

- **66%** say AI output is *"almost right, but not quite"* — the #1 frustration with AI tools.
- **45%** say debugging AI-generated code takes significant effort.
- Only **17.3%** believe AI agents have improved their team's collaboration.

Individual productivity is up. Team-level verification and collaboration are the unsolved layer. That's where Nest sits.

**Design note:** Three large stat tiles (66% / 45% / 17.3%), the third one visually highlighted — it's our wedge. Cite "Stack Overflow Developer Survey 2025" in small print at the bottom.

---

## Slide 4 — What is Nest

- A terminal multiplexer built for AI agents: up to **12 panels** in one window, **11 tiling layouts**, cycled live without restarting sessions.
- Each panel is a full independent session: its own agent, its own account, its own history, its own environment.
- Supported out of the box: Claude, Gemini, Codex, Copilot, OpenCode, plain terminal, custom commands, and an embedded Browser cell.
- Desktop app for macOS, Windows and Linux. Auto-updates on all three.

**Design note:** Annotated product screenshot: callouts pointing at 3–4 panels running different agents. Keep annotations to 4 max.

---

## Slide 5 — How a team works in Nest: verify, don't trust

- **Native git worktrees from the UI**: each agent works isolated in its own copy of the repo — no agents stepping on each other, no dirty main checkout.
- **Diff viewer**: review what the agent actually changed before it touches your branch.
- **Per-panel port detection**: see exactly which dev server each agent spun up; one click opens it in the embedded browser.
- The workflow: dispatch work to agents in parallel → inspect each worktree → merge only what's verified.

**Design note:** Left-to-right flow diagram: "Dispatch (N agents) → Isolate (worktrees) → Verify (diff + running app) → Merge". Screenshot of the diff viewer below.

---

## Slide 6 — How a team works in Nest: shared visibility

- **Teams workspace**: a real shared workspace for your engineering team.
- **Live terminal sharing** via an 8-character code: a senior reviews a junior's agent session in real time — no screen-share call, no context loss.
- **Broadcast Mode**: send the same prompt to multiple agents at once and compare their answers side by side — the fastest way to catch "almost right".
- **My Repos**: one dashboard for the team's GitHub & GitLab repos with CI runs visible.

**Design note:** Two screenshots side by side: terminal sharing (join code visible) and Broadcast Mode with 3 agents answering the same prompt. This is the collaboration slide — spend design time here.

---

## Slide 7 — Works where your team works

- Native desktop app for **macOS, Windows and Linux** — mixed-OS teams get the identical experience.
- One-click install of each agent's CLI from inside the app, with a live log.
- Interactive in-product tutorial (3 guided tours: Worktrees, My Repos, Teams) — onboarding a new team member takes minutes, not a wiki page.
- Voice input, snippets, saved workspaces, Spotlight-style search.

**Design note:** Three OS logos over one screenshot. Keep this slide fast — it exists to kill the "is it Mac-only?" question before it's asked.

---

## Slide 8 — The data & cost model: your keys, your code, no lock-in

- **Every developer uses their own API keys and CLI subscriptions.** Nest does not resell tokens and does not sit between your code and the model provider — agents run locally in each developer's terminal sessions.
- **Near-zero marginal AI cost from Nest**: you pay your model providers what you already pay them; Nest is the workspace layer only.
- **No model lock-in**: switch providers per panel, per task, per developer. When a better model ships, your team uses it the same day.
- Vendor-neutral by design: we don't have a horse in the model race.

**Design note:** Diagram: developer machine in the center, arrows going directly from each panel to each provider's logo (Anthropic, Google, OpenAI, GitHub). Nest drawn as the frame around the panels, not as a middleman. This is the slide CTOs remember — keep it clean.

---

## Slide 9 — Complementary to what you already run

- Nest is not an IDE and not a replacement for Cursor or your editor. **We're not the same thing. We're complementary.**
- Your developers keep their editor; Nest is where multi-agent work gets dispatched, isolated, verified and shared.
- Think of it as the missing team layer around the agent CLIs your developers already installed.

**Design note:** Simple layered diagram: Editor/IDE layer, Agent CLI layer, and Nest as the orchestration/verification layer on top of the CLIs. No competitor bashing.

---

## Slide 10 — Where we are (honest)

- **v1.3.1 in production**: multi-OS installers, Stripe billing live, auto-updates on all platforms.
- Launched on Product Hunt, June 17, 2026.
- **90 active users**, ~10% free-to-paid conversion, growing organically (40k impressions from a single LinkedIn post).
- Early enterprise interest: unsolicited inbound from a VP at a global technology company before launch.
- We are an early-stage company. That's exactly why we run structured pilots instead of asking for a leap of faith.

**Design note:** Timeline graphic (build → launch → today). This slide builds trust through candor — do not inflate anything here. The Huawei mention stays anonymized ("a VP at a global technology company") unless they've publicly confirmed.

---

## Slide 11 — Enterprise pricing

- **Enterprise: from $60 per seat / month**, billed annually. Minimum 4 seats.
- Sales-led — no self-serve checkout at this tier. Direct line to the founding team, priority support, input on the roadmap.
- Reference: self-serve Team plan is $35/seat/mo — Enterprise is for teams that need direct engagement with us during rollout.
- No per-token or usage fees from Nest, ever: developers keep using their own AI provider accounts.

**Design note:** One large pricing card, not a 4-column comparison table. Anchor line at the bottom: "Your AI spend stays with your AI providers. Nest is a flat, predictable seat cost."

---

## Slide 12 — The 30-day pilot

- **Scope**: 4–10 developers from one team, full Enterprise feature set, real projects (not a sandbox).
- **Week 1**: kickoff + hands-on setup call with our CTO — no pitch, just configuring your actual repos and agents.
- **Weeks 2–3**: team works normally in Nest; weekly 30-min check-in; direct founder support channel.
- **Week 4**: results review against success criteria agreed on day one.
- **Success criteria we propose** (tuned per team): weekly active usage per seat, parallel agent sessions per developer, worktree/verification flow adoption, and the team's own qualitative verdict: "would you take it away from us?"
- Decision at day 30: expand, or walk away — no obligation.

**Design note:** Horizontal 4-week timeline with the decision point marked at day 30. This is the money slide of the deck: the pilot is the product we're selling in this meeting.

---

## Slide 13 — The team

- **Gero — CEO & founder.** Built Nest to solve his own daily problem shipping in parallel for a US company.
- **Matías — CTO & co-founder.** Runs the product and every technical demo personally.
- **Eliseo — CISO.** **Bautista — CMO** and your commercial contact.
- We built this because we needed it. Your pilot gets the people who wrote the code, not an account manager.

**Design note:** Four photos, one line each. Founder-led sales is a feature at this stage — say so.

---

## Slide 14 — Next steps

- **Book a 30-minute technical session with Matías (CTO)**: no pitch — we set up Nest on your team's real stack, live. → calendly.com/matias-nestmux/new-meeting
- Commercial questions & pilot terms: **bautista@nestmux.com**
- We'll send the pilot proposal within 48 hours of the call, pre-filled with your team's setup.

**Design note:** Big single CTA (the Calendly link as a button-style element), contact email below. End on the same product screenshot as slide 1 for a visual bookend.

---

## Production notes (internal, not slides)

- 14 slides. If a prospect asks for a "short version", cut slides 7 and 9 → 12 slides.
- Do NOT add: SSO, SOC2, audit logs, self-hosting, on-prem, Jira/Slack/Notion integrations. None of these exist as of v1.3.1. If asked, the answer lives in `03-proceso-y-calificacion.md` (objection handling), not on a slide.
- Do NOT use the "11.4h reviewing vs 9.8h writing" stat or any "MCP requires non-trivial setup" claim — both refuted in the 2026-07-04 deep-research.
- Do NOT make any claim about token/credential storage security.
- Every screenshot must be from real v1.3.1 — no mockups of unshipped features.
