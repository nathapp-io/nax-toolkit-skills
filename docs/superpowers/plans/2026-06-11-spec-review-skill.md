# Spec Review Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a `/spec-review` skill that reads a feature spec and reviews changed code against the repo's default branch for compliance and drift, printing severity-graded findings to the terminal.

**Architecture:** A single markdown skill file (`skills/spec-review/SKILL.md`) that instructs Claude to resolve the spec, detect the base branch, fetch and filter the git diff, run a single-pass analysis, and print structured findings. No code — the skill is pure workflow instructions.

**Tech Stack:** Markdown (SKILL.md), git CLI commands (`git remote show`, `git diff`)

---

## File Structure

| File | Action | Purpose |
|:-----|:-------|:--------|
| `skills/spec-review/SKILL.md` | Create | Complete skill definition with frontmatter + full workflow |

---

### Task 1: Create `skills/spec-review/SKILL.md`

**Files:**
- Create: `skills/spec-review/SKILL.md`

This is the only deliverable. The skill is pure markdown — no code to compile or test. Verification is done in Task 2 by invoking the skill.

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p /path/to/nax-toolkit/skills/spec-review
```

- [ ] **Step 2: Write `skills/spec-review/SKILL.md`**

Write the file with this exact content:

```markdown
---
name: spec-review
description: Post-implementation code review against a feature spec. Reads the spec (from .nax/features/<name>/spec.md, .nax/specs/*.md, or a user-provided path) and diffs changed code against the repo's default branch. Checks compliance (every AC/story covered?) and drift (does the implementation match the spec's approach, API shape, and constraints?). Prints severity-graded findings to the terminal with a single verdict. Use after completing a feature implementation to verify it matches the spec before merging.
---

# Spec Review

Review changed code against a feature spec. Check compliance (every AC/story covered?) and drift (implementation deviates from spec approach, API shape, or constraints). Print severity-graded findings to the terminal with a unified verdict.

**Announce at start:** "Using spec-review to review implementation against `<resolved-spec-path>`."

## Step 1: Resolve the spec

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
  Pass a path or feature name: /spec-review <name|path>
  ```

Once resolved, print: `Spec: <resolved-path>`

Read the spec file in full before continuing.

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
Warning: large diff (N files, M lines). Review may miss fine-grained details.
Consider narrowing scope with /spec-review <feature-name>. Proceeding.
```

## Step 4: Single-pass analysis

With the full spec content and the filtered diff in context, perform a single analysis pass covering both dimensions:

**Compliance — per AC/story/requirement:**
For each numbered or named AC, story, or requirement in the spec, determine:
- **Covered** — the diff clearly addresses it
- **Partial** — the diff touches it but leaves something incomplete
- **Missing** — nothing in the diff implements it

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
```

- [ ] **Step 3: Verify the file was written correctly**

```bash
head -5 skills/spec-review/SKILL.md
```

Expected output:
```
---
name: spec-review
description: Post-implementation code review against a feature spec.
```

- [ ] **Step 4: Commit**

```bash
git add skills/spec-review/SKILL.md
git commit -m "feat(spec-review): add spec-review skill"
```

---

### Task 2: Smoke test the skill

**Files:**
- Read: `skills/spec-review/SKILL.md` (verify it loads and invokes correctly)

Invoke the skill on a real repo that has a `.nax/` directory with at least one spec or feature. The goal is to confirm each step of the workflow executes without error.

- [ ] **Step 1: Open a repo with a .nax/ directory**

Navigate to a repo that has `.nax/features/*/` or `.nax/specs/*.md` and has commits diverged from `origin/main` (or wherever the default branch is).

Example (using koda):
```bash
cd /home/williamkhoo/Desktop/projects/nathapp/koda
```

- [ ] **Step 2: Invoke the skill with no argument**

Run `/spec-review` with no args. Confirm:
- The skill scans and lists discovered specs
- It prompts you to pick if multiple are found (or uses the one found)
- It prints `Spec: <path>` and `Base: origin/<branch> (...)`

- [ ] **Step 3: Invoke the skill with a feature name**

Run `/spec-review api-foundation` (adjust to a real feature name in the repo). Confirm:
- Resolves to `.nax/features/api-foundation/spec.md` without prompting
- Proceeds to diff + analysis

- [ ] **Step 4: Invoke the skill with an explicit path**

Run `/spec-review .nax/specs/fts-tantivy-migration.md` (or any real path). Confirm:
- Uses the path directly without scanning

- [ ] **Step 5: Verify findings output format**

Confirm the terminal output matches the format in the design:
- Header line with spec path and base branch
- `FINDINGS` section with separator line
- Each finding has `[SEVERITY]`, `Problem:`, and `Fix:` lines
- Verdict line at the bottom with counts and label

- [ ] **Step 6: Commit smoke test notes (optional)**

If you made any corrections to SKILL.md during the smoke test, commit them:
```bash
git add skills/spec-review/SKILL.md
git commit -m "fix(spec-review): correct skill after smoke test"
```
