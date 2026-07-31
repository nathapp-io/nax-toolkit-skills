# Per-package `.nax/mono/<pkg>/config.json` — MONOREPO ONLY

**Do not create these for a single-package repo.** They exist only to override the root config per workspace member. A single-package repo's root `.nax/config.json` already runs the project's scripts directly.

Path mirrors the package's workdir relative to repo root. For a package at `packages/foo`, the file is `.nax/mono/packages/foo/config.json`. nax loads it as an override layered on the root config when a story targets that package.

Commands here run **from the package directory**, so they invoke the package's own toolchain/scripts (no `--filter`).

**Detect each package's language independently** (`go.mod`/`Cargo.toml`/`pyproject.toml`/`tsconfig.json`/`package.json`) and resolve its command set from `references/language-matrix.md` — a polyglot monorepo has a different command set, `testFilePatterns`, and output-format knobs per package. Do not assume every package is the same language as the root.

## Template (JS/TS — Jest example)

```jsonc
{
  "quality": {
    "commands": {
      "build": "<pm> run build",
      "test": "<pm> run test",
      "testScoped": "<pm-dlx> jest --config ./test/jest-test.json {{files}} --passWithNoTests",
      "typecheck": "<pm> run type-check",
      "lint": "<pm> run lint",
      "lintFix": "<pm> run lint:fix",
      "formatFix": "<pm> run lint:fix"
    },
    "lintOutput": { "format": "auto" },
    "typecheckOutput": { "format": "auto" }
  },
  "execution": { "smartTestRunner": { "testFilePatterns": ["**/*.spec.ts"] } },
  "acceptance": {
    "testFramework": "jest",
    "command": "<pm-dlx> jest --config ./test/jest-test.json {{FILE}}"
  }
}
```

`<pm-dlx>`: `npx` (npm), `bunx` (bun), `pnpm dlx` (pnpm), `yarn dlx` (yarn).

## Template (non-JS package — Go example)

A Go package in the same monorepo. No `<pm>`, no `typecheck` gate, `text`/`none` output formats:

```jsonc
{
  "quality": {
    "commands": {
      "build": "go build ./...",
      "test": "go test ./...",
      "testScoped": "go test ./...",
      "lint": "golangci-lint run",
      "lintFix": "golangci-lint run --fix",
      "formatFix": "gofmt -w ."
    },
    "lintOutput": { "format": "text" },
    "typecheckOutput": { "format": "none" }
  },
  "execution": { "smartTestRunner": { "testFilePatterns": ["**/*_test.go"] } },
  "acceptance": { "testFramework": "go-test", "command": "go test {{FILE}}" }
}
```

Python (`uv run pytest`/`uv run mypy src`/`uv run ruff check`) and Rust (`cargo test`/`cargo clippy`/`cargo fmt`) packages follow the same pattern — pull their command sets and flags from the language matrix.

## Tokens
- `{{files}}` — nax substitutes the changed source/test files for a scoped run.
- `{{FILE}}` — nax substitutes a single acceptance test file.

## Test-framework variants

| Framework | testFilePatterns | acceptance command |
|:--|:--|:--|
| Jest | `["**/*.spec.ts"]` (check `testRegex`) | `<pm-dlx> jest --config <cfg> {{FILE}}` |
| Vitest | `["**/*.test.ts"]` (check `include`) | `<pm-dlx> vitest run {{FILE}}` |
| bun:test | `["**/*.test.ts"]` | `bun test {{FILE}}` |
| pytest | `["**/test_*.py", "**/*_test.py"]` | `pytest {{FILE}}` (or `uv run pytest {{FILE}}`) |
| go test | `["**/*_test.go"]` | `go test {{FILE}}` |
| cargo test | `["**/tests/**/*.rs", "**/src/**/*.rs"]` | `cargo test` |

Always confirm the real convention from the framework config — do not guess. For Python under `uv`/`poetry`, prefix tool commands with `uv run`/`poetry run`.

## When a single root config is enough (still monorepo)

If every member package is genuinely identical AND you expect no divergence, the root config may cover all of them. Per-package configs remain the safer default — they isolate the inevitable per-package divergence later.
