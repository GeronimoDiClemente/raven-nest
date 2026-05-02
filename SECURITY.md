# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Instead, email **gerodc06@gmail.com** with:

- A clear description of the issue
- Steps to reproduce
- The version of Nest you're running
- Whether you'd like to be credited (and how) once it's fixed

You should get an acknowledgement within **72 hours**. After that, expect periodic updates while we investigate and prepare a fix.

## Scope

We're particularly interested in:

- Bypasses of plan-based access control (e.g. Free users gaining Pro/Team features)
- Cross-team data leakage (one team reading another's data)
- Privilege escalation in team membership / roles
- Token / credential leakage (GitHub, GitLab, Anthropic API keys)
- Anything that lets an attacker forge data attributed to another user
- Local privilege issues in the Electron app (sandbox escape, IPC abuse)
- Auto-updater issues (signature bypass, downgrade attacks)

Out of scope:

- Issues that require physical access to an unlocked machine
- Issues in dependencies that already have a CVE (those should be reported upstream — we'll pick them up via dependency updates)
- Self-XSS where the user injects into their own session
- Attacks that require the user to install a malicious AI CLI

## Disclosure

We follow coordinated disclosure. After a fix is shipped:

- A security advisory is published on the GitHub repo
- The original reporter is credited in the release notes (unless they request otherwise)
- For severe issues, we'll request that you delay public discussion until users have had time to update (typically 7–14 days)

## Bug bounty

We don't currently run a paid bounty program. We do offer:

- Public credit in release notes and an entry in `SECURITY-CONTRIBUTORS.md`
- Free Pro plan for 12 months for any verified, reproducible vulnerability
- Free Team plan for 12 months for any critical vulnerability (RCE, auth bypass, multi-user data leak)

This may change as the project grows. Watch this file.

## What's already protected

For transparency about our threat model:

- Stripe / billing: all sensitive operations (checkout, webhook, subscription state) live in Supabase Edge Functions. Client uses publishable keys only.
- GitHub / GitLab OAuth: client secrets live server-side. The `*_CLIENT_SECRET` env vars are only set on edge functions.
- Plan enforcement: enforced at the database level (Postgres triggers + RLS policies). The client UI nudges, the database guarantees.
- Voice input (Whisper): runs locally. No audio is sent off the machine.
- Terminal Sharing: requires explicit per-session approval from the host before the guest can send any input.

If you can show that any of those guarantees doesn't hold, we want to hear from you.
