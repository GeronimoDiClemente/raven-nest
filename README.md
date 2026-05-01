<div align="center">

# 🪺 Nest by RAVEN

**Multi-AI Terminal Workspace**

Open multiple Claude, Gemini, Codex, Copilot and more sessions — all in one flexible grid workspace, each with its own account and configuration.

[![Latest Release](https://img.shields.io/github/v/release/GeronimoDiClemente/raven-nest?style=flat-square&color=0055FF)](https://github.com/GeronimoDiClemente/raven-nest/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square)](https://github.com/GeronimoDiClemente/raven-nest/releases/latest)

[Website](https://nestmux.com) · [Download for macOS](#download) · [Download for Windows](#download) · [Download for Linux](#installing-on-linux) · [Feedback & Issues](../../issues) · [Discussions](../../discussions)

</div>

---

## What is Nest by RAVEN?

Nest by RAVEN is a desktop app that lets you run **multiple AI CLI sessions side by side** in a single window. Think of it as a terminal multiplexer — but built specifically for AI agents.

Instead of switching between tabs in different terminals, you get a flexible **grid workspace** where each cell is an independent AI session with its own account, history, and environment.

---

## What's new in v0.7.0

- **Actions panel — see your CI runs without leaving Nest** — every repo in **My Repos** now has an inline accordion showing the last 5 GitHub Actions / GitLab CI runs (status, workflow, branch, commit message, author, duration). Click any run to open it in the browser. Auto-refresh adapts: 30s while a run is in progress, 2 min when stable. Manual `↻` button per accordion.
- **Actions bar in the sidebar** — when a repo is linked to your active tab, the sidebar shows the latest run of the current branch at a glance. No clicks needed.
- **GitLab integration** — full read access for My Repos, Issues, and Actions. Connect from Settings → Account → GitLab, or sign in with GitLab from the start (button next to GitHub on the login screen). When you sign in via GitLab, the integration is auto-linked — no second OAuth needed.
- **Multi-provider repo browser** — when you have both GitHub and GitLab connected, repos in My Repos appear grouped by provider with a header for each section. Single-provider users see no extra chrome.
- **User menu with avatar & plan** — the bottom of the sidebar now shows your Google/GitHub/GitLab avatar with a colored dot indicating your plan (gray free, blue Pro, gold Team, pulsing yellow when on trial). Click opens a popover with email, plan, trial countdown, upgrade CTA, and sign out.
- **Sign in with GitHub & GitLab on the login screen** — alongside Google, with one-click auth and account-link conflict messaging if the email already exists with another provider.
- **Settings icon → real gear** — the sidebar Settings icon and the modal header use a proper gear glyph instead of the "sun with rays" that some users mistook for a brightness toggle.
- **Fix — `Ctrl+Tab` cycles tabs on Windows** — Windows reserves `Ctrl+Tab` as an accelerator and it never used to reach the renderer. Now intercepted from the main process and forwarded via IPC, so both `Ctrl+Tab` (next) and `Ctrl+Shift+Tab` (previous) work everywhere.

## What's new in v0.6.2

- **Rename conversations** — double-click any entry in the history sidebar (or use the new pencil button) to give it a custom name. Stored in a sidecar index, the original `.md` files are untouched.
- **Per-conversation icons** — pick a curated emoji for each saved conversation (`+` slot in the sidebar opens the picker).
- **Zoom a cell with one keybind** — `⌘⇧Z` (macOS) / `Ctrl+Shift+Z` (Win/Linux) toggles the focused cell to fill the workspace and back. Configurable in Settings → Keybinds → Zoom cell.
- **Cycle through tabs** — `Ctrl+Tab` / `Ctrl+Shift+Tab` jumps to next / previous workspace tab. Configurable in Settings → Keybinds.
- **Voice tooltip** mentions the `F5` hotkey, and the README documents the full voice flow (local Whisper, language picker, output target).
- **Fix — keybind recorder on Linux/X11**: chords like `Ctrl+Shift+T` recorded from a fresh start no longer get stuck on the first modifier. The recorder now waits for a non-modifier key and shows the accumulating chord while you hold modifiers.
- **Fix — CLI detector on Linux & macOS launchers**: Claude/Gemini/Codex/Copilot CLIs installed in `~/.local/bin`, `/snap/bin`, `/opt/homebrew/bin`, or `~/.npm-global/bin` are now resolved correctly when Nest is launched from a `.desktop` file (elementary OS, GNOME, KDE) or `.app` (macOS Finder), so the "install X" prompt no longer appears for already-installed CLIs.

## What's new in v0.6.1

- **Fix:** Shortcuts de navegación entre paneles (`Ctrl+←/→`) ahora funcionan correctamente en Linux.

---

## Linux is here (since v0.6.0)

Nest by RAVEN now runs natively on Linux. Same flexible grid, same multi-AI workspace, same Teams collaboration — now available as **AppImage** (universal, runs on most distros) and **.deb** (Debian, Ubuntu, Mint, Pop!_OS).

See [Installing on Linux](#installing-on-linux) below for instructions.

---

## Terminal Sharing (since v0.5.0)

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
| **macOS** (Apple Silicon) | [Nest-0.6.1-arm64.dmg](../../releases/latest) |
| **macOS** (Intel) | [Nest-0.6.1.dmg](../../releases/latest) |
| **Windows** | [Nest-Setup-0.6.1.exe](../../releases/latest) |
| **Linux** (universal) | [Nest-0.6.1.AppImage](../../releases/latest) |
| **Linux** (Debian / Ubuntu) | [nest_0.6.1_amd64.deb](../../releases/latest) |

---

## Installing on macOS

> Nest by RAVEN is not yet code-signed or notarized. macOS will block it with a *"damaged and can't be opened"* message. Follow these steps to install it anyway.

**1. Download the DMG** from the link above.

**2. Remove the quarantine flag** before opening it:

```bash
xattr -dr com.apple.quarantine ~/Downloads/Nest-0.6.1-arm64.dmg
```

**3. Open the DMG** and drag **Nest.app** to your `/Applications` folder.

**4. Remove the quarantine flag from the installed app:**

```bash
xattr -dr com.apple.quarantine /Applications/Nest.app
```

**5. Open Nest** from `/Applications` — it should launch normally.

> **Why is this needed?** macOS Gatekeeper quarantines apps downloaded from the internet that aren't notarized by Apple. The `xattr` command removes that flag so macOS treats the app as trusted. This is safe to do for apps you trust.

---

## Installing on Linux

Nest by RAVEN ships in two formats. Pick whichever fits your distro.

### Option A — AppImage (universal, recommended)

Works on virtually any Linux distribution (Ubuntu, Fedora, Arch, openSUSE, Mint, Pop!_OS, etc.) without installing anything system-wide.

**1. Download** `Nest-0.6.1.AppImage` from the [latest release](../../releases/latest).

**2. Make it executable:**

```bash
chmod +x ~/Downloads/Nest-0.6.1.AppImage
```

**3. Run it** — double-click the file in your file manager, or from terminal:

```bash
~/Downloads/Nest-0.6.1.AppImage
```

That's it. The AppImage is self-contained and includes all dependencies — no installation needed. To put it in your apps menu, integrate it via [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) or move it to `~/Applications/`.

### Option B — `.deb` (Debian, Ubuntu, Mint, Pop!_OS)

Installs Nest system-wide with desktop entry and `nest://` deep link handler registered automatically.

**1. Download** `nest_0.6.1_amd64.deb` from the [latest release](../../releases/latest).

**2. Install** with `apt` (handles dependencies automatically) or `dpkg`:

```bash
# Recommended — apt resolves missing dependencies
sudo apt install ~/Downloads/nest_0.6.1_amd64.deb

# Or with dpkg + apt-get to fix deps if needed
sudo dpkg -i ~/Downloads/nest_0.6.1_amd64.deb
sudo apt-get install -f
```

**3. Launch Nest** from your application menu, or run `nest` from terminal.

**Required system packages** (auto-installed by `apt`): `libgtk-3-0`, `libnotify4`, `libnss3`, `libxss1`, `libxtst6`, `libatspi2.0-0`, `libdrm2`, `libgbm1`, `libxcb-dri3-0`, `xdg-utils`. Most modern desktop distros already have them.

### Voice Input on Linux

Same as macOS/Windows — see [Voice Input](#voice-input-microphone) below. Make sure `python3` and `pip3` are installed (`sudo apt install python3-pip` on Debian/Ubuntu).

---

## Voice Input (Microphone)

Nest by RAVEN supports voice-to-text input powered by [OpenAI Whisper](https://github.com/openai/whisper). The microphone button transcribes your speech and sends it to the active pane.

**How it works:**

- Toggle on/off with the sidebar mic button or press **`F5`** (configurable in Settings → Keybinds).
- Recording runs locally — audio never leaves your machine.
- Choose the spoken language in **Settings → Voice language** (defaults to Spanish; English, Portuguese, French, German, Italian, Chinese, Japanese also supported).
- Transcribed text is inserted at the prompt of the focused pane.

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
- **Dynamic variables**: Snippets support `{{variable}}` placeholders — when you send a snippet, Nest prompts you to fill in each variable before dispatching
- **Broadcast**: Send a snippet to all open panes simultaneously
- **Team snippets**: Share snippets with your team so everyone can use and broadcast them
- **Custom CLIs**: Define your own CLI commands with custom labels and accent colors

---

### File Staging

Send files and images directly to any AI pane:

- **Drag & drop** files onto a pane to attach them
- **Paste images** from clipboard directly into the terminal — no temp file needed
- Thumbnail preview bar appears before sending — review, remove individual files, add an optional message, then send
- Files are attached using Claude Code's `@"path"` syntax for multimodal support
- Temp copies are cleaned up automatically on send, cancel, or remove

---

### Pane Customization

Fine-tune each terminal pane to match how you think:

- **Border color** — pick from 12 accent colors to visually distinguish panes at a glance
- **Pane note** — attach a short label (up to 60 characters) visible in the pane header ("Working on auth refactor", "Don't touch this one", etc.)
- **Process restart** — when a PTY process exits, a "Restart" button re-launches it in the same pane without reconfiguring anything
- **Desktop notifications** — if a terminal takes more than 2 seconds and the app is not focused, a native OS notification fires when it finishes

---

### In-Pane Search & Global Search

- **In-pane search** — `Cmd+F` / `Ctrl+F` while a pane is focused opens a search bar within that terminal. Matches are highlighted; navigate with Enter / Shift+Enter
- **Global search** — `Cmd+Shift+F` / `Ctrl+Shift+F` opens a floating panel that searches terminal output across all open panes simultaneously and shows result counts per pane

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

**Pull Requests:**
- View open and closed PRs with CI status indicators
- Create PRs — title, head/base branch dropdowns (auto-loaded), description, submit in-app
- Full PR detail — diff view per file with line-level +/− highlighting
- Submit reviews — Approve, Request Changes, or Comment
- Merge PRs — uses the merge method configured in Repo Settings (merge / squash / rebase)
- Update branch — one click when the PR is behind base
- AI Code Review — sends the PR diff to Claude and shows a structured review summary
- Stacked PRs — automatically detected and labeled when branches are chained

**Issues:**
- Browse open/closed issues filtered by All, Assigned to me, or Unassigned
- Full issue detail with comments
- Post comments directly from within the app
- Open / close / reopen issues
- Create branch from issue — one click creates a `issue-N-slug` branch on GitHub
- Open terminal in repo — jump straight to a terminal positioned in the repo after branching

**Notifications:**
- GitHub notification bell with unread count badge
- Notification panel lists PRs, issues, commits with type icons and relative timestamps
- Mark notifications as read from within the app

**After merge:**
- Create a GitHub release — auto-increments version, optionally triggers a build workflow

All operations use YOUR GitHub credentials — no personal access tokens needed.

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

Most shortcuts are customizable from **Settings → Keybinds**. Click any row and press a new key to rebind it.

| Shortcut (default) | Action |
|--------------------|--------|
| `⌘T` / `Ctrl+T` | New pane |
| `⌘K` / `Ctrl+K` | Command palette |
| `⌘F` / `Ctrl+F` | In-pane search |
| `⌘⇧F` / `Ctrl+Shift+F` | Global search (all panes) |
| `⌘⇧S` / `Ctrl+Shift+S` | Share terminal (generate code) |
| `⌘+` / `⌘-` / `⌘0` | Font size +/−/reset |
| `⌘1–9` | Jump to Nth pane |
| `⌘←` / `⌘→` | Navigate between panes |
| `Escape` | Exit fullscreen zoom / close search |

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
