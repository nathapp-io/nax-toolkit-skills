---
name: nax-setup
description: Set up nax in any repo, in any language — single-package OR monorepo. Wires .nax/config.json (quality, review, context, precheck, execution) to the repo's REAL build/test/lint/typecheck commands, resolving each from the detected language's own toolchain (npm/pnpm/yarn/bun scripts for JS/TS, pytest/mypy/ruff or uv/poetry for Python, go build/test/vet for Go, cargo for Rust, make targets where used). Adds per-package .nax/mono/<pkg>/config.json overrides ONLY when the repo is a workspace monorepo. Also writes the nax .gitignore section and a .naxignore so generated runtime artifacts stay out of git and out of the context engine. Use when a user asks to "set up nax", "configure nax for this repo/project", "add nax", or to port a working nax setup from one repo to another.
---

# nax Setup

Wire nax into a repo so every quality gate it runs maps to a command that **actually exists** in that repo's toolchain. Two independent axes:

- **Shape** — single-package (one buildable unit) vs. **monorepo** (multiple workspace packages, each with its own `.nax/mono/<pkg>/config.json`).
- **Language** — TypeScript, JavaScript, Python, Go, Rust, or a polyglot mix. The language decides **how each gate command is invoked** and **which gates even exist**.

**Detect both before writing anything. Never assume monorepo, and never assume the JS `<pm> run <task>` command shape.** The most common failure is a `.nax/config.json` that references commands the repo does not have — e.g. `npm run type-check` in a Go repo, `turbo test` in a single-package repo, or a `*.spec.ts` test pattern in a Python project.

## Core principle

**Every command nax is configured to run must resolve to a real, runnable command** — a `package.json` script, a `Makefile` target, a language toolchain subcommand (`go test`, `cargo build`, `pytest`), or an installed binary (`golangci-lint`, `ruff`). Confirm it resolves before writing it — or add it. Never copy a config from another repo verbatim without re-checking every command against *this* repo and *this* language.

## Workflow

### 1. Determine the shape (single vs mono)

**Monorepo** if any of: `workspaces` in root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, a Go/Cargo workspace (`go.work`, `[workspace]` in `Cargo.toml`), or a Python workspace (`uv` workspace, multiple `pyproject.toml`). List the real member package dirs.

Otherwise it's a **single-package repo** — even with subfolders, there's one buildable unit. Skip all `.nax/mono/` work.

### 2. Detect the language(s) — this drives everything

Per package (or once for a single-package repo), detect the language from its markers (nax priority: **go > rust > python > typescript > javascript**):

- `go.mod` → **Go** · `Cargo.toml` → **Rust** · `pyproject.toml`/`requirements.txt` → **Python** · `tsconfig.json` or `typescript` dep → **TypeScript** · else `package.json` → **JavaScript**.
- A monorepo may mix languages across packages — detect each independently.

Then resolve the command *form* for that language. **Do not reach for a package manager unless the language is JS/TS.** See `references/language-matrix.md` (the SSOT) — it maps each language to its `test` / `build` / `typecheck` / `lint` / `lintFix` / `formatFix` commands, its `testFilePatterns`, and its gate on/off flags.

- **JS/TS only** — detect the **package manager** from the lockfile (`bun.lock*`→bun, `package-lock.json`→npm, `pnpm-lock.yaml`→pnpm, `yarn.lock`→yarn) and the **orchestrator** (monorepo only: `turbo.json`/`nx.json`/none). Commands are `<pm> run <script>`.
- **Python** — invoke tools directly (`pytest`, `mypy src`, `ruff check`); **prefer the env-manager prefix** `uv run` / `poetry run` when `uv.lock` / `poetry.lock` is present.
- **Go / Rust** — invoke the toolchain directly (`go test ./...`, `cargo test`). No package-manager prefix, no scripts to add.
- **Any language** — if a `Makefile` is the repo's real entry point, gate commands may be `make <target>`.

### 3. Read the real commands; decide gate parity

Find what actually exists: JS/TS → `package.json` `scripts`; Python → `pyproject.toml` `[tool.*]` / `Makefile`; Go → toolchain (+ `golangci-lint` config); Rust → cargo. Detect the **test framework** (drives `testFilePatterns`): jest/vitest/bun:test/pytest/go test/cargo test.

nax's mechanical checks are **test, typecheck, lint** (quality gates, toggled by `requireTests`/`requireTypecheck`/`requireLint`) and **build** (a review check — there is no `requireBuild`; `build` lives in `review.checks` + `review.commands`, not as a quality flag). Per the language matrix, some checks **do not exist** for a language (`typecheck` for Go/Rust; `build` for a source-run Python lib) — **turn those off rather than inventing a command** (`requireTypecheck:false`; omit `build` from `review.checks`). Then pick a strategy and tell the user:

- **Full parity (JS/TS)** — add the missing scripts, then point nax at them: `type-check` → `tsc --noEmit -p tsconfig.json`; `lint:fix` → existing lint + `--fix`. Monorepo: also add the matching orchestrator task + root passthrough script. (Go/Rust/Python: there are no scripts to add — the toolchain commands already exist.)
- **Config-only (non-invasive)** — use only commands that already exist; turn off gates whose command is missing (`requireTypecheck:false`, drop `build` from `review.checks`, etc.).

### 4. Choose the command form by shape × language

