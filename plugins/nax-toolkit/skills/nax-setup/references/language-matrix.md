# Language matrix — the SSOT for per-language command resolution

nax is language-agnostic. **Detect the language first, then resolve every gate command from that language's idiomatic toolchain — never assume the JS `<pm> run <task>` shape.** This file is the lookup table; the templates only show how to assemble what you find here into `.nax/config.json`.

nax's own detection (`detectLanguage`) recognizes, in priority order: **go > rust > python > typescript > javascript**. A repo can be polyglot — detect per package (see `mono-config-template.md`).

## How commands are invoked per language

There is **no universal "package-manager run" concept.** Each language has its own command form:

| Language | How a gate command is invoked | "Package manager" relevance |
|:--|:--|:--|
| **TypeScript / JavaScript** | A **script** in `package.json`, invoked via the detected PM: `bun run <s>`, `npm run <s>`, `pnpm run <s>`, `yarn <s>`. | Central — the PM prefix IS the command form. |
| **Python** | The tool **directly** (`pytest`, `mypy src`, `ruff check`), OR via the env manager: `uv run pytest`, `poetry run pytest`, or a bare command inside an activated venv. | Only as a **runner prefix** (`uv run` / `poetry run`), never `run <script>`. |
| **Go** | The toolchain **directly**: `go test ./...`, `go build ./...`, `go vet ./...`. External linters are bare binaries: `golangci-lint run`. | None. No PM prefix. |
| **Rust** | `cargo` subcommands: `cargo test`, `cargo build`, `cargo clippy`, `cargo fmt`. | None — cargo is the toolchain. |
| **Make-based (any lang)** | `make <target>` when a `Makefile` is the project's real entry point. | None. |

**Rule:** pick the invocation form from the detected language, then confirm the underlying tool/script/target actually exists (see Command-existence audit in `verification-checklist.md`). For Python, **prefer the env-manager prefix** (`uv run` / `poetry run`) when a lockfile (`uv.lock` / `poetry.lock`) is present — bare `pytest` often fails with "command not found" outside the managed venv.

## Per-language gate mapping

Fill `quality.commands.*` and `review.commands.*` from the row for the detected language. `—` means **that gate does not exist for this language — omit the command and turn its gate off** (do not invent a phantom command).

| Gate (config key) | TypeScript | JavaScript | Python | Go | Rust |
|:--|:--|:--|:--|:--|:--|
| `test` | `<pm> run test` | `<pm> run test` | `pytest` (or `<run> pytest`) | `go test ./...` | `cargo test` |
| `build` | `<pm> run build` | `<pm> run build` *(if present)* | — *(usually none)* | `go build ./...` | `cargo build` |
| `typecheck` | `tsc --noEmit -p tsconfig.json` | — *(usually none)* | `mypy <pkg-dir>` *(only if mypy configured; `mypy src` for src-layout, `mypy <package>` for flat-layout — point at the real source dir)* | — *(compiler typechecks; use `build`)* | — *(compiler typechecks; use `build`/`cargo check`)* |
| `lint` | `<pm> run lint` (eslint/biome) | `<pm> run lint` | `ruff check` (or `<run> ruff check`) | `golangci-lint run` *(folds in `go vet`)* | `cargo clippy` |
| `lintFix` | `<pm> run lint:fix` | `<pm> run lint:fix` | `ruff check --fix` | `golangci-lint run --fix` | `cargo clippy --fix --allow-dirty --allow-staged` |
| `formatFix` | `<pm> run format` / `lint:fix` | same | `ruff format` | `gofmt -w .` (or `goimports -w .`) | `cargo fmt` |

### `testScoped` — per-language scoped-run idiom

`testScoped` runs only the tests touching changed files (nax substitutes the `{{files}}` token with changed paths). The JS `--filter=[HEAD^1]` form is **turbo-only** — do not use it elsewhere. Per language:

| Language | `testScoped` | Token semantics |
|:--|:--|:--|
| TS/JS (turbo) | `<pm> run test -- --filter=[HEAD^1]` | turbo affected-graph; no `{{files}}` |
| TS/JS (jest/vitest direct) | `<pm-dlx> jest {{files}} --passWithNoTests` / `vitest run {{files}}` *(add `--config <path>` if the repo uses a non-default jest/vitest config)* | `{{files}}` = space-separated changed file paths |
| Python (pytest) | `<run> pytest {{files}}` | `{{files}}` = changed paths; pytest accepts file paths and `::node` ids |
| Go | `go test {{files}}` — or, if `{{files}}` resolves to packages, `go test ./...` | Go tests run per-**package**, not per-file; `go test <file>` needs all files in the package, so package-scoped (`./pkg/...`) is safer. When unsure, set it equal to `test`. |
| Rust | `cargo test` (full) — or `cargo test --test {{files}}` for integration tests only | cargo has no per-file run; it scopes by test target/name, not path. Full-suite is the safe default. |

