<div align="center">

# 🪺 Nest by RAVEN

**Multi-AI Terminal Workspace**

Open multiple Claude, Gemini, Codex, Copilot and more sessions — all in one flexible grid workspace, each with its own account and configuration.

[![Latest Release](https://img.shields.io/github/v/release/GeronimoDiClemente/raven-nest?style=flat-square&color=0055FF)](https://github.com/GeronimoDiClemente/raven-nest/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey?style=flat-square)](https://github.com/GeronimoDiClemente/raven-nest/releases/latest)

[Website](https://nestmux.com) · [Download for macOS](#download) · [Download for Windows](#download) · [Feedback & Issues](../../issues) · [Discussions](../../discussions)

</div>

---

## What is Nest by RAVEN?

Nest by RAVEN is a desktop app that lets you run **multiple AI CLI sessions side by side** in a single window. Think of it as a terminal multiplexer — but built specifically for AI agents.

Instead of switching between tabs in different terminals, you get a flexible **grid workspace** where each cell is an independent AI session with its own account, history, and environment.

---

## Terminal Sharing (new in v0.5.0)

Share an active terminal session with anyone — no SSH, no VPN, no port forwarding.

- **8-character code**: generate a cryptographically random code for any pane. Share it however you like.
- **Instant join**: the guest opens Nest, enters the code from the sidebar, and sees the host's terminal full-screen in real time.
- **Interactive mode**: optionally let the guest type and execute commands on the host machine.
- **Approval handshake**: the host gets a "Guest wants to connect" prompt and must click **Allow** before the guest can send any input. Nothing happens without explicit consent.
- **Session survives workspace switches**: move between tabs or workspaces — the shared session stays alive.
- **Hardened by default**: PTY input validation, sandbox mode, exponential backoff on reconnects, and OAuth origin checks on every handshake.

Use it for pair programming, onboarding, quick help sessions, or showing a teammate what's happening in a live process.

---

## Download

| Platform | Download |
|----------|----------|
| **macOS** (Apple Silicon) | [Nest-0.5.0-arm64.dmg](../../releases/latest) |
| **macOS** (Intel) | [Nest-0.5.0.dmg](../../releases/latest) |
| **Windows** | [Nest-Setup-0.5.0.exe](../../releases/latest) |

---

## Installing on macOS

> Nest by RAVEN is not yet code-signed or notarized. macOS will block it with a *"damaged and can't be opened"* message. Follow these steps to install it anyway.

**1. Download the DMG** from the link above.

**2. Remove the quarantine flag** before opening it:

```bash
xattr -dr com.apple.quarantine ~/Downloads/Nest-0.5.0-arm64.dmg
```

**3. Open the DMG** and drag **Nest.app** to your `/Applications` folder.

**4. Remove the quarantine flag from the installed app:**

```bash
xattr -dr com.apple.quarantine /Applications/Nest.app
```

**5. Open Nest** from `/Applications` — it should launch normally.

> **Why is this needed?** macOS Gatekeeper quarantines apps downloaded from the internet that aren't notarized by Apple. The `xattr` command removes that flag so macOS treats the app as trusted. This is safe to do for apps you trust.

---

## Voice Input (Microphone)

Nest by RAVEN supports voice-to-text input powered by [OpenAI Whisper](https://github.com/openai/whisper). The microphone button transcribes your speech and sends it to the active pane.

**Setup (one time):**

```bash
# 1. Install Whisper
pip3 install openai-whisper

# 2. Pre-download the model (recommended — avoids a long wait on first use)
python3 -c "import whisper; whisper.load_model('base')"
```

The `base` model is ~140 MB and only downloads once. After that, Nest by RAVEN loads it in a few seconds on startup.

**While the model loads**, the Voice button in the sidebar shows `Loading…` with a spinner — just wait a moment before clicking it.

> **Note:** If Whisper is not installed, the microphone button simply won't transcribe — no crash or error. You can install it at any time and it will start working immediately.

---

## Features

### Multi-AI Support

Run any combination of AI CLIs in the same workspace:

| AI | CLI |
|----|-----|
| Claude | `claude` |
| Gemini | `gemini` |
| OpenAI Codex | `codex` |
| GitHub Copilot | `gh copilot` |
| OpenCode | `opencode` |
| Plain Terminal | `zsh` / `PowerShell` |
| Custom CLI | any command you define |

Each pane runs its own process with an isolated `HOME` directory — multiple accounts of the same AI, no conflicts.

---

### Grid Layout

Arrange panes in a flexible **resizable grid** (up to 4×4):

- Drag and drop panes to reorder
- Resize rows and columns freely
- Zoom any pane to fullscreen (`Escape` to go back)
- **Broadcast mode** — type once, send to all panes simultaneously

---

### Terminal Sharing

Share any pane with an 8-character code. Guests join from the sidebar, see your terminal live, and — once you approve the handshake — can type commands that execute on your machine. See the dedicated section above for details.

---

### Repo Settings Panel

Configure per-repo options without leaving Nest:

- Choose the default **merge method** (merge, squash, rebase)
- Define a **build/release workflow** that runs on demand
- Settings are scoped to each linked repo and stored locally

---

### Command History Panel

Every command you execute in a pane is captured automatically:

- Searchable history in the sidebar
- Re-run any past command with one click
- Scoped to the active pane, with filters across tabs

---

### Session Persistence

Your workspace is saved automatically. Close the app and reopen it — everything is exactly where you left it:

- All tabs, panes, and layout
- Account assignments and colors
- Pane notes and custom labels

---

### Saved Workspaces

Design a layout once, save it as a template, and load it instantly:

- Save any tab as a named workspace
- Load it in a new tab at any time
- Export and import workspace files to share with your team

---

### Conversation History

Nest by RAVEN automatically captures AI responses:

- Saves outputs to `~/.raven-nest/conversations/` as markdown
- Groups conversations by date, AI type, and account
- Export conversations to share or archive
- Full-text search across all saved conversations

---

### Command Palette

Hit `⌘K` (or `Ctrl+K`) to open the command palette:

- Fuzzy search across all actions, tabs, workspaces, snippets, and conversations
- Keyboard-first navigation
- Instant execution — no mouse needed

---

### Snippets & Custom CLIs

- **Snippets**: Save reusable prompts or code blocks, send them to any pane with one click
- **Custom CLIs**: Define your own CLI commands with custom labels and colors

---

### File Staging

Send files and images directly to any AI pane:

- **Drag & drop** files onto a pane to attach them
- **Paste images** from clipboard directly into the terminal
- Thumbnail preview bar appears before sending — add an optional message
- Files are attached using Claude Code's `@"path"` syntax for multimodal support
- Temp copies are cleaned up automatically on send, cancel, or remove

---

### Git Integration

Link a git repository to any workspace tab:

- Shows current branch and dirty status in the header
- Sets the working directory for new panes in that tab
- Opens the GitHub repo from the UI

---

### GitHub Integration

Connect your GitHub account and manage your repos directly from Nest by RAVEN:

- **OAuth login** — connect once, all repos available instantly
- **Browse repos** — visual list of your GitHub repositories
- **Clone or link** — clone to `~/RavenProjects/` or link an existing local folder
- **View PRs** — open, closed, with status indicators
- **Create PRs** — title, head/base branch dropdowns, description, submit — all without leaving Nest
- **AI Code Review** — one click sends the PR diff to Claude and shows an instant review summary
- **View Issues** — browse open and closed issues per repo with full detail view
- **Create branch from Issue** — open an issue, click "Create branch", and a feature branch is created on GitHub in one step
- **Open terminal in repo** — after creating a branch from an issue, open a terminal already positioned in that repo's local folder
- **CI status** — see build status per PR
- All operations use YOUR GitHub credentials — push, pull, review, all native

---

### Teams — Real-time Collaboration

Full team workspace with sidebar navigation: Activity, Chat, Repos, Issues, Members, Snippets, Workspaces, MCP Servers.

- **Activity Feed**: real-time events from your team's GitHub repos (pushes, PRs, issues) with avatars
- **Team Chat**: timeline mixing GitHub events + manual status messages + emoji reactions (👍 ❤️ 🔥 👀 🎉). Realtime via Supabase
- **Repo management**: leaders add repos from GitHub, members clone/link locally and open terminals positioned in the repo
- **Multi-leader roles**: flexible hierarchy — any member can be promoted to leader. Leaders can add/remove repos, invite members, manage configs
- **Presence**: see who's online in your team right now
- **Daily Standup**: auto-generated summary of the last 24h activity, copy to Slack/Discord
- **Shared resources**: snippets, workspaces, and MCP configs shared across the team
- Confirm dialogs on all destructive actions

---

### My Repos — Personal Workspace (Pro plan)

Same powerful layout as Teams but for individual developers:

- Sidebar with Activity, Repos, Issues, Standup sections
- GitHub notifications bell with unread count
- Clone or link repos, view PRs and Issues, open terminals in one click
- Daily standup summary of your personal activity
- Full control: add, remove, link/unlink repos

---

### Git Status Panel

Click "Status" on any linked repo to see:

- Current branch with green/orange dot (clean/dirty)
- Ahead/behind counts relative to remote
- List of changed files with color-coded status (Modified, Added, Deleted, Untracked)
- Quick refresh button

---

### MCP (Model Context Protocol)

Built-in panel to manage MCP servers for Claude:

- Read and write `~/.claude/settings.json`
- Add, edit, or remove MCP server configs
- Shared across all Claude accounts
- Path validation on every entry to prevent malformed configs

---

### Multi-Tab Support

Organize your work across multiple tabs:

- Each tab has its own layout, panes, and linked repo
- Rename, recolor, and reorder tabs
- Tab activity indicators show when a pane is producing output

---

### Block View

Switch any pane to **Block View** to see AI responses as individual collapsible cards:

- Each response is captured as a timestamped block
- Expand/collapse long responses
- Copy any block to clipboard instantly
- Toggle between terminal and block view at any time

---

### Auto-Updater

Nest by RAVEN checks for updates in the background every 4 hours. When a new version is available, you'll get a notification and can install it on next quit — no manual downloads.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘T` / `Ctrl+T` | New pane |
| `⌘K` / `Ctrl+K` | Command palette |
| `⌘F` / `Ctrl+F` | Global search |
| `⌘⇧S` / `Ctrl+Shift+S` | Share terminal (generate code) |
| `⌘+` / `⌘-` / `⌘0` | Font size |
| `⌘1–9` | Jump to Nth pane |
| `⌘←` / `⌘→` | Navigate between panes |
| `Escape` | Exit fullscreen zoom |

---

## Account & Config Management

### Multiple accounts per AI

Each account gets its own isolated directory under `~/.raven-nest/accounts/<ai>/<name>/`. You can have as many accounts as you want — they never share session state unless you explicitly link them.

### Claude config options

**Option A — Isolated config per account (default)**

Each Claude account has its own `.claude/` folder with independent settings, plugins, and history.

**Option B — Shared config across all accounts**

Run `scripts/link-claude-config.bat` to symlink all Claude accounts to your system-wide `~/.claude/`. Any account you add later needs the script run again.

```
.raven-nest/
  accounts/
    claude/
      Account A/
        .claude  →  ~/.claude  (symlink)
      Account B/
        .claude  →  ~/.claude  (symlink)
```

---

## Plans

|  | Free | Pro | Team |
|--|------|-----|------|
| **Price** | $0 | $20/mo · $17/mo annual | $35/mo · $29/mo annual |
| **Grid size** | 2×2 | Up to 4×4 | Up to 4×4 |
| **All 7 AIs** | ✓ | ✓ | ✓ |
| **Persistent sessions** | ✓ | ✓ | ✓ |
| **Command palette** | ✓ | ✓ | ✓ |
| **MCP server panel** | ✓ | ✓ | ✓ |
| **Broadcast mode** | — | ✓ | ✓ |
| **Terminal Sharing** | — | ✓ | ✓ |
| **Command History panel** | — | ✓ | ✓ |
| **Repo Settings panel** | — | ✓ | ✓ |
| **My Repos personal workspace** | — | ✓ | ✓ |
| **GitHub integration** | — | ✓ | ✓ |
| **Git status panel** | — | ✓ | ✓ |
| **Snippets & workspaces** | — | ✓ | ✓ |
| **Daily standup** | — | ✓ | ✓ |
| **Team Chat + reactions** | — | — | ✓ |
| **Team Activity feed** | — | — | ✓ |
| **Multi-leader roles** | — | — | ✓ |
| **Real-time team presence** | — | — | ✓ |
| **Shared repos** | — | — | ✓ |
| **Shared snippets & MCP** | — | — | ✓ |
| **Priority support** | — | — | ✓ |

Save ~15% with annual billing.

---

## Roadmap

### Phase 1 — Core Stability
- [x] Multi-pane grid layout
- [x] Session persistence
- [x] Saved workspaces
- [x] Multi-tab support
- [x] Command palette
- [x] Conversation history
- [ ] Persistent terminals (keep PTYs alive when app is closed)

### Phase 2 — Developer Experience
- [x] Git integration
- [x] MCP panel
- [x] Broadcast mode
- [x] File staging — drag & drop and paste images/files into panes
- [x] GitHub OAuth integration
- [x] Git status panel
- [x] Clone/link repos from UI
- [x] Terminal Sharing with approval handshake
- [x] Command History panel
- [x] Repo Settings panel (merge method, build/release workflow)
- [ ] AI error explain (select error → send to AI)
- [ ] CWD detection via shell integration
- [ ] Per-pane environment variables
- [ ] Embedded terminal in Teams/My Repos workspace
- [ ] Webhook-based event ingestion (replace polling)

### Phase 3 — Power Features
- [x] Block-based output view (like Warp)
- [x] Team Chat with reactions
- [x] Multi-leader team roles
- [x] My Repos personal workspace
- [ ] Team activity analytics dashboard
- [ ] Global hotkey to show/hide Nest
- [ ] Natural language → shell command
- [ ] Plugin system
- [ ] Session export to HTML

---

## Feedback

Found a bug? Have a feature request? We'd love to hear from you.

- [Open an Issue](../../issues) — bug reports, feature requests
- [Join the Discussion](../../discussions) — ideas, questions, general feedback

---

## Docs

- [Roadmap](docs/ROADMAP.md)

---

<div align="center">

Built with Electron · React · xterm.js · node-pty

</div>