- **Single repo:** commands call the toolchain/scripts directly — `bun run test`, `pytest`, `go test ./...`, `cargo test`. **No `--filter`, no orchestrator.**
- **Monorepo (JS/TS):** root commands drive the orchestrator — prefer `<pm> run <task>` (root passthrough → pinned local turbo/nx) over `npx turbo <task>`. Scoped: `<pm> run test -- --filter=[HEAD^1]` (turbo) or the nx affected form.
- **Monorepo (non-JS):** root command runs the toolchain across the workspace (`go test ./...`, `cargo test --workspace`); per-package overrides run each package's own command.

### 5. Write `.nax/config.json` (always)

Covers `name`, `quality` (requireTypecheck/Lint/Tests + `commands` + `lintOutput.format`/`typecheckOutput.format`), `review`, `context`, `plan`, `acceptance`, `precheck.storySizeGate`, `execution.smartTestRunner.testFilePatterns`. **Set the language-specific fields from `references/language-matrix.md`:** the gate commands, the `requireTypecheck` flag, `testFilePatterns`, and the output-format knobs (`"text"` for non-JS lint/typecheck so nax doesn't try to parse them as ESLint/tsc JSON). Omit `models` to inherit from global `~/.nax/config.json`. Templates in `references/config-template.md` (single-repo and monorepo shapes, with per-language command sets).

### 6. Write per-package overrides — MONOREPO ONLY

For each member package, create `.nax/mono/<relative-pkg-path>/config.json`. **Detect that package's own language** and override `quality.commands`, `testFilePatterns`, output-format knobs, and the `acceptance` framework + command accordingly — a polyglot monorepo has different command sets per package. Use `{{files}}`/`{{FILE}}` tokens. Template: `references/mono-config-template.md`. **Skip this step entirely for single-package repos.**

### 7. constitution.md and context.md (always)

Keep them if already tailored to the repo; otherwise scaffold real, project-specific content (architecture rules, coding standards, testing requirements, forbidden patterns; quick-reference commands; dependency order for monorepos). Use the repo's actual language and idioms — not TS boilerplate in a Go repo.

### 8. Ignore files — `.gitignore` + `.naxignore` (always)

nax writes generated runtime artifacts into the repo; keep them out of git, and keep nax's own tree out of the context engine. **Two separate files, both written here** — see `references/ignore-files.md` for the canonical entries and an idempotent apply snippet:

- **`.gitignore`** — append nax's `# nax — generated files` section (run logs, status, plans, session state, metrics, generated acceptance tests) **idempotently** (only lines not already present, so a prior `nax init` or a re-run never duplicates). Keep `.nax/config.json`, specs, `constitution.md`, `context.md` **tracked** — never blanket-ignore `.nax/`.
- **`.naxignore`** — context-engine suppression, **not** git. Always start with `.nax/`, then add the repo's heavy / generated / non-code top-level dirs (build output, deps/envs, caches, `docs/`, `examples/`, `scripts/`, …) so they don't dilute context. Monorepo: add a per-package `.naxignore` only when a package has heavy dirs the root file misses.

### 9. Verify before claiming done (mandatory)

Run `references/verification-checklist.md`. At minimum: validate every JSON file; for monorepos confirm the orchestrator (or workspace command) resolves each task; **run ONE real gate end-to-end in the repo's own language and confirm exit 0**; re-read every nax command and confirm it resolves to a real script/target/toolchain-subcommand/binary. Never report success on config alone.

## Common pitfalls

- **Assuming the JS `<pm> run` shape** — a Go repo has no `npm run test`; it has `go test ./...`. Resolve commands from the language, not a package manager.
- **Assuming monorepo** — a single-package repo needs no `.nax/mono/` and no orchestrator. Writing `turbo test` there fails.
- **Phantom gates** — `requireTypecheck:true` (the default) in a Go/Rust repo, or a `typecheck`/`build` entry in `review.checks` with no matching command. Turn the gate off per the language matrix.
- **Wrong `testFilePatterns`** — the schema default `test/**/*.test.ts` is TS-shaped; a pytest repo needs `**/test_*.py`, Go needs `**/*_test.go`. Read the framework's real convention.
- **Output-format mismatch** — leaving `lintOutput.format`/`typecheckOutput.format` on `"auto"` for Go/Rust/Python makes nax try to parse golangci/clippy/ruff/mypy output as ESLint/tsc JSON. Set `"text"`.
- **Missing env-manager prefix** — bare `pytest` in a `uv`/`poetry` repo can fail "command not found"; use `uv run pytest`.
- **Setting `test` to `build`** (tests never run); copying a bun config into an npm repo (`bunx`→fails).
- **Blanket-ignoring `.nax/` in `.gitignore`** — that untracks `config.json` and specs you want committed. Ignore only the generated artifacts (`references/ignore-files.md`), not the whole tree.
- **Skipping the ignore files** — manual setup never runs `nax init`, so nothing writes the `.gitignore` nax section or the `.naxignore`. Write both in step 8; don't assume `nax init` did it.
- **Running `nax init` / `nax init --force` to shortcut setup** — `--force` overwrites the hand-tailored `constitution.md` and `context.md` from step 7 (it spares an existing `config.json`, but not those). Write the `.gitignore` section manually (step 8); never reach for the CLI here.
- **Committing unrelated pre-staged changes** — inspect the index; stage only nax files.
