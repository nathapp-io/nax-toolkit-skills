# Verification checklist

Run ALL applicable steps before reporting the setup complete. Evidence before assertions. Steps marked **[mono]** apply only to monorepos; skip them for single-package repos.

## 1. JSON validity (always)

```bash
jq empty .nax/config.json && echo "config OK"
# [mono] only if mono configs were written:
for f in .nax/mono/**/config.json; do jq empty "$f" || echo "BAD: $f"; done
jq empty turbo.json   # if you edited it
```

## 2. [mono] Orchestrator / workspace resolves every task

Each nax command must map to a task the workspace recognizes. **JS/TS orchestrators only:**

```bash
# Turborepo
npx turbo type-check --dry-run=text | grep -i 'Running type-check'
npx turbo lint:fix   --dry-run=text | grep -i 'in scope'
# Nx
nx run-many -t type-check --dry-run
```

Non-JS workspaces (Go/Cargo): confirm the workspace command spans the members — `go build ./...` / `cargo test --workspace` enumerate every package (`go list ./...` / `cargo metadata` to list members).

## 3. One real gate runs green (always)

Run a real gate **in the repo's own language** from the repo root and confirm exit 0. Pick the cheapest gate that actually exists:

```bash
# TypeScript:  timeout 120 npm run type-check
# JavaScript:  timeout 120 npm run lint
# Python:      timeout 120 uv run ruff check      (or: uv run pytest -q)
# Go:          timeout 120 go build ./...         (build IS the typecheck)
# Rust:        timeout 120 cargo check
# Make-based:  timeout 120 make <target>
# expect exit 0
```

- **[mono]** Pick the fastest gate + one leaf package (JS: `... --filter=<pkg>`; Go/Rust: run from the package dir).

If it fails because a command/script is missing, the wiring is wrong — fix before continuing.

## 4. Command-existence audit (always)

For every command in `.nax/config.json` (`quality.commands.*`, `review.commands.*`) and each `.nax/mono/*/config.json` [mono], confirm it **resolves to something runnable** — the form depends on the language:

- **JS/TS** — a `package.json` script (`jq -r '.scripts | keys[]' package.json`) or orchestrator task.
- **Python** — a tool on PATH or in the env (`uv run which pytest` / `poetry run which mypy`), or a `[tool.*]`/`Makefile` target.
- **Go** — a toolchain subcommand (`go help test`) or an installed binary (`which golangci-lint`).
- **Rust** — `cargo <sub> --help` (clippy/fmt may need `rustup component add clippy rustfmt`).
- **Make** — `make -n <target>` resolves.

No command may reference a script/binary/target that does not exist. **Also confirm `review.checks` lists only checks whose command you set** (e.g. no `typecheck` check in a Go config).

## 5. Language/PM consistency (always)

- Commands match the detected language: no `<pm> run …` in a Go/Rust repo; no `go test` in a JS repo.
- JS/TS: no `bunx`/`bun run` in an npm/pnpm/yarn repo (and vice versa).
- Python: tools that need the managed env carry the `uv run`/`poetry run` prefix.
- Non-JS: `lintOutput.format`/`typecheckOutput.format` are `"text"`/`"none"`, not `"auto"`.
- [mono] Scoped flag passthrough works (JS): `<pm> run test -- --filter=...` actually forwards `--filter` (verify with `--dry-run`).

## 6. Shape sanity (always)

- Single repo: confirm NO `.nax/mono/` directory was created and NO orchestrator command (`turbo`/`nx`) appears in the config.
- Monorepo: confirm one `.nax/mono/<pkg>/config.json` per real member package.

## 7. Clean commit (always)

```bash
git status --short            # inspect index — there may be unrelated pre-staged work
git reset -q                  # unstage everything, then stage ONLY nax files
git add .nax/config.json .nax/mono/ turbo.json package.json packages/*/package.json   # adjust to what you actually changed
git diff --cached --stat      # confirm scope before committing
```

Leave unrelated changes for the user; never bundle them into the nax-setup commit.
