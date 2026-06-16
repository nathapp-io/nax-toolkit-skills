---
name: post-impl-review
description: Post-implementation code review against a feature spec. Reads the spec (.nax/features/<name>/spec.md, .nax/specs/*.md, or a given path) and diffs changed code against the default branch. Checks compliance (every AC/story covered, each covering test sound?), drift (does the implementation match the spec's approach, API shape, and constraints?), integration (does changed code work against the unchanged collaborators it calls into?), convention compliance (does the diff obey CLAUDE.md / .nax/rules / .claude/rules?), and code quality (test isolation, dead code, resource leaks, error handling, concurrency, performance, accessibility, security, design/maintainability) independent of the spec. Reads unchanged callees the diff depends on and loads rule files. Applies a tiered confidence threshold (≥80% spec-relative, ≥60% grounded code-quality) to stay high-signal, and prints severity-graded findings with a single verdict. Use after completing a feature implementation to verify it matches the spec before merging.
---

# Post-Implementation Review

Review changed code against a feature spec across five dimensions: compliance (every AC/story covered, and is each covering test actually sound?), drift (implementation deviates from spec approach, API shape, or constraints), integration (changed code works against the unchanged collaborators it calls into), convention compliance (changed code obeys the project's own rule files), and code quality (spec-independent defects and design/maintainability concerns in the changed lines — test isolation, dead code, resource leaks, error handling, concurrency, performance, accessibility, security, separation of concerns, abstraction quality, misleading names, unhandled edge cases). Report spec-relative findings at ≥80% confidence and code-quality findings at ≥60% when anchored to a changed line with a concrete cost. Print severity-graded findings to the terminal with a unified verdict.

**Announce at start:** "Using post-impl-review to review implementation against `<resolved-spec-path>`."

## Step 0: Dispatch — resolve, fan out two review workers, merge

This skill is the **dispatcher**. Whoever invokes it (a direct `/post-impl-review`, or another skill such as nax-finish invoking it inline) just invokes it and relays its result — they do **not** spawn a subagent themselves. The dispatcher does the cheap shared prep in its own context, then fans the actual review out to **two isolated workers running in parallel**:

- a **SPEC worker** for the spec-relative dimensions (Compliance, Drift, Integration, Convention), and
- a **QUALITY worker** for spec-independent code-quality and design/maintainability.

Splitting them is deliberate: a single agent juggling all five dimensions front-loads the checklist-shaped spec dimensions and treats the open-ended code-quality pass as an afterthought, which is exactly why quality issues slip through. Two workers each get fresh, undivided context, and the QUALITY worker uses the `code-reviewer` agent — a reviewer-tuned system prompt with no spec-compliance work to crowd it out.

**Dispatcher procedure:**

1. **Resolve the spec path** using Step 1's rules, in your own context, so a "multiple specs found" prompt reaches the real user. Stop on any Step 1 error.
2. **Detect the base branch and run the guards** (Steps 2–3) in your own context, using only `--name-only` and `--stat` (NOT the full diff content — keep your context clean). Stop on any base-branch error; print the empty-diff message and stop if nothing reviewable remains. Capture the base branch name and the stat summary for the header. Also run the one cheap rule-file check from Step 4a (`ls CLAUDE.md AGENTS.md 2>/dev/null; find .nax/rules .claude/rules -name "*.md" 2>/dev/null`) — you only need to know *whether any exist*, so you can decide the Convention-skipped header note in step 4; do not read their contents (the SPEC worker does).
3. **Dispatch BOTH workers IN PARALLEL** — one message, two Agent/Task calls. Each reviews the **whole diff**; never fan out per-package (Integration needs cross-package boundaries holistically). Neither worker reads this Step 0 — give each a self-contained prompt:
   - **SPEC worker** — `agentType: general-purpose`. Prompt: *"You are the post-impl-review SPEC worker. Base branch: `origin/<branch>`. Spec: `<resolved-path>`. Read `skills/post-impl-review/SKILL.md` Steps 2–4 and `skills/post-impl-review/references/spec-review.md`, then review the whole `git diff origin/<branch>...HEAD` against the spec across the four spec-relative dimensions (Compliance, Drift, Integration, Convention Compliance) at the ≥80% confidence threshold. Return ONLY your findings as the `[SEVERITY] …` blocks defined in Step 6 (or the literal `No findings.`) — no header, no verdict line."*
   - **QUALITY worker** — `agentType: code-reviewer` (if that agent type is unavailable in this repo, fall back to `general-purpose` — the split's value is the separate, undivided context, not strictly the agent's system prompt). Prompt: *"You are the post-impl-review QUALITY worker. Base branch: `origin/<branch>`. Read `skills/post-impl-review/SKILL.md` Steps 2–3 (for the diff) and 4b (collaborators you may need to judge a defect — skip 4a, conventions are the SPEC worker's job) and `skills/post-impl-review/references/code-quality.md`, then review the whole `git diff origin/<branch>...HEAD` for spec-independent defects and design/maintainability concerns. Do NOT read the spec — code quality only. Run the per-function enumeration forcing function and apply the ≥60% confidence threshold, anchoring each finding to a changed line with a concrete cost. Return ONLY your findings as the `[SEVERITY] …` blocks defined in Step 6 (or the literal `No findings.`) — no header, no verdict line."*
4. **Merge and print** (Step 6): combine both workers' findings, dedupe the cross-worker overlap, sort, and print the header + unified findings + single verdict. Relay it verbatim to the caller. If a worker fails outright, note it in the header and continue with the other's findings rather than aborting the whole review.

Neither the `general-purpose` SPEC worker nor the `code-reviewer` QUALITY worker re-invokes this skill, and the `code-reviewer` agent cannot dispatch further subagents — so there is no recursion to guard against. (The dispatcher must therefore run in a context that *can* spawn subagents — i.e. the caller's main context, which is how `/post-impl-review` and nax-finish both invoke it.)

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

> **Workers:** the dispatcher already gave you the base branch — skip detection and use it. Run only the `git diff origin/<branch>...HEAD` commands below to get the diff content. (The dispatcher itself runs the detection and the `--name-only`/`--stat` guards.)

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

Run **only the dimension group assigned to your worker role** (Step 0). Each group is defined in full in its reference file; read your file and apply it against the filtered diff, the collaborator code you read in Step 4b, and (SPEC worker) the spec plus the project rules from Step 4a.

- **SPEC worker — read `references/spec-review.md` and apply it in full:** Compliance (every AC/story covered, each covering test sound), Drift (implementation matches the spec's approach, API shape, constraints, naming), Integration (the changed code works against every real implementation/consumer of the Step 4b touchpoints), and Convention Compliance (the diff obeys the in-scope directives from the rules loaded in Step 4a). Apply the **≥80% confidence threshold** defined there. If Step 4a found no rule files, skip Convention Compliance.
- **QUALITY worker — read `references/code-quality.md` and apply it in full:** spec-independent defects and design/maintainability concerns in the changed lines (test isolation, dead/redundant code, resource leaks, error handling, concurrency, performance, accessibility, security, and open-ended design/maintainability). Run its per-function enumeration forcing function, and apply the **≥60% confidence threshold** defined there — anchored to a changed line with a concrete cost. Do not over-suppress this tier to hit an arbitrary count.

**No double-counting (handled at merge):** a test-isolation defect can surface in both workers — the QUALITY worker as a test-isolation finding, the SPEC worker as an AC downgraded to Partial. The dispatcher dedupes these into one finding at merge time (Step 6); a worker reports what it sees within its own group.

Classify each finding using this severity table:

| Severity | Meaning |
|:---------|:--------|
| CRITICAL | AC entirely missing; implementation directly contradicts a hard spec requirement; the changed code raises/crashes at runtime for a case the spec requires to work; or a security defect the diff introduces (hardcoded secret, injection sink) |
| HIGH | Significant drift (wrong API shape, missing constraint, wrong architectural approach); an integration defect that breaks a real collaborator the spec depends on (e.g. a built-in implementation that hits a runtime error on the new call path); or a violation of a project rule explicitly marked as required/forbidden (a banned API, a hard-blocked pattern) |
| MEDIUM | Partial coverage — AC present but incomplete; minor drift affecting correctness; an integration gap reachable through a now-permitted input (e.g. empty-array regression); a test-isolation defect that can cause false positives or flakiness under reordering/parallelism; a resource leak; a swallowed error on a real path; a concurrency/race or performance regression the diff introduces; or an accessibility defect on a new interactive UI element |
| LOW | Minor naming deviation, style mismatch, dead/redundant/duplicated code, unused locals, a soft convention deviation, or other non-blocking gap |

## Step 6: Findings — worker output and dispatcher merge

**If you are a worker** (SPEC or QUALITY): return **only your findings**, nothing else. Emit each as a `[SEVERITY] …` block in the format below — no `Spec:`/`Base:` header, no `FINDINGS` divider, no `VERDICT` line (the dispatcher adds those). If you found nothing in your group, return the literal line `No findings.` as your entire final message. That message is the only thing that travels back to the dispatcher.

**If you are the dispatcher:** collect both workers' findings and merge them into one report printed to the terminal (do not write any file):

1. **Normalise each worker's output:** a worker that returned the literal `No findings.` contributes an **empty** finding set — drop that sentinel, do not carry it into the merged list. Then **concatenate** the remaining SPEC and QUALITY findings.
2. **Dedupe the cross-worker overlap:** when a SPEC finding and a QUALITY finding describe the *same defect on the same line* (typically a test-isolation issue the QUALITY worker flagged and the SPEC worker also counted as an AC downgraded to Partial), keep **one** finding — prefer the version that names both the defect and the AC consequence. Findings in different files or about different defects are never merged.
3. **Sort:** CRITICAL first, then HIGH, then MEDIUM, then LOW.
4. **Header:** print the `Spec:` and `Base:` lines from the prep you ran in Step 0. If the Step 0 rule-file check found none, append `(No project rule files found — Convention Compliance skipped)`. If a worker failed outright, append `(<SPEC|QUALITY> worker failed — partial review)` and continue with the other's findings.
5. **Verdict:** count findings by severity across the merged set and print the verdict line + label. If the merged set is empty (both workers returned `No findings.`), print the no-findings report shown at the end of this step.

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
