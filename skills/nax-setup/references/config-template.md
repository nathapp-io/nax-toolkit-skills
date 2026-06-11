# `.nax/config.json` templates

**Resolve every command from the detected language** — see `references/language-matrix.md` (the SSOT for per-language `test`/`build`/`typecheck`/`lint`/`lintFix`/`formatFix`, `testFilePatterns`, gate flags, and output-format knobs). These templates show how to *assemble* what you find there. Omit `"models"` to inherit tiers from global `~/.nax/config.json`.

Notation: `<pm>` = JS package-manager run prefix (`bun run`/`npm run`/`pnpm run`/`yarn`), used **only when the language is JS/TS**. For Python/Go/Rust the commands are toolchain-direct (no `<pm>`).

---

## A. Single-package repo (no orchestrator, no mono configs)

Commands call the language's toolchain/scripts directly. This is the whole setup — there is no `.nax/mono/`. The skeleton below is language-neutral; **fill `quality.commands`, `requireTypecheck`, the `*Output.format` knobs, `review.checks`/`commands`, and `testFilePatterns` from the language matrix.**

```jsonc
{
  "name": "<repo-name>",
  "version": 1,
  "quality": {
    "requireTypecheck": true,        // matrix: false for Go/Rust/JS and untyped Python
    "requireLint": true,
    "requireTests": true,
    "commands": {
      // fill ONLY the gates that exist for this language; omit the rest
      "test": "<from matrix>",
      "testScoped": "<from matrix, or same as test for single repo>",
      "typecheck": "<from matrix, or omit if language has none>",
      "lint": "<from matrix>",
      "lintFix": "<from matrix>",
      "formatFix": "<from matrix>"
    },
    "lintOutput": { "format": "auto" },        // matrix: "text" for Go/Rust/Python
    "typecheckOutput": { "format": "auto" }    // matrix: "text"/"none" for non-TS
  },
  "review": {
    "enabled": true,
    "checks": ["build", "typecheck", "lint", "semantic", "adversarial"],  // include ONLY checks whose command you set below
    "commands": {
      "build": "<from matrix, or omit if none>",
      "typecheck": "<from matrix, or omit if none>",
      "lint": "<from matrix>",
      "lintFix": "<from matrix>"
    }
  },
  "context": {
    "fileInjection": "keyword",
    "featureEngine": { "enabled": true, "budgetTokens": 2048 },
    "v2": { "enabled": true, "minScore": 0.1, "rules": { "allowLegacyClaudeMd": false } }
  },
  "plan": { "model": "balanced", "mode": "refine", "specGuard": true },
  "acceptance": { "enabled": true, "maxRetries": 3 },
  "precheck": { "storySizeGate": { "enabled": true, "maxAcCount": 15, "maxBulletPoints": 15 } },
  "execution": { "smartTestRunner": { "testFilePatterns": ["<from matrix>"] } }
}
```

### Worked single-package examples

**TypeScript (npm, jest):**
```jsonc
"quality": {
  "requireTypecheck": true, "requireLint": true, "requireTests": true,
  "commands": {
    "test": "npm run test", "testScoped": "npm run test",
    "typecheck": "npm run type-check", "lint": "npm run lint",
    "lintFix": "npm run lint:fix", "formatFix": "npm run lint:fix"
  },
  "lintOutput": { "format": "auto" }, "typecheckOutput": { "format": "auto" }
},
"review": { "enabled": true, "checks": ["build","typecheck","lint","semantic","adversarial"],
  "commands": { "build": "npm run build", "typecheck": "npm run type-check", "lint": "npm run lint", "lintFix": "npm run lint:fix" } },
"execution": { "smartTestRunner": { "testFilePatterns": ["**/*.spec.ts"] } }
```

**Go (single module, golangci-lint):** no `typecheck` gate; build IS the typecheck; vet folds into lint.
```jsonc
"quality": {
  "requireTypecheck": false, "requireLint": true, "requireTests": true,
  "commands": {
    "test": "go test ./...", "testScoped": "go test ./...",
    "lint": "golangci-lint run", "lintFix": "golangci-lint run --fix", "formatFix": "gofmt -w ."
  },
  "lintOutput": { "format": "text" }, "typecheckOutput": { "format": "none" }
},
"review": { "enabled": true, "checks": ["build","lint","semantic","adversarial"],
  "commands": { "build": "go build ./...", "lint": "golangci-lint run", "lintFix": "golangci-lint run --fix" } },
"execution": { "smartTestRunner": { "testFilePatterns": ["**/*_test.go"] } }
```

**Python (uv, pytest, mypy, ruff):** prefer the `uv run` prefix; no build gate for a source-run lib.
```jsonc
"quality": {
  "requireTypecheck": true, "requireLint": true, "requireTests": true,
  "commands": {
    "test": "uv run pytest", "testScoped": "uv run pytest {{files}}",
    "typecheck": "uv run mypy src", "lint": "uv run ruff check",
    "lintFix": "uv run ruff check --fix", "formatFix": "uv run ruff format"
  },
  "lintOutput": { "format": "text" }, "typecheckOutput": { "format": "text" }
},
"review": { "enabled": true, "checks": ["typecheck","lint","semantic","adversarial"],
  "commands": { "typecheck": "uv run mypy src", "lint": "uv run ruff check", "lintFix": "uv run ruff check --fix" } },
"execution": { "smartTestRunner": { "testFilePatterns": ["**/test_*.py","**/*_test.py"] } }
```

