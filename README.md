<div align="center">

# 🪺 Raven Nest

**Multi-AI Terminal Workspace**

Open multiple Claude, Gemini, Codex, Copilot and more sessions — all in one flexible grid workspace, each with its own account and configuration.

[![Latest Release](https://img.shields.io/github/v/release/GeronimoDiClemente/raven-nest?style=flat-square&color=0055FF)](https://github.com/GeronimoDiClemente/raven-nest/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey?style=flat-square)](https://github.com/GeronimoDiClemente/raven-nest/releases/latest)

[Website](https://landing-nest.vercel.app) · [Download for macOS](#download) · [Download for Windows](#download) · [Feedback & Issues](../../issues) · [Discussions](../../discussions)

</div>

---

## What is Raven Nest?

Raven Nest is a desktop app that lets you run **multiple AI CLI sessions side by side** in a single window. Think of it as a terminal multiplexer — but built specifically for AI agents.

Instead of switching between tabs in different terminals, you get a flexible **grid workspace** where each cell is an independent AI session with its own account, history, and environment.

---

## Download

| Platform | Download |
|----------|----------|
| **macOS** (Apple Silicon) | [Nest-0.3.5-arm64.dmg](../../releases/latest) |
| **Windows** | [Nest-Setup-0.3.5.exe](../../releases/latest) |

---

## Installing on macOS

> Raven Nest is not yet code-signed or notarized. macOS will block it with a *"damaged and can't be opened"* message. Follow these steps to install it anyway.

**1. Download the DMG** from the link above.

**2. Remove the quarantine flag** before opening it:

```bash
xattr -dr com.apple.quarantine ~/Downloads/Nest-0.3.5-arm64.dmg
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

Raven Nest supports voice-to-text input powered by [OpenAI Whisper](https://github.com/openai/whisper). The microphone button transcribes your speech and sends it to the active pane.

**Setup (one time):**

```bash
# 1. Install Whisper
pip3 install openai-whisper

# 2. Pre-download the model (recommended — avoids a long wait on first use)
python3 -c "import whisper; whisper.load_model('base')"
```

The `base` model is ~140 MB and only downloads once. After that, Raven Nest loads it in a few seconds on startup.

**While the model loads**, the Voice button in the sidebar shows `Cargando…` with a spinner — just wait a moment before clicking it.

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

Raven Nest automatically captures AI responses:

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

### MCP (Model Context Protocol)

Built-in panel to manage MCP servers for Claude:

- Read and write `~/.claude/settings.json`
- Add, edit, or remove MCP server configs
- Shared across all Claude accounts

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

### Team Collaboration

Create a team and collaborate with your workspace in real time (Team plan):

- Invite members by email
- Share snippets, saved workspaces, and MCP configs across the team
- Switch between multiple teams
- Accept or reject pending invites from the UI

---

### Auto-Updater

Raven Nest checks for updates in the background every 4 hours. When a new version is available, you'll get a notification and can install it on next quit — no manual downloads.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘T` / `Ctrl+T` | New pane |
| `⌘K` / `Ctrl+K` | Command palette |
| `⌘F` / `Ctrl+F` | Global search |
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
| **Grid size** | 2×2 | 4×4 | 4×4 |
| **AI types** | All 7 | All 7 | All 7 |
| **Accounts** | Unlimited | Unlimited | Unlimited |
| **Broadcast mode** | — | ✓ | ✓ |
| **Snippets** | — | ✓ | ✓ |
| **Saved workspaces** | — | ✓ | ✓ |
| **MCP panel** | ✓ | ✓ | ✓ |
| **Shared snippets** | — | — | ✓ |
| **Shared workspaces** | — | — | ✓ |
| **Shared MCP configs** | — | — | ✓ |
| **Team members & invites** | — | — | ✓ |

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
- [ ] AI error explain (select error → send to AI)
- [ ] CWD detection via shell integration
- [ ] Per-pane environment variables

### Phase 3 — Power Features
- [x] Block-based output view (like Warp)
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