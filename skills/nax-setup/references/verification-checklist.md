# Verification checklist

Run ALL applicable steps before reporting the setup complete. Evidence before assertions. Steps marked **[mono]** apply only to monorepos; skip them for single-package repos.

## 1. JSON validity (always)

```bash
jq empty .nax/config.json && echo "config OK"
# [mono] only if mono configs were written:
for f in .nax/mono/**/config.json; do jq empty "$f" || echo "BAD: $f"; done
jq empty turbo.json   # if you edited it
```

## 2. [mono] Orchestrator resolves every new task

Each nax command must map to a task the orchestrator recognizes:

```bash
# Turborepo
npx turbo type-check --dry-run=text | grep -i 'Running type-check'
npx turbo lint:fix   --dry-run=text | grep -i 'in scope'
# Nx
nx run-many -t type-check --dry-run
```

## 3. One real gate runs green (always)

- **Single repo:** run a real gate from the repo root:
  ```bash
  timeout 120 <pm> type-check    # expect exit 0
  ```
- **[mono]** Pick the fastest gate + one leaf package:
  ```bash
  timeout 120 <pm> type-check --filter=<one-leaf-package>   # expect "1 successful" / exit 0
  ```

If it fails because a script is missing, the wiring is wrong — fix before continuing.

## 4. Command-existence audit (always)

For every command in `.nax/config.json` (`quality.commands.*`, `review.commands.*`) and each `.nax/mono/*/config.json` [mono]:
- Trace it to a concrete `package.json` script (or Makefile/pyproject/go target) or orchestrator task.
- No command may reference a script that does not exist.

## 5. Package-manager consistency (always)

- No `bunx`/`bun run` in an npm/pnpm/yarn repo (and vice versa).
- [mono] Scoped flag passthrough works: `<pm> run test -- --filter=...` actually forwards `--filter` (verify with `--dry-run`).

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
