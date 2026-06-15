---
name: nax-finish
description: Finalize a completed nax feature through to an opened MR/PR. Resolves the feature's spec source from .nax/features/<name>/spec.md, .nax/specs/, docs/specs/, or the prd.json fallback (asks the user if none resolves), and short-circuits if the branch is already merged. Reads the nax config (root plus per-package .nax/mono/<pkg>/config.json) for the repo's real quality commands (build/typecheck/lint/test) and acceptance command, drives the changed feature's acceptance tests to green first (feature-scoped), dispatches a subagent to run the post-impl-review skill and triages the returned findings with the user, fixes approved findings, runs the repo-root quality gates to green, then — on explicit approval — detects GitHub vs GitLab, fills any PR/MR template, summarizes the spec as the body, and opens it with gh/glab. Use after a nax run implements a feature and you want to review, verify, and ship it — triggers include "finish this nax feature", "wrap up the nax run", "/nax-finish <feature>".
---

# nax-finish

Finalize a completed nax feature: prove the changed feature's acceptance tests pass, review the implementation, fix what the user approves, prove the repo-root quality gates are green, and — only on explicit approval — open a PR/MR whose body summarizes the spec. This skill **orchestrates**; it delegates the actual review to a subagent running the `post-impl-review` skill (read-only, isolated context — only the findings come back) and runs the repo's own configured commands rather than inventing any.

**Order rationale:** the cheap, deterministic acceptance gate runs **before** the expensive LLM review — a feature that fails its own spec contract shouldn't consume a full review + triage. Review then scrutinizes working code (including whether each green test is actually sound). The heavy repo-root quality gate runs **last**, once, after all review fixes are in, so it isn't re-invalidated and re-run.

**Announce at start:** "Using nax-finish to finalize `<feature>`: config → acceptance → review → fix → quality → PR/MR."

Work through the steps in order. **Each gate is blocking** — do not advance to the next step while the current one is red, unless the user explicitly tells you to proceed. Track the steps with TodoWrite so the user can see where the run is.

## Step 1: Resolve the feature and the spec source

`args` is the text typed after `/nax-finish`. `/nax-finish graphify-kb` gives `args = "graphify-kb"`; `/nax-finish` alone gives `args = ""`.

Establish two things: **`featureName`** (the `.nax/features/<name>` directory the work belongs to) and a **spec source** — the best available description of intended behaviour. A spec source is one of:
- **markdown spec** (preferred) — a human-authored `.md`, consumable directly by `post-impl-review`.
- **PRD** (`prd.json`) — the structured stories+ACs nax generated from the spec. It is **always** present for a completed feature and is a valid requirements source when no markdown spec persists. (In practice most nax feature dirs keep only `prd.json`; the authored `.md` lives under `docs/specs/` or was a transient input to `nax plan`. Do not assume `spec.md` exists.)

**If `args` is an explicit path** (starts with `./`, `/`, or ends in `.md`): use it as the markdown spec. If it doesn't exist, print `Error: spec not found at <path>` and stop.

**Otherwise treat `args` as a feature name** (if empty, pick the feature first — see below), set `featureName`, and search for a spec source in this order — use the first that exists:
1. `.nax/features/<name>/spec.md` — markdown
2. `.nax/specs/<name>.md` — markdown
3. `docs/specs/SPEC-<name>.md`, else the first match of `docs/specs/*<name>*.md` — markdown (nax repos commonly keep the authored spec here)
4. `.nax/features/<name>/prd.json` — PRD fallback

```bash
ls .nax/features/<name>/spec.md .nax/specs/<name>.md docs/specs/SPEC-<name>.md 2>/dev/null
ls docs/specs/*<name>*.md 2>/dev/null
ls .nax/features/<name>/prd.json 2>/dev/null
```

**If `args` is empty**, discover candidate features first, then resolve the chosen one's spec source via the ordered search above:
```bash
find .nax/features -maxdepth 2 -name prd.json 2>/dev/null   # completed features
find .nax/features -maxdepth 2 -name spec.md 2>/dev/null
```
- Exactly one feature → use it. Multiple → list them numbered and ask the user to pick; wait for the answer.

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

Record for later steps:
- **`featureName`** — the `.nax/features/<name>` dir name (drives acceptance scoping in Step 3). If only a raw path was given with no matching feature dir, ask which feature dir it maps to when Step 3 needs it.
- **`specSource`** — `{ kind: "markdown" | "prd", path }`.

