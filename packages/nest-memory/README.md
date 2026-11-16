# @nestmux/memory

One memory for every coding agent on your machine. Claude Code, Codex, Cursor, Gemini CLI,
OpenCode, Qwen and VS Code save what they learn and recall it in the next session, in any of
them.

This is the portable half of [Nest](https://nestmux.com) Memory: it works on its own, with or
without the Nest app.

```bash
npx @nestmux/memory setup
```

That connects every supported editor it finds on this machine. Start a new agent session and
it will save and recall memories by itself.

## Commands

| Command | What it does |
|---|---|
| `setup` | Connect every editor on this machine. `--dry-run` shows what it would write, `--undo` removes it, `--claude`, `--codex`… limit it to one |
| `status` | What it sees, and whether it can decrypt |
| `search <words>` | Read your memory without an agent |
| `doctor` | Why something isn't working |
| `login` | Sync across your machines with a Nest account (optional) |
| `recover` | Unlock encrypted memory with your recovery code |
| `mcp` | The MCP server your editors launch. You don't run it yourself |

Run it with no arguments for the interactive view.

## How it works

- **Local first.** Memory lives in a SQLite database on your machine. Without an account, nothing
  leaves it.
- **No telemetry.** The package doesn't measure how you use it.
- **End-to-end encrypted sync.** With `login`, memory syncs across your machines through the Nest
  service, encrypted on your machine with a key the server never sees.
- **Works alongside Nest.** When the Nest app is open, the package hands everything to it, so the
  two never write to the same database at once.

## Requirements

Node.js 22.5 or newer. No native modules: it uses the `node:sqlite` built into Node.
