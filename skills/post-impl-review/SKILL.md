---
name: post-impl-review
description: Post-implementation code review against a feature spec. Reads the spec (from .nax/features/<name>/spec.md, .nax/specs/*.md, or a user-provided path) and diffs changed code against the repo's default branch. Checks compliance (every AC/story covered?) and drift (does the implementation match the spec's approach, API shape, and constraints?). Prints severity-graded findings to the terminal with a single verdict. Use after completing a feature implementation to verify it matches the spec before merging.
---

# Spec Review

Review changed code against a feature spec. Check compliance (every AC/story covered?) and drift (implementation deviates from spec approach, API shape, or constraints). Print severity-graded findings to the terminal with a unified verdict.

**Announce at start:** "Using post-impl-review to review implementation against `<resolved-spec-path>`."

## Step 1: Resolve the spec

`args` is the text the user typed after `/post-impl-review` when invoking the skill. For example, `/post-impl-review graphify-kb` gives `args = "graphify-kb"`, and `/post-impl-review` alone gives `args = ""`.

Parse the invocation argument `args`.

**If `args` is an explicit path** (starts with `./`, `/`, or ends in `.md`):
- Use it directly. If the file does not exist, print an error and stop:
  ```
  Error: spec not found at <path>
  ```

**If `args` is a plain name** (e.g. `graphify-kb`, no slashes, no `.md`):
- Try `.nax/features/<name>/spec.md`
- If not found, also try `.nax/specs/<name>.md`
- If still not found, print error and stop:
  ```
  Error: no spec found for "<name>". Checked:
    .nax/features/<name>/spec.md
    .nax/specs/<name>.md
  ```

**If `args` is empty**:
- Run:
  ```bash
  find .nax/features -name "spec.md" 2>/dev/null
  find .nax/specs -name "*.md" 2>/dev/null
  ```
- If exactly one file found: use it, print the resolved path.
- If multiple found: list them and ask the user to pick:
  ```
  Multiple specs found. Which would you like to review?
  1. .nax/features/graphify-kb/spec.md
  2. .nax/features/api-foundation/spec.md
  3. .nax/specs/fts-tantivy-migration.md
  Enter number:
  ```
  Wait for the user's response, then use the selected path.
- If none found: print error and stop:
  ```
  No spec found. Checked:
    .nax/features/*/spec.md
    .nax/specs/*.md
  Pass a path or feature name: /post-impl-review <name|path>
  ```

Once resolved, print: `Spec: <resolved-path>`

Read the spec file in full before continuing.

If the spec file exists but is empty, print an error and stop:
```
Error: spec file is empty at <path>
```

## Step 2: Detect base branch and get the diff

**Detect base branch** — run in order, use the first that succeeds:

```bash
# 1. Ask git for the remote's default branch
git remote show origin 2>/dev/null | grep "HEAD branch" | awk '{print $NF}'
```

If this returns a non-empty string (e.g. `main`), use `origin/main`.

If the command fails or returns empty, fall back:
```bash
git rev-parse --verify origin/main 2>/dev/null && echo "main"
git rev-parse --verify origin/master 2>/dev/null && echo "master"
```

Use the first that exits 0. If neither works, print error and stop:
```
Error: cannot determine base branch.
Make sure a remote named 'origin' exists and has a default branch pushed.
```

**Get the diff:**
```bash
git diff origin/<branch>...HEAD --name-only   # changed file list
git diff origin/<branch>...HEAD               # full diff content
git diff origin/<branch>...HEAD --stat        # summary stats
```

Print: `Base: origin/<branch> (<stat summary>)`
Example: `Base: origin/main (3 files changed, +412 −87)`

## Step 3: Filter noise from the diff

Exclude these files from analysis (do not pass them to the model):

- Lockfiles: any file matching `bun.lock`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `poetry.lock`, or ending in `.lock`
- Generated output: files in `dist/`, `build/`, `.next/`, `.turbo/`, `__pycache__/`, or matching `*.generated.*`
- Binary files: git marks these as `Binary files a/... and b/... differ` — skip them entirely

**Size guard:** After filtering, if the remaining diff has more than 500 changed files or more than 8000 lines, print a warning and proceed:
```
Warning: large diff (N files, M lines — exceeds size limit). Review may miss fine-grained details.
Consider narrowing scope with /post-impl-review <feature-name>. Proceeding.
```

**Empty diff guard:** After filtering, if no changed files remain, print and stop:
```
No changes detected relative to origin/<branch>. Nothing to review.
```
This can happen if the branch has no commits ahead of the base, or if all changes were in excluded files (lockfiles, build output).

## Step 4: Single-pass analysis

With the full spec content and the filtered diff in context, perform a single analysis pass covering both dimensions:

**Compliance — per AC/story/requirement:**
For each numbered or named AC, story, or requirement in the spec, determine:
- **Covered** — the diff clearly addresses it
- **Partial** — the diff touches it but leaves something incomplete
- **Missing** — nothing in the diff implements it

**If the spec has no numbered or named ACs** (it's written as prose): derive implicit requirements from the prose — treat each described behaviour, endpoint, or constraint as a requirement. Note in the findings header: `(Spec has no structured ACs — requirements inferred from prose)`.

**Renames and deletions:** treat them as intentional changes when evaluating compliance. A diff showing `rename from A to B` or a deleted file counts as coverage for an AC that required moving or removing that module.

**Drift — holistic across the diff:**
Check whether the implementation matches the spec's described intent:
- API shape: do endpoints, request fields, response fields, and status codes match?
- Approach: is the architectural pattern (module structure, design pattern, data flow) what the spec called for?
- Constraints: are hard requirements respected (e.g. "must use HMAC-SHA256", "must be idempotent", "must validate at startup")?
- Naming: do key identifiers (routes, types, env vars, functions) match the spec's terminology?

Classify each finding using this severity table:

| Severity | Meaning |
|:---------|:--------|
| CRITICAL | AC entirely missing, or implementation directly contradicts a hard spec requirement |
| HIGH | Significant drift — wrong API shape, missing constraint, wrong architectural approach |
| MEDIUM | Partial coverage — AC present but incomplete; or minor drift that affects correctness |
| LOW | Minor naming deviation, style mismatch, or non-blocking gap |

## Step 5: Print findings

Print the full report to the terminal. Do not write any file.

**Format:**
```
Spec: .nax/features/graphify-kb/spec.md
Base: origin/main (3 files changed, +412 −87)

FINDINGS
────────────────────────────────────────
[CRITICAL] AC-3: Authentication endpoint missing
  Problem: Spec requires POST /auth/login but no such route exists in diff
  Fix: Add POST /auth/login handler in src/auth/auth.controller.ts

[HIGH] Drift: API response shape doesn't match spec
  Problem: Spec defines { data, error, meta } envelope; implementation returns raw objects
  Fix: Wrap responses with ApiResponse<T> in all controllers

[MEDIUM] AC-7: Partial — refresh token logic incomplete
  Problem: JWT_REFRESH_EXPIRES_IN env var referenced but never validated at startup
  Fix: Add env validation in src/config/env.ts

[LOW] Naming: route prefix uses /auth instead of /authentication as spec describes
  Problem: Spec says "mount under /authentication"; implementation uses /auth
  Fix: Rename prefix in src/auth/auth.module.ts (or note intentional deviation)

────────────────────────────────────────
VERDICT: 1 critical · 1 high · 1 medium · 1 low
Overall: FAILING
```

**Sort order:** CRITICAL first, then HIGH, then MEDIUM, then LOW.

**Verdict labels:**

| Verdict | Condition |
|:--------|:----------|
| `ALIGNED` | Zero critical and zero high findings |
| `NEEDS WORK` | One or more high findings, zero critical |
| `FAILING` | One or more critical findings |

**If no findings:**
```
Spec: .nax/features/graphify-kb/spec.md
Base: origin/main (2 files changed, +38 −4)

FINDINGS
────────────────────────────────────────
No findings.

────────────────────────────────────────
VERDICT: 0 critical · 0 high · 0 medium · 0 low
Overall: ALIGNED
```
