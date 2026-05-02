<div align="center">

# 🪺 Nest by RAVEN

**Multi-AI Terminal Workspace**

Run Claude, Gemini, Codex, Copilot and more — side by side in a single window. Each pane is its own AI session, with its own account, history, and environment.

[![Latest Release](https://img.shields.io/github/v/release/GeronimoDiClemente/raven-nest?style=flat-square&color=0066FF)](https://github.com/GeronimoDiClemente/raven-nest/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square)](https://github.com/GeronimoDiClemente/raven-nest/releases/latest)

[Website](https://nestmux.com) · [Download](#download) · [Feedback](../../issues) · [Discussions](../../discussions)

</div>

---

## What is Nest by RAVEN?

Think of it as a terminal multiplexer — but built specifically for AI agents. Instead of juggling tabs and windows, you get a flexible **grid workspace** where every cell is an independent AI session, plus the integrations a developer actually needs: GitHub, GitLab, Teams, CI runs, and live terminal sharing.

---

## What's new in v0.7.0

- **Actions panel — CI runs without leaving Nest.** Every repo in **My Repos** and **Teams** has an inline accordion with the last 5 GitHub Actions / GitLab CI runs (status, workflow, branch, commit, author, duration). Click any run to open it. Polling adapts: 30s while a run is in progress, 2 min when stable.
- **Sidebar Actions bar** — when a repo is linked to your active tab, the latest run for the current branch is visible at a glance.
- **GitLab integration** — full read access for repos, issues and Actions. Connect from Settings → Account, or sign in with GitLab right from the login screen. Auto-linked when you sign in via GitLab.
- **Multi-provider repo browser** — connect both GitHub and GitLab and your repos appear grouped per provider. Single-provider users see no extra chrome.
- **User menu with plan & avatar** — bottom of the sidebar shows your provider avatar with a colored dot for your plan (gray Free, blue Pro, gold Team, pulsing yellow on trial). Click for email, plan, trial countdown and sign out.
- **`Ctrl+Tab` fix on Windows** — Windows used to swallow `Ctrl+Tab`; now intercepted from the main process so both `Ctrl+Tab` and `Ctrl+Shift+Tab` cycle tabs everywhere.

> Previous release notes for v0.6.x and earlier are in the [GitHub Releases](../../releases) page.

---

## What's coming next

A short look at what's on the bench. Nothing is shipped yet — these are the next two horizons.

- **v1.0 — Worktrees + Spotlight.** Native git worktree management inside Nest, with two modes per cell: a fully self-contained worktree (own deps, own dev server) or **Spotlight**, a live mirror of the active worktree to the repo root. A built-in benchmark dashboard compares RAM, CPU and disk so you can pick what fits your workflow.
- **v1.1+ — Multi-agent co-edit.** A pub/sub layer (Supabase Realtime first, MQTT optional) on top of CRDTs (Yjs) so humans **and** AI agents can edit the same files in real time — Google-Docs style, multiplayer for code with agents in the channel, not just people.

---

## Download

Latest: **v0.7.0**.

| Platform | Download |
|----------|----------|
| **macOS** (Apple Silicon) | [Nest-0.7.0-arm64.dmg](../../releases/latest) |
| **Windows** | [Nest-Setup-0.7.0.exe](../../releases/latest) |
| **Linux** (universal) | [Nest-0.7.0.AppImage](../../releases/latest) |
| **Linux** (Debian / Ubuntu) | [nest_0.7.0_amd64.deb](../../releases/latest) |

> Nest auto-updates in the background — install once and you'll get future releases without re-downloading.

---

## Installing on macOS

Nest by RAVEN is not yet notarized by Apple, so macOS Gatekeeper will block it on first open. Two short commands fix that.

**1.** Download the DMG and remove the quarantine flag before opening it:

```bash
xattr -dr com.apple.quarantine ~/Downloads/Nest-0.7.0-arm64.dmg
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
chmod +x ~/Downloads/Nest-0.7.0.AppImage
~/Downloads/Nest-0.7.0.AppImage
```

To integrate it into your apps menu, use [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) or move it to `~/Applications/`.

### `.deb` (Debian, Ubuntu, Mint, Pop!_OS)

Installs system-wide, registers the desktop entry and the `nest://` deep link handler.

```bash
sudo apt install ~/Downloads/nest_0.7.0_amd64.deb
```

Required packages (auto-installed by `apt`): `libgtk-3-0`, `libnotify4`, `libnss3`, `libxss1`, `libxtst6`, `libatspi2.0-0`, `libdrm2`, `libgbm1`, `libxcb-dri3-0`, `xdg-utils`.

---

## Highlights

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

### GitHub & GitLab integration

Connect via OAuth and operate from inside Nest:

- Browse, clone or link repos from your account
- View, create, review and **merge** Pull Requests (with the merge method configured per repo)
- AI Code Review — sends the PR diff to Claude and shows a structured review
- Issues — browse, comment, open/close, **create a branch from any issue** and jump straight into a terminal positioned in the repo
- GitHub notifications bell with unread count
- GitLab read access for repos, issues and pipelines

### Actions panel (v0.7)

CI runs from GitHub Actions and GitLab CI inline in **My Repos**, **Teams** and the sidebar. No more `cmd+tab` to a browser to check if a build is green.

### Teams — real-time collaboration

A full team workspace: **Activity feed** of GitHub events, **Team Chat** with emoji reactions and presence, **shared repos / snippets / MCP configs**, **multi-leader roles** and an auto-generated **daily standup** you can paste into Slack or Discord.

### My Repos (Pro)

The same workspace but for solo devs — Activity, PRs, Issues, Standup and one-click terminals positioned inside any repo.

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
