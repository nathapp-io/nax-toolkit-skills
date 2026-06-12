---
name: post-impl-review
description: Post-implementation code review against a feature spec. Reads the spec (from .nax/features/<name>/spec.md, .nax/specs/*.md, or a user-provided path) and diffs changed code against the repo's default branch. Checks compliance (every AC/story covered?), drift (does the implementation match the spec's approach, API shape, and constraints?), and integration (does the changed code actually work against the unchanged collaborators it calls into?). Reads unchanged callees when the diff depends on them. Prints severity-graded findings to the terminal with a single verdict. Use after completing a feature implementation to verify it matches the spec before merging.
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

## Step 4: Map external touchpoints (read the unchanged collaborators)

**Do this before judging anything.** Most real defects in a focused diff live on the boundary between the changed code and the *unchanged* code it calls into — and that unchanged code is, by definition, not in the diff. A diff-only read cannot see them.

From the filtered diff, build a list of **external touchpoints** — every symbol the changed code *uses* but does not *define* in the diff:

- **Callees:** functions/methods the new lines call whose body lives in an unchanged file (e.g. `strategy_instance.get_references(...)`, `provider.cache.get_ohlcv(...)`).
- **Polymorphic / interface calls:** any call dispatched through a base class, protocol, or registry. The diff sees one signature; the real behaviour is in *every concrete implementation*. Enumerate them.
- **New or changed arguments to existing APIs:** a value the diff now passes that the callee didn't receive before — especially empty/sentinel/`None`/`{}`/`[]` values, or a newly-shaped object. Verify the callee tolerates it.
- **Consumers of changed outputs:** unchanged code that reads a field, sentinel, or return value whose meaning the diff altered.
- **Collaborators named in the spec:** if the spec asserts a cross-cutting goal ("every built-in strategy works", "all callers", "each adapter"), that goal is a claim *about unchanged code*. You must open those files to verify it — the diff alone can never prove it.

For each touchpoint, **read the actual definition(s)** with Read/Grep and check the changed code's assumption holds for *all* of them, not just the convenient case. Use Grep to find every implementation of an overridden method before concluding it's safe.

Examples of assumptions that only break in unchanged code:
- The diff calls `iface.method(emptyValue)`; one concrete implementation immediately indexes a required key → runtime `KeyError`/`NullPointerException` for that case.
- The diff sets a sentinel to `{}` instead of `None`; a downstream guard checks `is None`, so `{}` slips through and produces a misleading error or silent NaN.
- The spec says "works for every strategy"; the diff only added tests for static/test-double strategies, leaving the dynamic real ones unverified.

Treat an untested cross-cutting claim as **unverified, not satisfied** — surface it as a finding rather than assuming coverage.

## Step 5: Analysis

With the full spec content, the filtered diff, **and the collaborator code you read in Step 4** in context, perform the analysis covering three dimensions:

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

**Integration — does the changed code actually work against the unchanged collaborators?** (uses the Step 4 touchpoints)
For each external touchpoint, check whether the changed code's assumptions hold for *every* real implementation/consumer:
- Will any concrete callee raise (KeyError, NPE, ValueError, panic) for an input the diff now passes — especially empty/sentinel/`None`/`[]`/`{}` values?
- Does any sentinel or output the diff changed reach a downstream guard that interprets it the wrong way (`{}` slipping past an `is None` check; `[]` treated as "provided")?
- Does the spec's cross-cutting claim ("every X works") actually hold for the real, non-test-double implementations — and is each one exercised by a test? An untested real path is a finding, not a pass.
- Are there edge inputs the new tool/endpoint schema now permits (e.g. an explicitly empty array) that route into a broken branch?

Classify each finding using this severity table:

| Severity | Meaning |
|:---------|:--------|
| CRITICAL | AC entirely missing; implementation directly contradicts a hard spec requirement; or the changed code raises/crashes at runtime for a case the spec requires to work |
| HIGH | Significant drift (wrong API shape, missing constraint, wrong architectural approach); or an integration defect that breaks a real collaborator the spec depends on (e.g. a built-in implementation that hits a runtime error on the new call path) |
| MEDIUM | Partial coverage — AC present but incomplete; minor drift affecting correctness; or an integration gap reachable through a now-permitted input (e.g. empty-array regression) |
| LOW | Minor naming deviation, style mismatch, or non-blocking gap |

## Step 6: Print findings

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

[HIGH] Integration: new call path breaks an unchanged collaborator
  Problem: get_indicators() calls strategy_instance.get_references(pd.DataFrame());
           Leadership.get_references() reads info["sector"] → KeyError on the empty frame.
           Spec goal "every built-in strategy works" is unmet and untested (only test doubles covered).
  Fix: Pass real company info (or guard empty frames) before calling get_references; add a test over the dynamic built-ins

[MEDIUM] AC-7: Partial — refresh token logic incomplete
  Problem: JWT_REFRESH_EXPIRES_IN env var referenced but never validated at startup
  Fix: Add env validation in src/config/env.ts

[LOW] Naming: route prefix uses /auth instead of /authentication as spec describes
  Problem: Spec says "mount under /authentication"; implementation uses /auth
  Fix: Rename prefix in src/auth/auth.module.ts (or note intentional deviation)

────────────────────────────────────────
VERDICT: 1 critical · 2 high · 1 medium · 1 low
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