**Rule:** if a language has no clean per-file scoped form (Go, Rust), set `testScoped` equal to `test` rather than inventing a path-based command that the toolchain can't honor. Over-running is correct; a broken scoped command is not.

### Gate on/off flags (set these from the row, do not leave defaults)

`quality.requireTypecheck` **defaults to `true`** in the schema — wrong for most non-TS repos. Set it explicitly:

| Language | `requireTypecheck` | Rationale |
|:--|:--|:--|
| TypeScript | `true` | `tsc` is a real, separate gate. |
| JavaScript | `false` | No typechecker (unless the repo opts into `tsc --checkJs`/`jsconfig`). |
| Python | `true` only if **mypy/pyright is actually configured**, else `false` | Many Python repos have no typechecker. |
| Go | `false` | The compiler typechecks; express it as the `build` gate, not `typecheck`. |
| Rust | `false` | Same — `cargo build`/`cargo check` is the typecheck. |

For `go vet` / `cargo clippy`-style static analysis: there is **no `vet` gate** in nax's vocabulary (`test, typecheck, lint, build` only). Fold it into `lint` — `golangci-lint run` already runs vet-class analyzers; if you want raw vet too, use `lint: "go vet ./... && golangci-lint run"`.

### `review.checks` must match the commands you actually set

`review.checks` is an enum array drawn from `["typecheck","lint","test","build","semantic","adversarial"]`. **Only include a mechanical check if you provided its command.** A Go repo uses `["build","lint","semantic","adversarial"]` (no `typecheck`); a no-build Python lib uses `["typecheck","lint","semantic","adversarial"]` (no `build`). Leaving a `typecheck` check with no `typecheck` command is the #1 wiring bug.

## Test-file patterns per language

`execution.smartTestRunner.testFilePatterns` — the schema default (`test/**/*.test.ts`) is TS-shaped. **Always set it from the detected framework's real convention** (confirm against the framework config — `testRegex`/`include`/etc., never guess):

| Framework (auto-detected) | `testFilePatterns` |
|:--|:--|
| Jest (TS/JS) | `["**/*.spec.ts"]` *(or `**/*.test.ts` — check `testRegex`)* |
| Vitest (TS/JS) | `["**/*.test.ts"]` *(check `include`)* |
| bun:test | `["**/*.test.ts"]` |
| pytest | `["**/test_*.py", "**/*_test.py"]` |
| go test | `["**/*_test.go"]` |
| cargo test | `["**/tests/**/*.rs", "**/src/**/*.rs"]` *(Rust co-locates `#[cfg(test)]`; integration tests live in `tests/`)* |

## Output-format knobs (easy to miss, matters for non-JS)

nax parses lint/typecheck output. The format knobs default to `"auto"`, which assumes JS tools (ESLint/Biome/tsc JSON). **For non-JS toolchains, set them to `"text"` so nax does not try to parse golangci/clippy/ruff/mypy output as ESLint or tsc JSON:**

```jsonc
"quality": {
  "lintOutput":      { "format": "text" },   // non-JS: text. JS: "auto" (or "eslint-json"/"biome-json")
  "typecheckOutput": { "format": "text" }     // non-TS: text. TS: "auto" (or "tsc")
}
```

| Language | `lintOutput.format` | `typecheckOutput.format` |
|:--|:--|:--|
| TypeScript | `auto` (eslint-json / biome-json) | `auto` (tsc) |
| JavaScript | `auto` | `none` |
| Python | `text` | `text` |
| Go | `text` | `none` |
| Rust | `text` | `none` |

## "Full parity" — language-specific meaning

The "add missing scripts for full parity" step is a **JS-only** concept (you add `type-check` / `lint:fix` scripts to `package.json`). For Go/Rust/Python there are **no scripts to add** — the toolchain commands already exist; you simply wire nax to them (or to `make` targets if the repo standardizes on a Makefile). If a non-JS repo has *no* linter/typechecker configured at all, that is a real gap: either turn the gate off (`requireLint:false` / `requireTypecheck:false`) or, with the user's agreement, add the tool (e.g. introduce `ruff`/`golangci-lint`). Never wire a gate to a command that does not resolve.
