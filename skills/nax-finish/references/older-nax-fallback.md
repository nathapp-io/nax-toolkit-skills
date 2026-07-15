# Older-nax fallbacks (manual resolution)

Degraded paths for an older nax that lacks `nax features resolve --json` (or lacks the `acceptance` block in its output). Each fallback **mirrors the CLI's algorithm exactly**, so the result is identical to what the modern command would have produced. Only use these when the modern command is unavailable; the happy path in `SKILL.md` is the source of truth.

## Step 1 fallback — resolve the feature + spec source by hand

`nax features resolve` is **unavailable** when its stdout isn't JSON, or stderr shows `unknown command`. Say so once, then resolve by hand; first existing wins.

**If `args` looks like a path** (starts with `./`, `/`, or `~`, contains a `/`, or ends in `.md`/`.json`): use it directly as the spec source — markdown for a `.md`, PRD for a `prd.json`. (This is the route `nax-finish` itself takes when it re-invokes resolution with an already-resolved `specSource.path` such as `.nax/features/<name>/prd.json`.) If it doesn't exist, print `Error: spec not found at <path>` and stop.

**Otherwise treat `args` as a feature name** (if empty, discover first — below), set `featureName`, and search in this order:
1. `.nax/features/<name>/spec.md` — markdown
2. `.nax/specs/<name>.md` — markdown
3. `docs/specs/SPEC-<name>.md`, else the first match of `docs/specs/*<name>*.md` — markdown
4. `.nax/features/<name>/prd.json` — PRD fallback
```bash
ls .nax/features/<name>/spec.md .nax/specs/<name>.md docs/specs/SPEC-<name>.md 2>/dev/null
ls docs/specs/*<name>*.md 2>/dev/null
ls .nax/features/<name>/prd.json 2>/dev/null
```
**If `args` is empty**, discover candidate features first, then resolve the chosen one via the ordered search above:
```bash
find .nax/features -maxdepth 2 -name prd.json 2>/dev/null   # completed features
find .nax/features -maxdepth 2 -name spec.md 2>/dev/null
```
Exactly one feature → use it. Multiple → list numbered and ask the user to pick.

**If no spec source resolves at all** (no markdown spec *and* no `prd.json`): **ask the user** rather than hard-stopping —
```
No spec or PRD found for "<name>". Checked:
  .nax/features/<name>/spec.md
  .nax/specs/<name>.md
  docs/specs/SPEC-<name>.md  (and docs/specs/*<name>*.md)
  .nax/features/<name>/prd.json
Where is the spec? Paste a path, or press enter to abort.
```
Use the path the user provides (markdown spec). Abort only if they decline.

## Step 3 fallback — resolve the acceptance target(s) by hand

If the Step 1 output lacks an `acceptance` field (older nax `features resolve`, or you used the manual Step 1 fallback), resolve by hand. First check `acceptance.enabled` from config (Step 2); if `false`, skip the acceptance gate. Then:
- Single-package: `.nax/features/<featureName>/<acceptance.testPath>` — the nax convention places the generated acceptance test inside the feature directory, with the extension matching `project.language` (e.g. `.nax-acceptance.test.ts` for TS, `…test.py` for Python).
- Monorepo: the feature's stories may span **multiple packages**, and nax writes a **per-package feature directory** — the acceptance test lives at `<packageDir>/.nax/features/<featureName>/<acceptance.testPath>`, **not** in the root `.nax/features/<featureName>/` (the root dir holds only `spec.md` / `prd.json` / `acceptance-*.json` — no test file). The same feature name therefore appears under each package that contributes to it. **Discover every package the feature touches** with a recursive search rather than guessing — don't assume it lives in one place:
  ```bash
  # Find every per-package acceptance test for this feature (testPath from config; default _nax_acceptance_test.py / .nax-acceptance.test.ts)
  find . -path "*/.nax/features/<featureName>/<acceptance.testPath>" -not -path '*/node_modules/*' 2>/dev/null
  ```
  Run **each** match, honouring that package's `.nax/mono/<packageDir>/config.json` `acceptance.command`/`testPath` override. A feature spanning `packages/core`, `packages/backtester`, and `apps/api` yields three test files — all three must pass.

  **Run each match the way the runtime does — `cd` into its package first.** A per-package `acceptance.command` is authored **package-relative** (e.g. `bun vitest run --config .nax/vitest.acceptance.config.ts {{FILE}}`, where `.nax/` is `<packageDir>/.nax/`, **not** the root `.nax/`). So for a match at `<packageDir>/.nax/features/<featureName>/<testPath>`: spawn with **cwd = `<repoRoot>/<packageDir>`** and substitute the **absolute** file path for `{{FILE}}`. Run from `repoRoot` instead and you get `No test files found`, `Script not found "vitest"`, or a missing-config error — all of which mean *wrong cwd*, not a missing test. Match the runner to that **package's** language (the root `project.language` often differs); see the Step 3 failure-mode table in `SKILL.md`.
- If you cannot locate an acceptance test file for the feature, list where you looked (root feature dir **and** the recursive per-package search above) and ask the user for the path (or whether acceptance was generated at all) — do not silently skip.
