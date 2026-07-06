# Enterprise Pilot Proposal — Template

> Commercial proposal template (2–3 pages when rendered). Language: English.
> Fill every `{{placeholder}}` before sending. Owner: Bautista (bautista@nestmux.com).
> Send within 48 hours of the technical session with Matías. Validity: 30 days.

---

# Nest by RAVEN — 30-Day Enterprise Pilot Proposal

**Prepared for:** {{company}} — {{contact_name}}, {{contact_role}}
**Prepared by:** Bautista, Nest by RAVEN — bautista@nestmux.com
**Date:** {{date}} · **Valid for:** 30 days

---

## 1. Executive summary

{{company}}'s engineering team ({{team_size}} developers) is already using AI coding agents daily. Like most teams in 2026, the bottleneck is no longer generating code — it's verifying "almost right" output and coordinating agents across the team. Per the Stack Overflow 2025 Developer Survey (~49k respondents), 66% of developers cite "almost right" AI output as their top frustration, and only 17.3% believe AI agents have improved team collaboration.

**Nest by RAVEN** is a Multi-AI Terminal Workspace (desktop app for macOS, Windows and Linux, v1.3.1 in production): Claude, Gemini, Codex, Copilot and more, side by side in one window, with native git worktrees for isolated agent work, a diff viewer for verification, live terminal sharing, and a shared Teams workspace.

Two things matter for {{company}} specifically:

1. **Your use case:** {{use_case}} — during the technical session we configured this live on your stack; the pilot runs it on real work.
2. **The cost model:** every developer uses their own AI provider keys and subscriptions. Nest never proxies, meters or resells model tokens. Your AI spend stays with your providers, Nest is a flat per-seat cost, and your team keeps full freedom to switch model providers at any time — per panel, per task, per developer.

We are an early-stage company with a production-solid product. Rather than asking {{company}} to commit on faith, we propose a structured 30-day pilot with success criteria we agree on before it starts. At day 30, you have data — and a no-obligation decision.

## 2. Pilot scope — 30 days

**Participants:** {{pilot_seats}} developers from {{team_name}} (recommended: 4–10, one real team, not scattered volunteers).

**Environment:** the team's real repositories and real day-to-day work. No sandbox.

**What's included:**

- Full Enterprise access for all pilot seats: 12-panel multi-agent grid, git worktrees from the UI, diff viewer, Broadcast Mode, Teams workspace, live terminal sharing, My Repos (GitHub & GitLab, CI runs visible), voice input, snippets, saved workspaces — on macOS, Windows and Linux.
- **Week 1 — Kickoff (60 min) with Matías (CTO):** hands-on setup of Nest on the team's actual repos, agents and OS mix. Interactive in-app tutorial for each developer (~15 min self-serve).
- **Weeks 2–3 — Normal work:** the team uses Nest as its daily agent workspace. Weekly 30-min check-in. Direct channel to the founding team for support and fixes (we typically ship fixes within days — you are talking to the people who wrote the code).
- **Week 4 — Results review (45 min):** measured results against the success criteria below, and a joint go/no-go decision.

**What the pilot is not:** it is not a custom development engagement, and it does not include features that are not in v1.3.1 (see Section 5, Terms).

**What we need from {{company}}:**

- A pilot owner on your side (tech lead or EM) for the weekly check-ins.
- Developers bring their existing AI agent CLI accounts/API keys (Claude, Gemini, Codex, Copilot, etc. — whatever they already use).
- Permission for the pilot team to install a desktop app on their machines.

## 3. Success criteria (agreed at kickoff, measured at day 30)

We propose the following; final targets are set together at kickoff so they reflect {{company}}'s reality:

| # | Criterion | Target |
|---|---|---|
| 1 | Weekly active usage | ≥ {{target_active_pct}}% of pilot seats use Nest as their primary agent workspace in weeks 2–4 |
| 2 | Parallel agent adoption | Median of ≥ 2 concurrent agent sessions per active developer per working day |
| 3 | Verification workflow | ≥ {{target_worktree_pct}}% of agent-generated changes go through the worktree + diff-review flow before merge |
| 4 | Collaboration | ≥ {{target_sharing_count}} live terminal-sharing sessions used for real reviews/pairing during the pilot |
| 5 | Team verdict | In the day-30 review, the team answers "yes" to: *"Would losing Nest make you slower next sprint?"* |

Criteria 1–4 are read from usage during the check-ins together with your pilot owner; criterion 5 is the honest tiebreaker. If we miss the bar, we say so — a failed pilot costs you nothing (Section 4).

## 4. Pricing

| Item | Terms |
|---|---|
| **Pilot (30 days)** | {{pilot_price}} for up to {{pilot_seats}} seats. Fully credited against the first year if you convert. No obligation at day 30. |
| **Enterprise plan** | **From $60 per seat / month, billed annually. Minimum 4 seats.** Quote for {{team_size}} seats: {{annual_quote}} /year. |
| **AI/model costs** | $0 from Nest. Developers keep using their own provider keys and CLI subscriptions. No token resale, no usage metering, no model lock-in. |

Enterprise includes everything in the pilot, plus: priority support with a direct line to the founding team, and structured input into the product roadmap (early-design partners at this stage genuinely shape the product).

## 5. Terms

- **Validity:** this proposal is valid for 30 days from {{date}}.
- **Billing:** annual, invoiced at contract start. Pilot fee (if any) credited on conversion.
- **Seats:** minimum 4; seats can be added mid-term at the same per-seat rate, prorated.
- **Data & architecture:** Nest is a desktop application; AI agents run locally in each developer's terminal sessions using their own provider credentials. Nest account, team and workspace metadata are stored in our cloud backend.
- **Current-state disclosure (we'd rather you hear it from us):** as of v1.3.1 Nest does **not** offer SSO/SAML, SOC 2 or ISO 27001 certification, self-hosted deployment, or third-party integrations beyond GitHub and GitLab. If any of these is a hard requirement for {{company}}, we will tell you honestly where it sits on our roadmap before you sign anything.
- **Termination:** either party may end the pilot at any time with written notice; annual contracts renew unless cancelled 30 days before renewal.
- **Confidentiality:** we're glad to sign a mutual NDA covering the pilot.

## 6. Next steps

1. **You:** confirm pilot team ({{pilot_seats}} developers) and pilot owner — reply to bautista@nestmux.com.
2. **Us:** kickoff scheduled within 5 business days — book directly with our CTO: calendly.com/matias-nestmux/new-meeting.
3. **Day 1:** kickoff + live setup on your stack.
4. **Day 30:** results review against Section 3 → decision.

—

**Bautista** — Commercial, Nest by RAVEN — bautista@nestmux.com
**Matías** — CTO, technical sessions — calendly.com/matias-nestmux/new-meeting
nestmux.com

---

## Internal checklist before sending (delete this section)

- [ ] All `{{placeholders}}` replaced (company, contact, date, team_size, team_name, use_case, pilot_seats, pilot_price, targets, annual_quote).
- [ ] `{{use_case}}` written from what was actually seen in the demo call — never generic.
- [ ] `{{pilot_price}}`: default recommendation is a paid pilot (e.g. 1 month at $60/seat for pilot seats, credited on conversion) to filter tire-kickers; free pilot allowed only with a signed kickoff date and named pilot owner.
- [ ] Quote math checked: seats × $60 × 12 = annual_quote (never below 4 seats).
- [ ] No claims added beyond `../00-brief-marca-y-datos.md` — especially nothing about token security, SOC2/SSO, or Jira/Slack/Notion integrations.
- [ ] Validity date = send date + 30 days.