Read the spec source in full — the `.md` body, or the `prd.json` stories+ACs. If a markdown spec exists but is empty, print `Error: spec file is empty at <path>` and stop. Print `Feature: <featureName>` and `Spec: <path> (<kind>)`.

**Preflight — is there anything to finish?** Detect the base branch (`git remote show origin | grep 'HEAD branch'`; fallback `origin/main`, then `origin/master`) and count commits ahead of it:
```bash
git rev-list --count <base>..HEAD 2>/dev/null
```
If `0`, the branch has nothing beyond base — the feature is already merged and there is nothing to review or ship. Print:
```
<featureName> is 0 commits ahead of <base> — already merged / nothing to finish.
```
and stop, unless the user explicitly tells you to proceed anyway. This fails fast on the same condition `post-impl-review` would hit at its empty-diff guard (Step 4), before spending Step 2's config read and Step 3's acceptance run.

## Step 2: Understand the nax config (quality + acceptance commands)

Before running anything, learn what *this* repo runs. Never hardcode `bun test` / `npm run lint` / etc. — read them from config.

**Find repoRoot:** the directory containing `.nax/`. Usually the cwd; if `.nax/` isn't in cwd, walk up until you find it. If there is no `.nax/` directory, print `Error: no .nax/ directory found — is this a nax repo? Run nax-setup first.` and stop.

**Read root config:**
```bash
cat .nax/config.json 2>/dev/null
```
Extract:
- `quality.commands` → `build`, `typecheck`, `lint`, `test` (the **unscoped** variants — Step 6 runs the whole repo, not a scoped subset). Also note `quality.requireTypecheck` / `requireLint` / `requireTests` (default `true`) — a gate whose `require*` flag is `false` or whose command is unset is **skipped**, not failed.
- `acceptance.enabled` (default `true`), `acceptance.command` (optional explicit runner, may contain a `{{FILE}}` placeholder), `acceptance.testPath` (default filename, e.g. `.nax-acceptance.test.ts`).
- `project.language` if present (drives the acceptance test-file extension).
- `project.type` if present — `"monorepo"` is the **authoritative** monorepo signal; trust it over any directory probe.

