# Activating the private + releases-repo split

This branch (`worktree-private-repo-nest`) contains the changes needed to migrate Nest from a single public repository to a **split-repo model**:

- This repository (`raven-nest`) becomes **private** (closed source).
- A new public repository `raven-nest-releases` hosts the marketing README, binaries, and `min-version.json`.

> **This branch is not active yet.** It exists as a prepared alternative. Do **not** merge it without explicitly deciding to go private. See memory entry `private-repo-split-plan.md` for the rationale.

## What changed in this branch (vs. the public plan)

- `package.json` → `build.publish.repo` points to `raven-nest-releases`.
- `electron/main.ts` → `MIN_VERSION_URL` points to `raw.githubusercontent.com/GeronimoDiClemente/raven-nest-releases/main/min-version.json`.
- `.github/workflows/release.yml` → publishes binaries cross-repo using a PAT secret `RELEASES_REPO_TOKEN`.
- `README.md` → replaced with a minimal "internal repo" notice.
- `min-version.json` is **not** committed here; it lives in the public releases repo.
- `LICENSE` (PolyForm Strict), signing config, migration `20260514000000_trial_in_plan_gate.sql`, and the `stripe-webhook` fix are the same as the public plan.

## Steps to activate (manual, ~10 minutes)

1. **Create the public releases repo:**
   ```bash
   gh repo create GeronimoDiClemente/raven-nest-releases --public \
     --description "Nest by RAVEN — official releases"
   ```

2. **Bootstrap the public repo** with:
   - The marketing `README.md` from the public-plan version of `raven-nest` (everything that was at the root before this branch).
   - A `min-version.json` at the root, e.g. `{"min_version": "1.0.0"}`.
   - Enable Issues and Discussions (Settings → Features).

3. **Create a PAT** at https://github.com/settings/personal-access-tokens/new
   - Resource owner: `GeronimoDiClemente`
   - Repository access: only `raven-nest-releases`
   - Permissions: `Contents: Read/Write`, `Releases: Read/Write`, `Metadata: Read`
   - Add it to this repo's Secrets as `RELEASES_REPO_TOKEN`.

4. **Merge this branch** into `main` (or cherry-pick the changes).

5. **Make this repo private:** Settings → General → Danger Zone → Change visibility → Private.

6. **Optional:** Transfer open issues with `gh issue transfer <num> GeronimoDiClemente/raven-nest-releases`.

## Why this exists

See the project memory `private-repo-split-plan.md` for the full rationale, trade-offs vs. the public-plan, and the decision context from 2026-05-14.
