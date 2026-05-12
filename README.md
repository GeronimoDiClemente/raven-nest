<div align="center">

# 🪺 Nest by RAVEN

**Multi-AI Terminal Workspace · v1.0 is here**

Run Claude, Gemini, Codex, Copilot and more — side by side in a single window. Each pane is its own AI session, with its own account, history, and environment.

[![Latest Release](https://img.shields.io/github/v/release/GeronimoDiClemente/raven-nest?style=flat-square&color=0066FF)](https://github.com/GeronimoDiClemente/raven-nest/releases/latest)
[![v1.0](https://img.shields.io/badge/v1.0-official%20release-0066FF?style=flat-square)](#whats-new-in-v10)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square)](https://github.com/GeronimoDiClemente/raven-nest/releases/latest)

[Website](https://nestmux.com) · [Download](#download) · [Feedback](../../issues) · [Discussions](../../discussions)

</div>

---

## What is Nest by RAVEN?

Think of it as a terminal multiplexer — but built specifically for AI agents and the way teams ship code. Instead of juggling tabs and windows, you get a flexible **grid workspace** where every cell is an independent AI session, on top of the things developers actually need every day: native **git worktrees**, a real **Teams workspace**, your personal **My Repos** dashboard, GitHub & GitLab integration, CI runs, and live terminal sharing.

> **v1.0 is the first stable, non-beta release.** Auto-update is on by default — if you already have Nest installed, you'll get it shortly.

---

## What's new in v1.0

The headline of v1.0 is **branch-level isolation in the same window**: spawn a worktree per task, give each agent its own setup, and stop tripping over a single working tree. On top of that, Teams and My Repos are now the heart of the app.

### Worktrees + Spotlight (the new core)

- **Native git worktrees inside Nest.** Create a worktree per branch from any repo cell — fully self-contained, with its own dependencies and dev server, so two agents can work on two branches without collisions. Per-account isolated `RAVEN_HOME` so worktrees from different Nest accounts on the same machine never see each other.
- **Spotlight** — instead of a full worktree, mirror the active branch live to the repo root. Lighter than a real worktree, useful when you want a quick checkout without re-installing deps. Built-in **benchmark recorder** compares RAM, CPU and disk between modes so you can pick what fits.
- **Diff viewer + IDE picker.** Browse a worktree's diff in-app and open the file in your IDE of choice (VS Code, Cursor, JetBrains, Zed, Sublime, etc. — auto-detected) at the exact line.
- **Browser cell.** A cell that's a real Chromium browser (`WebContentsView`), not an iframe — preview your local dev server right next to the agent that's editing the code, with a working dev tools panel.
- **Port forwarding banner.** When a pane spawns a server on a local port, a banner offers to expose it (or copy a URL) without leaving Nest.

### Teams workspace, polished

- **Join by code with leader approval.** Each team has a rotatable 8-character code (visible to active members, regenerable by leaders). Paste it from the Teams empty state or the team switcher to request to join — leaders see and approve the requests right in the Members tab.
- **Multiple pending invites at once.** A user can hold pending invites to several teams and accept or decline each independently. The Sidebar Team icon shows a red badge with the pending count.
- **Per-user local paths** — each member of a team can have their own local clone path for shared repos; the team record stays clean, your machine stays your machine.
- **Clone over HTTPS for private team repos** — Nest now passes your OAuth token to the clone (token never lands in `.git/config`), so onboarding a new teammate to a private repo is one click.
- **Visible errors instead of silent failures** — every clone, branch fetch and remote action now surfaces what went wrong (status code, OAuth-app authorization hints) instead of failing quietly.
- **Sidebar redesigned (Superset-style)** — worktrees front and center, secondary tools (Layout, Snippets, Workspaces, MCP, Voice, Broadcast, Join Terminal, History, Cmd Hist.) collapsed into a "More tools" dropdown so on small windows or with many worktrees the sidebar stays scannable. Tab names no longer duplicate the repo folder when they match; account name no longer crowds pane headers (hover to see it).
- **Teams hardening (audit B12-B15)** — anti-spoof trigger on chat messages, server-side RPC for the GitHub event poller, scoped DELETE policies on team_members (excludes owner and self), and the Delete-team button only renders for the team owner.
- **Upgrade modal redesigned.** New hero, segmented Monthly/Annual toggle, three plan cards with grouped features ("Everything in Free, plus..."), and a `Most popular` badge on Pro. Plain-English feature copy across Free / Pro / Team.

### Carried over from v0.7

- **Actions panel** — last 5 CI runs (GitHub Actions / GitLab CI) inline in My Repos, Teams, and the sidebar.
- **GitLab integration** — repos, issues, pipelines.
- **Multi-provider** — both GitHub and GitLab connected at once.

> Previous release notes for v0.x are on the [GitHub Releases](../../releases) page.

---

## What's coming next

- **v1.1+ — Multi-agent co-edit.** A pub/sub layer (Supabase Realtime first, MQTT optional) on top of CRDTs (Yjs) so humans **and** AI agents can edit the same files in real time — Google-Docs style, multiplayer for code with agents in the channel, not just people.

---

## Download

Latest: **v1.0.1** — bug fixes (Teams panel + Browser cell + kill button + EPIPE crash).

| Platform | Download |
|----------|----------|
| **macOS** (Apple Silicon) | [Nest-1.0.1-arm64.dmg](../../releases/latest) |
| **Windows** | [Nest-Setup-1.0.1.exe](../../releases/latest) |
| **Linux** (universal) | [Nest-1.0.1.AppImage](../../releases/latest) |
| **Linux** (Debian / Ubuntu) | [nest_1.0.1_amd64.deb](../../releases/latest) |

> Nest auto-updates in the background — install once and you'll get future releases without re-downloading.

---

## Installing on macOS

Nest by RAVEN is not yet notarized by Apple, so macOS Gatekeeper will block it on first open. Two short commands fix that.

**1.** Download the DMG and remove the quarantine flag before opening it:

```bash
xattr -dr com.apple.quarantine ~/Downloads/Nest-1.0.0-arm64.dmg
```

**2.** Open the DMG, drag **Nest.app** to `/Applications`, then clear the flag on the installed app:

```bash
xattr -dr com.apple.quarantine /Applications/Nest.app
```

That's it — Nest will launch normally from now on.

---

## Installing on Linux

Two formats, pick whichever fits your distro.

### AppImage (universal, recommended)

Works on Ubuntu, Fedora, Arch, openSUSE, Mint, Pop!_OS and most others. No system-wide install.

```bash
chmod +x ~/Downloads/Nest-1.0.0.AppImage
~/Downloads/Nest-1.0.0.AppImage
```

To integrate it into your apps menu, use [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) or move it to `~/Applications/`.

### `.deb` (Debian, Ubuntu, Mint, Pop!_OS)

Installs system-wide, registers the desktop entry and the `nest://` deep link handler.

```bash
sudo apt install ~/Downloads/nest_1.0.0_amd64.deb
```

Required packages (auto-installed by `apt`): `libgtk-3-0`, `libnotify4`, `libnss3`, `libxss1`, `libxtst6`, `libatspi2.0-0`, `libdrm2`, `libgbm1`, `libxcb-dri3-0`, `xdg-utils`.

---

## Highlights

### Worktrees + Spotlight

Every repo cell can spawn a fully isolated **git worktree** — its own branch, its own deps, its own dev server. Two agents on two branches in the same window, never stepping on each other. Or use **Spotlight** to mirror the active branch live to the repo root if you want a lighter checkout. A built-in benchmark records RAM, CPU and disk so you can compare modes empirically. Each Nest account on a machine gets an isolated `RAVEN_HOME`, so worktrees from different accounts never collide.

### Teams — real-time collaboration

A full team workspace built on Supabase Realtime:

- **Shared repos** with **per-user local paths** — each member can clone wherever they want; the team config stays clean.
- **HTTPS clone with OAuth token** for private team repos — onboarding a teammate to a private repo is one click.
- **Activity feed** of GitHub events, **Team Chat** with emoji reactions and presence.
- **Shared snippets and MCP configs**, **multi-leader roles**.
- Auto-generated **daily standup** you can paste into Slack or Discord.

### My Repos (Pro)

Your personal command center for everything outside Teams. Same patterns as the Teams workspace, just for one developer:

- Browse, clone or link your GitHub & GitLab repos.
- View, create, review, AI-review and **merge** Pull Requests (merge method configured per repo).
- Browse Issues, comment, open/close, and **create a branch from any issue** that drops you straight into a terminal in the repo at that branch.
- Activity feed, Standup and one-click terminals positioned inside any repo.
- Inline **Actions panel** — last 5 CI runs (GitHub Actions / GitLab CI) per repo. No `cmd+tab` to the browser to know if it's green.

### Multi-AI grid

Run any combination of AI CLIs side by side in a resizable grid, up to **4×4**. Each pane is its own process with an isolated `HOME`, so multiple accounts of the same AI never conflict.

| AI | CLI |
|----|-----|
| Claude | `claude` |
| Gemini | `gemini` |
| OpenAI Codex | `codex` |
| GitHub Copilot | `gh copilot` |
| OpenCode | `opencode` |
| Plain Terminal | `zsh` / `PowerShell` / `bash` |
| Custom CLI | any command you define |

**Broadcast mode** — type once, send to every pane at the same time.

### Browser cell + diff viewer + IDE picker

A repo cell can be a live **Chromium browser** (real `WebContentsView`, not an iframe — devtools work) so you can preview your dev server right next to the agent editing the code. The **diff viewer** shows what changed in any worktree, with a one-click **IDE picker** that opens the file at the right line in VS Code, Cursor, JetBrains, Zed, Sublime — auto-detected.

### Terminal Sharing

Share a live pane with anyone via an 8-character code. They open Nest, paste the code and see your terminal in real time. With interactive mode the guest can type — but only after **you** approve the handshake. No SSH, no VPN, no port forwarding.

### Voice input

Speak instead of typing. Powered by [OpenAI Whisper](https://github.com/openai/whisper) running **locally** — audio never leaves your machine. Toggle with the mic button or press **`F5`**. Supports 8 languages.

One-time setup:

```bash
pip3 install openai-whisper
python3 -c "import whisper; whisper.load_model('base')"
```

### MCP panel

Read and write `~/.claude/settings.json` from a visual editor. Add, edit or remove MCP servers in seconds — shared across all your Claude accounts.

### Global search

`⌘⇧F` / `Ctrl+Shift+F` searches terminal output **across every open pane** at once and shows result counts per pane.

---

## Keyboard shortcuts

All rebindable in **Settings → Keybinds**.

| Shortcut (default) | Action |
|--------------------|--------|
| `⌘T` / `Ctrl+T` | New pane |
| `⌘K` / `Ctrl+K` | Command palette |
| `⌘F` / `Ctrl+F` | In-pane search |
| `⌘⇧F` / `Ctrl+Shift+F` | Global search |
| `⌘⇧S` / `Ctrl+Shift+S` | Share terminal |
| `⌘⇧Z` / `Ctrl+Shift+Z` | Zoom focused cell |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Cycle tabs |
| `⌘1–9` | Jump to Nth pane |
| `⌘←` / `⌘→` | Navigate between panes |
| `F5` | Toggle voice input |

---

## Plans

|  | Free | Pro | Team |
|--|------|-----|------|
| **Price** | $0 | $20/mo · $17/mo annual | $35/mo · $29/mo annual |
| **Grid size** | 2×2 | Up to 4×4 | Up to 4×4 |
| **All 7 AIs** | ✓ | ✓ | ✓ |
| **Persistent sessions** | ✓ | ✓ | ✓ |
| **MCP server panel** | ✓ | ✓ | ✓ |
| **Broadcast mode** | — | ✓ | ✓ |
| **Terminal Sharing** | — | ✓ | ✓ |
| **GitHub & GitLab integration** | — | ✓ | ✓ |
| **Actions panel** | — | ✓ | ✓ |
| **My Repos personal workspace** | — | ✓ | ✓ |
| **Snippets & saved workspaces** | — | ✓ | ✓ |
| **Daily standup** | — | ✓ | ✓ |
| **Team Chat + reactions** | — | — | ✓ |
| **Team Activity feed** | — | — | ✓ |
| **Multi-leader roles** | — | — | ✓ |
| **Real-time presence** | — | — | ✓ |
| **Shared repos / snippets / MCP** | — | — | ✓ |
| **Priority support** | — | — | ✓ |

Save ~15% with annual billing.

---

## Feedback

- [Open an Issue](../../issues) — bug reports, feature requests
- [Discussions](../../discussions) — ideas, questions, general feedback

<div align="center">

Built with Electron · React · xterm.js · node-pty

</div>