**Detect monorepo:** treat the repo as a monorepo if **either** `project.type === "monorepo"` **or** any per-package config exists. Per-package configs mirror the workspace tree and can be nested arbitrarily deep (`.nax/mono/packages/core/config.json`, `.nax/mono/apps/api/config.json`), so use a recursive `find`, **not** a fixed-depth glob:
```bash
# ✅ recursive — matches nested .nax/mono/<group>/<pkg>/config.json
find .nax/mono -name config.json 2>/dev/null
# ❌ WRONG — `ls .nax/mono/*/config.json` only sees one level and silently
#    misses .nax/mono/packages/* and .nax/mono/apps/*, mis-detecting single-package
```
Each match's directory (relative to `.nax/mono/`) is a `packageDir` — e.g. `.nax/mono/packages/core/config.json` → `packageDir = packages/core`. For **acceptance** (Step 3) a package's config may override `acceptance.testPath`/`command` — honour the per-package value for that package. For **repo-root quality** (Step 6) you still run the **root** `quality.commands` only; in a well-configured monorepo those delegate to the orchestrator (turbo/nx/workspace script) and cover every package. Do **not** loop over per-package quality commands here — the user asked specifically for the repo-root gates.

Print a one-line config summary so the user can sanity-check it, e.g.:
```
Config: single-package · quality: build,typecheck,lint,test · acceptance: enabled (.nax-acceptance.test.ts)
```
or
```
Config: monorepo (6 pkgs, project.type=monorepo) · root quality: typecheck,lint,test,format (build unset) · acceptance: enabled
```
If a gate the user expects is missing (e.g. no `test` command at all), say so plainly — don't silently skip it.

## Step 3: Acceptance tests green (changed feature only) — fail-fast gate

Run this **before** the review: it's the cheap, deterministic proof that the feature meets its own spec contract. If it can't pass its own acceptance tests, stop here rather than burning a full review + triage.

If `acceptance.enabled` is `false`, print `Acceptance disabled in config — skipping.` and go to Step 4.

**Scope to the feature being finished — not the whole acceptance suite.** Resolve the feature's acceptance test file(s):

- Single-package: `.nax/features/<featureName>/<acceptance.testPath>` — the nax convention places the generated acceptance test inside the feature directory, with the extension matching `project.language` (e.g. `.nax-acceptance.test.ts` for TS, `…test.py` for Python).
- Monorepo: the feature's stories may span **multiple packages**, and nax writes a **per-package feature directory** — the acceptance test lives at `<packageDir>/.nax/features/<featureName>/<acceptance.testPath>`, **not** in the root `.nax/features/<featureName>/` (the root dir holds only `spec.md` / `prd.json` / `acceptance-*.json` — no test file). The same feature name therefore appears under each package that contributes to it. **Discover every package the feature touches** with a recursive search rather than guessing — don't assume it lives in one place:
  ```bash
  # Find every per-package acceptance test for this feature (testPath from config; default _nax_acceptance_test.py / .nax-acceptance.test.ts)
  find . -path "*/.nax/features/<featureName>/<acceptance.testPath>" -not -path '*/node_modules/*' 2>/dev/null
  ```
  Run **each** match, honouring that package's `.nax/mono/<packageDir>/config.json` `acceptance.command`/`testPath` override. A feature spanning `packages/core`, `packages/backtester`, and `apps/api` yields three test files — all three must pass.
- If you cannot locate an acceptance test file for the feature, list where you looked (root feature dir **and** the recursive per-package search above) and ask the user for the path (or whether acceptance was generated at all) — do not silently skip.

**Run them:**
- If `acceptance.command` is set, use it (substitute the resolved file for `{{FILE}}` if the placeholder is present).
- Otherwise run the repo's test runner against the resolved file(s). Use `quality.commands.test`'s runner where it's a per-file-capable runner; otherwise the language-native runner (e.g. `bun test <file>`, `pytest <file>`, `go test <pkg>`). Match the runner to the file's language, never assume `bun`.

The run must be **green**. If it fails:
1. Show the failure output.
2. Treat it as a real defect in the changed feature. Propose a fix, apply it **with user approval** (the same approval discipline as Step 5), and re-run.
3. Loop until green. Do not advance while acceptance is red unless the user explicitly waives it.

Print `Acceptance: PASS (<feature> — N tests)` when green.

## Step 4: Run post-impl-review (in a subagent)

Now that the feature passes its own contract, review the working code. **Delegate the review to a subagent** rather than running it inline: post-impl-review is read-only (it prints findings and writes no file), and it is the most context-hungry step — Step 4b makes it read the full diff *plus* every unchanged collaborator the diff calls into *plus* all project rule files. Running it inline would pull all that raw material into the nax-finish context and leave it there through triage, fixing, the quality gates, and PR composition. A subagent reads it in an isolated context and returns only the structured findings + verdict — exactly what Step 5 triage needs. Read-only review in the subagent, gated fixing in the main thread (Step 5).

**Dispatch one `general-purpose` agent** (via the Agent/Task tool) and instruct it to invoke the **`post-impl-review`** skill (bundled in the same nax-toolkit) with the **resolved `specSource.path`** — not the bare feature name — otherwise post-impl-review repeats the same `spec.md` lookup that already failed in Step 1 for most features. Pass it:
- The spec path: `specSource.kind === "markdown"` → tell it to run `post-impl-review <path>`; `specSource.kind === "prd"` → run `post-impl-review <path-to-prd.json>` and note that the requirements source is the PRD's structured stories/ACs, not a prose spec (post-impl-review already supports structured/inferred requirement sources).
- An instruction to follow post-impl-review exactly (diff against the base branch, all five dimensions, the 80% confidence threshold, the verdict labels) and to **return the full findings report verbatim as its final message** — that report is the only thing that comes back, so it must be complete.

The agent re-derives the base branch and diff itself, so it needs nothing beyond the spec path.

**Do not fan out one review per package on a monorepo.** post-impl-review is deliberately holistic — its Integration dimension catches defects on the boundary *between* packages. Splitting it per-package would lose exactly that cross-package signal. One review subagent over the whole diff, always.

When the subagent returns, **relay its verdict and findings to the user verbatim** — this is the report. Hold the findings list for Step 5.

Note that review adds signal even on a green feature: `post-impl-review` checks whether each *covering test is actually sound* (tautological or order-dependent tests make a green run meaningless), so don't treat Step 3's pass as making the review redundant.

If the subagent reports that post-impl-review stopped with its own error (no diff, no base branch, etc.), surface that error and stop; there is nothing to finalize.

## Step 5: Triage findings and fix with approval

Present the findings grouped by severity. Then:

- **Recommend** a fix for every CRITICAL and HIGH finding, and for MEDIUM findings where the fix is clear and low-risk. State LOW findings but don't push fixes for them.
- **Apply nothing without explicit user approval.** Propose the concrete change (file + edit) and wait for the user to approve, modify, or skip each one (batching related fixes is fine — just make the set explicit). The user may legitimately accept a finding as-is (e.g. an intentional deviation) — record that and move on.
- After applying approved fixes, **re-run post-impl-review by dispatching a fresh `general-purpose` subagent** (same as Step 4) to confirm the fixes landed and introduced no new CRITICAL/HIGH findings. A fresh subagent re-derives the diff from scratch and keeps the main context clean across loop iterations. Loop until the verdict is `ALIGNED`, or the user explicitly accepts the remaining findings and tells you to proceed.
- **Re-run the feature's acceptance tests (Step 3) whenever a fix changed code.** A review fix can break the contract Step 3 proved; the acceptance run is cheap and feature-scoped, so re-verify it green before moving on. If no code changed (all findings waived), skip the re-run.

Do not advance to Step 6 while a CRITICAL or HIGH finding is open and unaddressed, or while acceptance is red, unless the user explicitly waives it. Note any waived findings — they belong in the PR/MR body later.

## Step 6: Repo-root quality gates green

Run the **repo-root** quality commands — every gate that is configured *and* required — from `repoRoot`, regardless of whether the repo is single-package or a monorepo:

For each of `build`, `typecheck`, `lint`, `test`, `format` (skip `build` if unset; skip `typecheck`/`lint`/`test` when its `require*` flag is `false` or its command is unset; run `format` — the check variant, e.g. `ruff format --check` — whenever `quality.commands.format` is set, since nax enforces it as a quality gate):
```bash
<the exact command string from quality.commands.<gate>>
```
Run the **unscoped** commands (the full repo), not the `*Scoped` variants — this is the final whole-repo gate. Use the **check** command (`format`), never the mutating `formatFix`/`lintFix`, in the gate; only reach for the `*Fix` variant as a proposed fix under user approval. Capture each exit code.

Every run must be **green (exit 0)**. If any gate fails:
1. Show the failing output.
2. Propose fixes and apply them **with user approval**.
3. Re-run that gate (and any gate the fix could affect). Loop until all configured gates pass. Do not advance while any gate is red unless the user explicitly waives it.

Print a gate summary:
```
Quality (repo root):
  typecheck  PASS
  lint       PASS
  test       PASS
  format     PASS
  build      (skipped — not configured)
