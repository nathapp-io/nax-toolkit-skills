# Per-package `.nax/mono/<pkg>/config.json` — MONOREPO ONLY

**Do not create these for a single-package repo.** They exist only to override the root config per workspace member. A single-package repo's root `.nax/config.json` already runs the project's scripts directly.

Path mirrors the package's workdir relative to repo root. For a package at `packages/foo`, the file is `.nax/mono/packages/foo/config.json`. nax loads it as an override layered on the root config when a story targets that package.

Commands here run **from the package directory**, so they invoke the package's own scripts (no `--filter`).

## Template (Jest example)

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
    }
  },
  "execution": { "smartTestRunner": { "testFilePatterns": ["**/*.spec.ts"] } },
  "acceptance": {
    "testFramework": "jest",
    "command": "<pm-dlx> jest --config ./test/jest-test.json {{FILE}}"
  }
}
```

`<pm-dlx>`: `npx` (npm), `bunx` (bun), `pnpm dlx` (pnpm), `yarn dlx` (yarn).

## Tokens
- `{{files}}` — nax substitutes the changed source/test files for a scoped run.
- `{{FILE}}` — nax substitutes a single acceptance test file.

## Test-framework variants

| Framework | testFilePatterns | acceptance command |
|:--|:--|:--|
| Jest | `["**/*.spec.ts"]` (check `testRegex`) | `<pm-dlx> jest --config <cfg> {{FILE}}` |
| Vitest | `["**/*.test.ts"]` (check `include`) | `<pm-dlx> vitest run {{FILE}}` |
| bun:test | `["**/*.test.ts"]` | `bun test {{FILE}}` |
| pytest | `["**/test_*.py", "**/*_test.py"]` | `pytest {{FILE}}` |
| go test | `["**/*_test.go"]` | `go test {{FILE}}` |

Always confirm the real convention from the framework config — do not guess.

## When a single root config is enough (still monorepo)

If every member package is genuinely identical AND you expect no divergence, the root config may cover all of them. Per-package configs remain the safer default — they isolate the inevitable per-package divergence later.