**Rust (cargo):** build/check IS the typecheck; clippy is lint.
```jsonc
"quality": {
  "requireTypecheck": false, "requireLint": true, "requireTests": true,
  "commands": {
    "test": "cargo test", "testScoped": "cargo test",
    "lint": "cargo clippy", "lintFix": "cargo clippy --fix --allow-dirty --allow-staged", "formatFix": "cargo fmt"
  },
  "lintOutput": { "format": "text" }, "typecheckOutput": { "format": "none" }
},
"review": { "enabled": true, "checks": ["build","lint","semantic","adversarial"],
  "commands": { "build": "cargo build", "lint": "cargo clippy" } },
"execution": { "smartTestRunner": { "testFilePatterns": ["**/tests/**/*.rs","**/src/**/*.rs"] } }
```

---

## B. Monorepo (orchestrator- or workspace-driven)

Root commands drive the workspace. **JS/TS:** prefer root passthrough scripts over `npx turbo` so the pinned local orchestrator is used. **Go/Rust:** the toolchain spans the workspace natively (`go test ./...`, `cargo test --workspace`). Per-package overrides live in `.nax/mono/` (see `mono-config-template.md`) — detect each package's language independently.

```jsonc
{
  "name": "<repo-name>",
  "version": 1,
  "quality": {
    "requireTypecheck": true,        // root flag; per-package overrides may differ
    "requireLint": true,
    "requireTests": true,
    "commands": {
      "test": "<pm> run test",                          // JS/turbo; or "go test ./..." / "cargo test --workspace"
      "testScoped": "<pm> run test -- --filter=[HEAD^1]",   // turbo; nx uses the affected form
      "typecheck": "<pm> run type-check",               // omit if no package has a typecheck gate
      "lint": "<pm> run lint",
      "lintFix": "<pm> run lint:fix",
      "formatFix": "<pm> run lint:fix"
    },
    "lintOutput": { "format": "auto" },
    "typecheckOutput": { "format": "auto" }
  },
  "review": {
    "enabled": true,
    "checks": ["build", "typecheck", "lint", "semantic", "adversarial"],
    "commands": {
      "build": "<pm> run build",
      "typecheck": "<pm> run type-check",
      "lint": "<pm> run lint",
      "lintFix": "<pm> run lint:fix"
    }
  },
  "context": {
    "fileInjection": "keyword",
    "featureEngine": { "enabled": true, "budgetTokens": 2048 },
    "v2": { "enabled": true, "minScore": 0.1, "rules": { "allowLegacyClaudeMd": false } }
  },
  "plan": { "model": "balanced", "mode": "refine", "specGuard": true },
  "acceptance": { "enabled": true, "maxRetries": 3 },
  "precheck": { "storySizeGate": { "enabled": true, "maxAcCount": 15, "maxBulletPoints": 15 } },
  "execution": { "smartTestRunner": { "testFilePatterns": ["<from matrix>"] } }
}
```

---

## Config-only shape (non-invasive, either layout)

When you must NOT add scripts. Wire only commands that already exist; turn off gates whose command is missing. Example (JS where `build` already runs `tsc`, so no separate typecheck; no `--fix` script):

```jsonc
{
  "name": "<repo-name>",
  "version": 1,
  "quality": {
    "requireTypecheck": false,
    "requireLint": true,
    "requireTests": true,
    "commands": { "test": "<test cmd>", "lint": "<lint cmd>" }
  },
  "review": {
    "enabled": true,
    "checks": ["build", "lint", "semantic", "adversarial"],
    "commands": { "build": "<build cmd>", "lint": "<lint cmd>" }
  },
  "execution": { "smartTestRunner": { "testFilePatterns": ["<from matrix>"] } }
}
```

---

## Scripts to add for full parity — JS/TS ONLY

Go/Rust/Python have **no scripts to add** — their toolchain commands already exist; wire nax straight to them (or to `make` targets). For JS/TS:

Single repo — root `package.json`; Monorepo — every member `package.json`:
```jsonc
"type-check": "tsc --noEmit -p tsconfig.json",
"lint:fix": "<linter> --fix"   // e.g. "eslint -c .eslintrc.js --fix"
```

Monorepo ONLY — `turbo.json` tasks + root passthrough scripts:
```jsonc
// turbo.json tasks
"lint:fix":   { "cache": false, "outputs": [] },
"type-check": { "dependsOn": ["^build"], "outputs": [] },
"test:cov":   { "dependsOn": ["^build"], "outputs": ["coverage/**"] }
// root package.json
"type-check": "turbo type-check",
"lint:fix":   "turbo lint:fix",
"test:cov":   "turbo test:cov"
```