```

## Step 7: Open the MR/PR (only on explicit approval)

Now everything is green. Prepare the PR/MR, show it to the user, and open it **only after the user explicitly approves**.

### 7a. Detect platform and base branch

```bash
git remote get-url origin 2>/dev/null
```
- Contains `github.com` → GitHub, use `gh`.
- Contains `gitlab` (any host) → GitLab, use `glab`.
- Neither / no remote → print the assembled title + body and stop with: "No GitHub/GitLab remote detected — here's the PR body; open it manually."

Detect the base branch the same way post-impl-review does (`git remote show origin | grep 'HEAD branch'`, fallback `origin/main` then `origin/master`).

Verify the CLI is available and authenticated (`gh auth status` / `glab auth status`). If not, fall back to printing the command + body for the user to run.

### 7b. Ensure a pushable branch

```bash
git rev-parse --abbrev-ref HEAD
```
If the current branch **is** the base/default branch, do **not** push to it. Tell the user, propose a branch name derived from the feature (e.g. `feat/<featureName>`), and create it **with approval** before continuing.

**Reconcile the working tree before pushing — mandatory.** A PR/MR ships only what is committed; any modified-but-unstaged or **untracked** file silently stays out of it, and the PR then omits part of the feature. Uncommitted state arrives from **two** distinct sources, and you must account for both:
1. **Left behind by the nax run** — nax's auto-commit can miss newly-created files, leaving them untracked before nax-finish even starts.
2. **Created by nax-finish itself** — the fixes you applied while driving the gates green (Step 3 acceptance fixes, Step 5 review fixes, Step 6 quality fixes) are edits in the working tree that are easy to apply and then forget to commit. **This is the most common cause:** the agent fixes a finding, the gate goes green, and the change is never committed — so the PR ships the *unfixed* code.

So before `git push`, always inspect the **full** working-tree state — never assume your own fixes were committed:
```bash
git status --porcelain   # lists BOTH modified (` M`) and untracked (`??`) paths
```
If the output is non-empty, surface every entry (including untracked files — group them so the user sees what is new vs modified) and ask how to handle them: commit them (with an appropriate conventional-commit message; `git add -A` to capture untracked files too), or stop. **Never auto-commit without approval, and never push while `git status --porcelain` is non-empty unless the user explicitly tells you to leave those files out.** Then push the branch:
```bash
git push -u origin <branch>
```
so the remote has the commits.

### 7c. Find a template

- GitHub: check `.github/PULL_REQUEST_TEMPLATE.md`, `.github/pull_request_template.md`, `docs/PULL_REQUEST_TEMPLATE.md`, and any file under `.github/PULL_REQUEST_TEMPLATE/`.
- GitLab: check `.gitlab/merge_request_templates/*.md`.

If a template exists, fill its sections rather than imposing your own structure. If several GitLab templates exist, ask which to use. If none exists, use a clean default: **Summary**, **What changed**, **Test plan**, **Review notes**.

### 7d. Compose the body from the spec

Summarize the **spec** as the body — this is the point of the step:
- **Summary:** the feature's goal in 1–3 sentences, drawn from the spec's intent.
- **What changed:** the key stories/ACs delivered (from the spec), aligned with the actual diff stat.
- **Test plan:** the acceptance result from Step 3 and the repo-root quality gates from Step 6 (list them as checked).
- **Review notes:** the post-impl-review verdict, plus any findings the user explicitly waived in Step 5 (call them out honestly — don't bury accepted deviations).

Keep it accurate to what actually happened — do not claim gates passed that you skipped, and do not invent ACs the spec doesn't contain.

### 7e. Show, then open on approval

Print the full title + body + target branch. Ask the user to approve, edit, or cancel. **Only after explicit approval**, open it:
```bash
# GitHub
gh pr create --base <base> --head <branch> --title "<title>" --body "<body>"
# GitLab
glab mr create --target-branch <base> --source-branch <branch> --title "<title>" --description "<body>"
```
Print the resulting URL. If the user edits, revise and re-confirm before opening. If the user cancels, stop and leave the branch pushed so they can open it themselves.

## Final summary

Close with a one-line verdict the user can scan:
```
nax-finish: <feature> — acceptance PASS · review ALIGNED · quality PASS · MR opened: <url>
```
If any gate was waived by the user, say so explicitly in the summary rather than implying a clean pass.

## Common mistakes

| Mistake | Do instead |
|:--------|:-----------|
| Hardcoding `bun test` / `npm run lint` | Read `quality.commands.*` and `acceptance.command` from config (Step 2) |
| Running the whole acceptance suite | Scope to the changed feature's acceptance file(s) (Step 3) |
| Detecting monorepo with `ls .nax/mono/*/config.json` | Use `find .nax/mono -name config.json` (configs nest deeper) and trust `project.type: "monorepo"` (Step 2) |
| Looking for the acceptance test only in the root `.nax/features/<name>/` on a monorepo | It lives per-package at `<packageDir>/.nax/features/<name>/<testPath>`; `find -path '*/.nax/features/<name>/<testPath>'` to get all of them (Step 3) |
| Applying acceptance/review/quality fixes but never committing them — PR ships the unfixed code | Treat Step 7b as the reconciliation point: `git status --porcelain` before push catches both nax-leftover and your-own-uncommitted fixes; commit (with approval) or explicitly leave out (Step 7b) |
| Reviewing before the feature passes its own tests | Acceptance is the fail-fast gate — run it before review (Steps 3 → 4) |
| Running post-impl-review inline, or fanning out one review per package | Dispatch a single `general-purpose` subagent over the whole diff — read-only, isolated context, holistic integration findings (Step 4) |
| Looping per-package quality in a monorepo | Run the **root** `quality.commands` once — they fan out via the orchestrator (Step 6) |
| Applying review/fix changes without asking | Every fix needs explicit user approval (Steps 3, 5, 6) |
| Not re-checking acceptance after a review fix | A fix can break the contract — re-run the feature's acceptance tests (Step 5) |
| Opening the PR/MR automatically | Show body, open **only** on explicit approval (Step 7e) |
| Pushing to `main`/`master` | Branch first (Step 7b) |
| Claiming a clean pass after waiving a finding | State waived findings in the body and final summary |
| Advancing past a red gate | Each gate is blocking unless the user explicitly waives it |
