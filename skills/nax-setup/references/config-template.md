# `.nax/config.json` templates

Replace `<pm>` with the detected package-manager run prefix (`bun run`, `npm run`, `pnpm run`, `yarn`). Replace test patterns with the repo's real convention. Omit `"models"` to inherit tiers from global `~/.nax/config.json`.

---

## A. Single-package repo (no orchestrator, no mono configs)

Commands call the project's own scripts directly. This is the whole setup for a single repo — there is no `.nax/mono/`.

```jsonc
{
  "name": "<repo-name>",
  "version": 1,
  "quality": {
    "requireTypecheck": true,
    "requireLint": true,
    "requireTests": true,
    "commands": {
      "test": "<pm> test",
      "testScoped": "<pm> test",            // single repo: usually same as test (or a scoped test runner invocation)
      "typecheck": "<pm> type-check",
      "lint": "<pm> lint",
      "lintFix": "<pm> lint:fix",
      "formatFix": "<pm> lint:fix"
    }
  },
  "review": {
    "enabled": true,
    "checks": ["build", "typecheck", "lint", "semantic", "adversarial"],
    "commands": {
      "build": "<pm> build",
      "typecheck": "<pm> type-check",
      "lint": "<pm> lint",
      "lintFix": "<pm> lint:fix"
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
  "execution": { "smartTestRunner": { "testFilePatterns": ["**/*.spec.ts"] } }
}
```

Non-JS single repos: `test`→`pytest` / `go test ./...` / `cargo test`; `typecheck`→`mypy .` / (skip for Go) / `cargo check`; `lint`→`ruff check` / `golangci-lint run` / `cargo clippy`.

---

## B. Monorepo (orchestrator-driven)

Root commands drive turbo/nx. Prefer root passthrough scripts over `npx turbo` so the pinned local orchestrator is used. Per-package overrides live in `.nax/mono/` (see `mono-config-template.md`).

```jsonc
{
  "name": "<repo-name>",
  "version": 1,
  "quality": {
    "requireTypecheck": true,
    "requireLint": true,
    "requireTests": true,
    "commands": {
      "test": "<pm> test",
      "testScoped": "<pm> test -- --filter=[HEAD^1]",   // turbo; nx uses the affected form
      "typecheck": "<pm> type-check",
      "lint": "<pm> lint",
      "lintFix": "<pm> lint:fix",
      "formatFix": "<pm> lint:fix"
    }
  },
  "review": {
    "enabled": true,
    "checks": ["build", "typecheck", "lint", "semantic", "adversarial"],
    "commands": {
      "build": "<pm> build",
      "typecheck": "<pm> type-check",
      "lint": "<pm> lint",
      "lintFix": "<pm> lint:fix"
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
  "execution": { "smartTestRunner": { "testFilePatterns": ["**/*.spec.ts"] } }
}
```

---

## Config-only shape (non-invasive, either layout)

When you must NOT add scripts. Build already type-checks via `tsc`, so don't claim a separate typecheck gate; drop `lintFix` if no `--fix` script exists.

```jsonc
{
  "name": "<repo-name>",
  "version": 1,
  "quality": {
    "requireTypecheck": false,
    "requireLint": true,
    "requireTests": true,
    "commands": { "test": "<pm> test", "lint": "<pm> lint" }
  },
  "review": {
    "enabled": true,
    "checks": ["build", "lint", "semantic", "adversarial"],
    "commands": { "build": "<pm> build", "lint": "<pm> lint" }
  },
  "execution": { "smartTestRunner": { "testFilePatterns": ["**/*.spec.ts"] } }
}
```

---

## Scripts to add for full parity

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
