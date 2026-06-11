---
name: nax-setup
description: Set up nax in any repo — single-package OR monorepo. Wires .nax/config.json (quality, review, context, precheck, execution) to the repo's REAL build/test/lint commands, and adds per-package .nax/mono/<pkg>/config.json overrides ONLY when the repo is a workspace monorepo. Use when a user asks to "set up nax", "configure nax for this repo/project", "add nax", or to port a working nax setup from one repo to another. Handles package-manager differences (bun vs npm vs pnpm vs yarn), orchestrators (turbo/nx/none), and test frameworks (jest, vitest, bun:test, pytest, go test).
---

# nax Setup

Wire nax into a repo so every quality gate it runs maps to a command that **actually exists**. Works for both shapes:

- **Single-package repo** — one `package.json` (or `pyproject.toml`/`go.mod`/`Cargo.toml`). The root `.nax/config.json` runs the project's own scripts directly. **No `.nax/mono/` configs, no orchestrator.**
- **Monorepo** — multiple workspace packages. Root `.nax/config.json` drives the orchestrator (turbo/nx) across packages; each package gets a `.nax/mono/<pkg>/config.json` override running its own scripts.

**Detect the shape first; never assume monorepo.** The most common failure mode is a `.nax/config.json` that references commands the repo does not have (e.g. `turbo type-check` in a repo with no turbo and no `type-check` script).

## Core principle

**Every command nax is configured to run must resolve to a real script/task.** Confirm the underlying script exists before writing the command — or add it. Never copy a config from another repo verbatim without re-checking commands against *this* repo.

## Workflow

### 1. Determine the shape (single vs mono)

It's a **monorepo** if any of these is true: `workspaces` in root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, or a Go/Cargo workspace (`go.work`, `[workspace]` in `Cargo.toml`). List the real member package dirs.

Otherwise treat it as a **single-package repo** — even if it has subfolders, there's one buildable unit. Skip all `.nax/mono/` work.

### 2. Detect the stack (don't assume)

- **Package manager** (lockfile is truth): `bun.lock*`→bun (`bun run`/`bunx`), `package-lock.json`→npm (`npm run`/`npx`), `pnpm-lock.yaml`→pnpm (`pnpm`/`pnpm dlx`), `yarn.lock`→yarn. Non-JS: `pyproject.toml`/`requirements.txt`→python, `go.mod`→go, `Cargo.toml`→rust.
- **Orchestrator** (monorepo only): `turbo.json` / `nx.json` / none.
- **Scripts** — read `package.json` `scripts` (or Makefile / pyproject / go conventions). Note which of `build`, `test`, `lint`, `type-check`, `lint:fix`, `test:cov` exist. **They are usually NOT the full nax gate set.**
- **Test framework** — jest (`*.spec.ts`), vitest, `bun:test`, pytest, `go test`. Drives `execution.smartTestRunner.testFilePatterns` and the acceptance command.

### 3. Fill gaps (full parity) OR scope the config down

nax's standard gates: **test, typecheck, lint, lintFix, build**. Repos often lack a dedicated `type-check` (separate from `build`) and `lint:fix`. Pick one strategy and tell the user:

- **Full parity** — add the missing scripts, then point nax at them.
  - `type-check`: `tsc --noEmit -p tsconfig.json` (or `mypy`, `tsc -b`, etc.)
  - `lint:fix`: existing `lint` command + `--fix`.
  - Monorepo: also add the matching orchestrator task (`type-check`, `lint:fix`, `test:cov`) and root passthrough scripts.
  - Single repo: just add the package scripts; no orchestrator tasks needed.
- **Config-only (non-invasive)** — use only commands that already exist; e.g. `build` already runs `tsc`, so skip a separate typecheck; disable `lintFix`.

See `references/config-template.md`.

### 4. Choose the command form by shape

- **Single repo:** commands call the project's own scripts directly — `bun run test`, `npm run type-check`, `pytest`, `go test ./...`. **No `--filter`, no orchestrator.**
- **Monorepo:** root commands drive the orchestrator. Prefer `<pm> run <task>` (root passthrough script → pinned local turbo/nx) over `npx turbo <task>` (may fetch a different version). Scoped: `npm run test -- --filter=[HEAD^1]` (turbo) or the nx affected form.

### 5. Write `.nax/config.json` (always)

Covers `name`, `quality` (requireTypecheck/Lint/Tests + `commands`), `review`, `context`, `plan`, `acceptance`, `precheck.storySizeGate`, `execution.smartTestRunner`. Omit `models` to inherit from global `~/.nax/config.json` unless the repo needs its own tiers. Templates in `references/config-template.md` (single-repo and monorepo shapes).

### 6. Write per-package overrides — MONOREPO ONLY

For each member package, create `.nax/mono/<relative-pkg-path>/config.json` (path mirrors the package's workdir relative to repo root). Override `quality.commands` to run the package's own scripts, set `testFilePatterns`, set the `acceptance` framework + command. Use `{{files}}`/`{{FILE}}` tokens. Template: `references/mono-config-template.md`. **Skip this entire step for single-package repos.**

### 7. constitution.md and context.md (always)

Keep them if already tailored to the repo; otherwise scaffold real, project-specific content (architecture rules, coding standards, testing requirements, forbidden patterns; quick-reference commands; dependency order for monorepos).

### 8. Verify before claiming done (mandatory)

Run `references/verification-checklist.md`. At minimum: validate every JSON file; for monorepos confirm the orchestrator resolves each task; run ONE real gate end-to-end and confirm exit 0; re-read every nax command and confirm a matching script/task exists. Never report success on config alone.

## Common pitfalls

- **Assuming monorepo** — a single-package repo needs no `.nax/mono/` and no orchestrator. Writing `turbo test` there fails.
- Copying a bun config into an npm repo (`bunx`→fails). Translate every command to the detected PM.
- Setting `quality.commands.test` to `build` (tests never run).
- Referencing `turbo type-check` / `lint:fix` when no such task/script exists.
- `testFilePatterns` pointing at `**/*.test.ts` when the repo uses `*.spec.ts` (read the framework's `testRegex`/`include`).
- Committing unrelated pre-staged changes — inspect the index; stage only nax files.
