---
name: post-impl-review
description: Post-implementation code review against a feature spec. Reads the spec (.nax/features/<name>/spec.md, .nax/specs/*.md, or a given path) and diffs changed code against the default branch. Checks compliance (every AC/story covered, each covering test sound?), drift (does the implementation match the spec's approach, API shape, and constraints?), integration (does changed code work against the unchanged collaborators it calls into?), convention compliance (does the diff obey CLAUDE.md / .nax/rules / .claude/rules?), and code quality (test isolation, dead code, resource leaks, error handling, concurrency, performance, accessibility, security, design/maintainability) independent of the spec. Reads unchanged callees the diff depends on and loads rule files. Applies a tiered confidence threshold (≥80% spec-relative, ≥60% grounded code-quality) to stay high-signal, and prints severity-graded findings with a single verdict. Use after completing a feature implementation to verify it matches the spec before merging.
---

# Post-Implementation Review

Review changed code against a feature spec across five dimensions: compliance (every AC/story covered, and is each covering test actually sound?), drift (implementation deviates from spec approach, API shape, or constraints), integration (changed code works against the unchanged collaborators it calls into), convention compliance (changed code obeys the project's own rule files), and code quality (spec-independent defects and design/maintainability concerns in the changed lines — test isolation, dead code, resource leaks, error handling, concurrency, performance, accessibility, security, separation of concerns, abstraction quality, misleading names, unhandled edge cases). Report spec-relative findings at ≥80% confidence and code-quality findings at ≥60% when anchored to a changed line with a concrete cost. Print severity-graded findings to the terminal with a unified verdict.

**Announce at start:** "Using post-impl-review to review implementation against `<resolved-spec-path>`."

## Step 0: Run the review in a fresh subagent (dispatch guard)

The analysis (Steps 1–6) runs in an **isolated subagent** so the review gets fresh context — no anchoring on whoever wrote or orchestrated the code, and no pollution of the caller's context with the full diff plus every collaborator file and rule file the review reads. This skill owns its own dispatch: callers (a direct `/post-impl-review`, or another skill such as nax-finish invoking it inline) do **not** dispatch a subagent themselves — they just invoke this skill and relay its result.

**Are you the review worker?** You are the worker if, and only if, your task prompt contains the marker `POST_IMPL_REVIEW_WORKER`.

- **If you ARE the worker:** skip the rest of this step and run Steps 1–6 inline in your own (already isolated) context. Your `args` is the concrete spec path the dispatcher resolved, so Step 1 is a direct path hit. Instead of printing to a terminal, **return the full Step 6 findings report verbatim as your final message** — that message is the only thing that travels back to the dispatcher.

- **If you are NOT the worker** (invoked directly, or inline by another skill):
  1. **Resolve the spec path first, in your own context** using Step 1's resolution rules, through to printing `Spec: <resolved-path>`. Do this here — not in the worker — so that if resolution must ask the user (multiple specs found), the prompt reaches the actual user. You need the *path*; you don't need to read the file's contents (the worker does that). Stop on any Step 1 resolution error exactly as Step 1 specifies.
  2. **Dispatch exactly ONE `general-purpose` subagent** (Agent/Task tool). Instruct it to invoke the **post-impl-review** skill with `args` set to the **resolved concrete spec path** and with the marker `POST_IMPL_REVIEW_WORKER` present in its prompt; to follow the skill exactly (diff against the base branch, all five dimensions, the tiered confidence thresholds, the verdict labels); and to **return the full findings report verbatim as its final message**. Dispatch one worker over the **whole diff** — never fan out per-package; the Integration dimension depends on seeing cross-package boundaries holistically.
  3. **Relay the worker's report verbatim** to the user (or calling skill) and **STOP** — do not run Steps 1–6 yourself. If the worker reports the review stopped with an error (no diff, no base branch, empty diff, etc.), surface that error verbatim and stop.

A subagent cannot itself dispatch another subagent, so the `POST_IMPL_REVIEW_WORKER` marker is what prevents nesting — and even if the marker were ever absent, the worker would fall through to running inline rather than recursing.

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

This step only filters the **diff** down to meaningful changed lines. It does **not** restrict which files you may read: Step 4 requires opening unchanged collaborator files that the diff calls into. "Exclude" here means "don't treat these as reviewable changes," not "never open any file outside the diff."

Exclude these files from the *changed-lines* analysis (do not treat their churn as a reviewable change):

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

## Step 4: Gather context beyond the diff (collaborators + project conventions)

### 4a. Load project conventions

Before judging style or structure, load the repo's own rules so convention findings are grounded in *this project's* stated standards, not generic preference. Read whichever of these exist (they may all be absent — that's fine, just skip the Convention dimension):

```bash
ls CLAUDE.md AGENTS.md 2>/dev/null
find .nax/rules .claude/rules -name "*.md" 2>/dev/null
```

Read every file found. `.nax/rules/` takes priority over `.claude/rules/` when they conflict (nax-native is canonical). Honour each rule file's `paths:` / `appliesTo:` frontmatter if present — a rule scoped to `src/agents/**` does not apply to a diff under `apps/web/`. Extract the concrete, checkable directives (forbidden APIs, required patterns, naming, logging fields, file-size limits) and hold them for the Convention Compliance dimension in Step 5.

If no rule files exist, note `(No project rule files found — Convention Compliance skipped)` in the findings header and omit that dimension.

### 4b. Map external touchpoints (read the unchanged collaborators)

**Do this before judging anything.** Most real defects in a focused diff live on the boundary between the changed code and the *unchanged* code it calls into — and that unchanged code is, by definition, not in the diff. A diff-only read cannot see them.

Build the list of external touchpoints — every symbol the changed code *uses* but does not *define* (callees, polymorphic/interface calls, new arguments to existing APIs, consumers of changed outputs, collaborators named in the spec) — and read each definition with Read/Grep before judging. The full procedure with worked examples is in **`references/spec-review.md` → "Map external touchpoints first."** Treat an untested cross-cutting claim as **unverified, not satisfied**.

## Step 5: Analysis

With the full spec content, the filtered diff, **the collaborator code you read in Step 4b, and the project rules you loaded in Step 4a** in context, analyse across two reference-driven groups of dimensions:

- **Spec-relative dimensions — read `references/spec-review.md` and apply it in full:** Compliance (every AC/story covered, each covering test sound), Drift (implementation matches the spec's approach, API shape, constraints, naming), Integration (the changed code works against every real implementation/consumer of the Step 4b touchpoints), and Convention Compliance (the diff obeys the in-scope directives from the rules loaded in Step 4a). Apply the **≥80% confidence threshold** defined there. If Step 4a found no rule files, skip Convention Compliance.
- **Code-quality dimension — read `references/code-quality.md` and apply it in full:** spec-independent defects and design/maintainability concerns in the changed lines (test isolation, dead/redundant code, resource leaks, error handling, concurrency, performance, accessibility, security, and open-ended design/maintainability). Run its per-function enumeration forcing function, and apply the **≥60% confidence threshold** defined there — anchored to a changed line with a concrete cost. Do not over-suppress this tier to hit an arbitrary count.

**No double-counting:** when a test-isolation defect also downgrades an AC to Partial under Compliance, report it **once** — a single finding that names the defect and notes the AC consequence (see the Step 6 example), not one finding per dimension.

Classify each finding using this severity table:

| Severity | Meaning |
|:---------|:--------|
| CRITICAL | AC entirely missing; implementation directly contradicts a hard spec requirement; the changed code raises/crashes at runtime for a case the spec requires to work; or a security defect the diff introduces (hardcoded secret, injection sink) |
| HIGH | Significant drift (wrong API shape, missing constraint, wrong architectural approach); an integration defect that breaks a real collaborator the spec depends on (e.g. a built-in implementation that hits a runtime error on the new call path); or a violation of a project rule explicitly marked as required/forbidden (a banned API, a hard-blocked pattern) |
| MEDIUM | Partial coverage — AC present but incomplete; minor drift affecting correctness; an integration gap reachable through a now-permitted input (e.g. empty-array regression); a test-isolation defect that can cause false positives or flakiness under reordering/parallelism; a resource leak; a swallowed error on a real path; a concurrency/race or performance regression the diff introduces; or an accessibility defect on a new interactive UI element |
| LOW | Minor naming deviation, style mismatch, dead/redundant/duplicated code, unused locals, a soft convention deviation, or other non-blocking gap |

## Step 6: Print findings

Print the full report to the terminal. Do not write any file. (If you are the review worker dispatched in Step 0, "print" means **return this exact report as your final message** — it is relayed back verbatim by the dispatcher.)

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

[HIGH] Integration: new call path breaks an unchanged collaborator
  Problem: get_indicators() calls strategy_instance.get_references(pd.DataFrame());
           Leadership.get_references() reads info["sector"] → KeyError on the empty frame.
           Spec goal "every built-in strategy works" is unmet and untested (only test doubles covered).
  Fix: Pass real company info (or guard empty frames) before calling get_references; add a test over the dynamic built-ins

[HIGH] Convention: banned API used in source
  Problem: src/auth/session.ts uses console.error for failure logging.
           forbidden-patterns.md: "no console.log/console.error in src/ — use the project logger".
  Fix: Replace with logger.error("auth", ...) from src/logger

[MEDIUM] AC-7: Partial — refresh token logic incomplete
  Problem: JWT_REFRESH_EXPIRES_IN env var referenced but never validated at startup
  Fix: Add env validation in src/config/env.ts

[MEDIUM] Test integrity: test leaks global state without teardown
  Problem: test_ac4 sets os.environ[FMP_KEY] but never restores it; suite is green
           only because test_ac5 happens to pop it later. Reordering or parallel
           runs would give a false positive. AC-4 is therefore Partial, not Covered.
  Fix: Use monkeypatch.setenv (auto-teardown) or pop the key in a try/finally

[LOW] Dead code: redundant assignment in test helper
  Problem: cfg.universe.screener_limit = 500 repeats a value already set when the
           config was constructed; the assignment has no effect.
  Fix: Remove the redundant line

[LOW] Naming: route prefix uses /auth instead of /authentication as spec describes
  Problem: Spec says "mount under /authentication"; implementation uses /auth
  Fix: Rename prefix in src/auth/auth.module.ts (or note intentional deviation)

────────────────────────────────────────
VERDICT: 1 critical · 3 high · 2 medium · 2 low
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
