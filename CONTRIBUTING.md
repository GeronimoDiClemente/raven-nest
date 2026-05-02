# Contributing to Nest by RAVEN

Thanks for your interest in making Nest better. This guide covers everything you need to ship a useful PR.

## Quick start

```bash
git clone https://github.com/GeronimoDiClemente/raven-nest.git
cd raven-nest
npm install
npm run dev
```

You'll need:

- Node 20+
- Python 3 with `pip3` (only if you want to test voice input via Whisper)
- A Supabase project of your own if you want to test cloud features (Teams, GitHub OAuth, billing). For purely local features (panes, terminals, MCP, snippets) you can run without a Supabase backend.

For cloud features, copy `.env.example` to `.env.local` and fill in:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
MAIN_VITE_GITHUB_CLIENT_ID=...
MAIN_VITE_GITLAB_CLIENT_ID=...   # optional
```

## What we welcome

- **Bug fixes** — anything that improves stability, fixes a crash, or makes an interaction feel right. Always welcome.
- **Platform polish** — Linux desktop integrations (icons, .desktop file, distro packaging), Windows quirks, macOS notarization helpers.
- **AI CLI support** — adding a new AI to the picker, fixing detection on a particular install path, improving the launch UX.
- **Docs and screenshots** — README clarity, edge-case install instructions, replacement screenshots when UI changes.
- **Performance** — reducing memory per pane, faster pane spawn, smaller bundle.
- **Accessibility** — keyboard-only navigation, screen reader support, color contrast.

## What we usually decline

- Refactors with no functional benefit.
- Adding heavyweight dependencies for features one or two users want.
- Sweeping UI redesigns submitted as a single PR. Open a Discussion first so we can align on direction.
- Features that require us to host new server-side infrastructure (we may merge them but they'll likely stay disabled by default until we decide on operations).

## Style

- TypeScript strict mode is on. New code should type-check cleanly.
- Prefer existing patterns. Stores are class instances in `electron/<domain>-store.ts`. IPC channels follow `<domain>:<action>`. UI components live in `src/components/`.
- Keep PRs focused — one change per PR. If you're tempted to "while I'm here, also fix...", that's a separate PR.
- Commit messages: short, imperative. `fix: pane crash on resize`, `feat(actions): retry button on failed run`. We don't enforce conventional commits strictly but consistency helps.

## Testing your change

- Run `npm run dev` and exercise the affected feature in the actual app.
- For UI changes: take before/after screenshots for the PR description.
- Type checking is implicit in the Vite build; run `npm run build` to confirm.
- We don't currently run an automated test suite. If you add critical logic, please add a comment explaining the manual test path you used.

## Submitting a PR

1. Fork, branch off `main`.
2. Push your branch, open a PR against `main`.
3. Describe the *why* in the PR body. The diff shows the *what*.
4. Add screenshots/recordings for any UI change.
5. Tag relevant issues with `Fixes #123` if applicable.
6. Be patient on review — this is maintained by a small team.

## Security issues

**Do not open a public issue for security vulnerabilities.** See [SECURITY.md](SECURITY.md) for the private disclosure process.

## License

By contributing you agree that your contributions are licensed under the same terms as the project — [Apache License 2.0](LICENSE).

## Code of conduct

Be kind. Assume good faith. Disagree on technical points; don't make it personal. We're all here because we like building developer tools — let's keep it that way.

If you see behavior that crosses the line, email gerodc06@gmail.com privately.
