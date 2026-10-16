---
name: nax-finish
description: Finalize a completed nax feature through to an opened MR/PR, or resume one that nax left unfinished: an escalated finish phase, or a workflow-mode draft PR. Resolves the feature spec (spec.md, .nax/specs/, docs/specs/, or prd.json fallback) and short-circuits if already merged. Reads the nax config for the repo's real quality and acceptance commands, drives acceptance tests green, runs post-impl-review in two phases (spec, then code-quality) in isolated subagents, triages findings with the user, runs the repo-root quality gates green, then opens a PR/MR with gh/glab or promotes a draft, only on explicit approval. For an escalated finish it loads findings from the finish-audit artifact; for a workflow draft it builds the open-items list from the workflow result, clears each item, and promotes the draft. Both record the rulings. Triggers: "finish this nax feature", "nax-finish escalated", "nax-finish workflow draft", "/nax-finish <feature>".
---

# nax-finish

Finalize a completed nax feature: prove the changed feature's acceptance tests pass, review the implementation, fix what the user approves, prove the repo-root quality gates are green, and — only on explicit approval — open a PR/MR whose body summarizes the spec. This skill **orchestrates**; it delegates the actual review to the `post-impl-review` skill — which owns its own dispatch and runs the review in an isolated, read-only subagent, so only the findings come back — and runs the repo's own configured commands rather than inventing any.

**Order rationale:** the cheap, deterministic acceptance gate runs **before** the expensive LLM review — a feature that fails its own spec contract shouldn't consume a full review + triage. Review itself is **phased**: spec-relative review runs **first**, its drift is fixed, and only then does code-quality review run — against the now-stabilized diff, so the open-ended quality pass never judges code the spec-fixes are about to rewrite (and you never burn a triage round on throwaway lines). The heavy repo-root quality gate runs **last**, once, after all review fixes are in, so it isn't re-invalidated and re-run.

**Announce at start:** "Using nax-finish to finalize `<feature>`: config → acceptance → spec-review → fix → quality-review → fix → quality-gates → PR/MR." In resume mode (Step 1b), announce instead: "Using nax-finish to resume the escalated finish of `<feature>`: acceptance → triage <n> escalated finding(s) → fix → quality-gates → PR/MR." In workflow-draft mode (Step 1c), announce instead: "Using nax-finish to take the workflow draft of `<feature>` to ready: acceptance (if enabled) → clear <n> open item(s) → fix → quality-gates → promote draft."

Work through the steps in order. **Each gate is blocking** — do not advance to the next step while the current one is red, unless the user explicitly tells you to proceed. When the harness has a todo tool, track the steps with it so the user can see where the run is.

**Where each part lives.** This file holds what every mode shares; the references hold the detail. **Opening a reference is the first action of the step that names it**: open it before you run anything in that step, and before you answer any question about that step, a dry run or plan included. Do not work from this file's summary, or from memory of an earlier read.

| Reference | Read when |
|:--|:--|
| `references/resume-from-escalation.md` | Step 1b finds an `escalated` finish-audit artifact |
| `references/resume-from-workflow-draft.md` | Step 1c finds a workflow result with outcome `draft` or `ready`; it also holds the workflow-mode changes to Steps 3-8 |
| `references/acceptance.md` | Step 3 has an acceptance group to run |
| `references/review-and-triage.md` | Steps 4-5 in the normal and escalated modes |
| `references/open-pr-mr.md` | Step 7, every run |
| `references/older-nax-fallback.md` | `nax features resolve` is unavailable, or its output has no `acceptance` block |

## Step 1: Resolve the feature and the spec source

`args` is the text typed after `/nax-finish`. `/nax-finish graphify-kb` gives `args = "graphify-kb"`; `/nax-finish` alone gives `args = ""`. When `args` is free text rather than a feature name, pass the token that names a `.nax/features/<name>` dir. When it names only a PR/MR (a number or URL), find the feature whose `.nax/features/*/workflow/*/result.json` has that `featureWorkflow.url`; if none matches, ask.

Establish two things: **`featureName`** (the `.nax/features/<name>` directory the work belongs to) and a **spec source** — the best available description of intended behaviour. A spec source is one of:
- **markdown spec** (preferred) — a human-authored `.md`, consumable directly by `post-impl-review`.
- **PRD** (`prd.json`) — the structured stories+ACs nax generated from the spec. It is **always** present for a completed feature and is a valid requirements source when no markdown spec persists. (In practice most nax feature dirs keep only `prd.json`; the authored `.md` lives under `docs/specs/` or was a transient input to `nax plan`. Do not assume `spec.md` exists.)

**Resolve deterministically via the nax CLI** — this is the single source of truth (`post-impl-review` uses the same command, so the two never disagree). Run:
```bash
nax features resolve "<args>" --json    # <args> may be empty
```
The command emits a JSON object on stdout with a `status` (and `featureName`, `specSource {kind,path}`, `acceptance {status,enabled,groups}` (on an `ok` result with a known feature — consumed in Step 3), `candidates`, `checked`, `message` as applicable). Branch on `status`:
- **`ok`** → record `featureName` and `specSource = { kind, path }` from the output. Proceed.
- **`ambiguous`** → list `candidates` numbered, ask the user to pick, then re-run `nax features resolve "<pick>" --json`.
- **`missing`** → show the `checked` paths and ask the user to paste a spec path (or press enter to abort). On a path, re-run `nax features resolve "<path>" --json` (or accept it directly as the markdown spec). Abort only if they decline.
- **`feature-not-found`** → if `candidates` is non-empty, treat like `ambiguous`; otherwise treat like `missing`.
- **`not-a-nax-repo`** → print `Error: no .nax/ directory found — is this a nax repo? Run nax-setup first.` and stop.

**Availability + fallback.** `nax features resolve` is available when its stdout is valid JSON carrying a `status` (exit `0` = `ok`, exit `2` = needs-human — both still emit JSON). It is **unavailable** on an older nax — stdout isn't JSON, or stderr shows `unknown command`. If unavailable, say so once and hand-resolve via the **Step 1 fallback** in `references/older-nax-fallback.md` (it mirrors the CLI's algorithm exactly, so the result is identical), then continue with the same `featureName` / `specSource` you record below.

Record for later steps:
- **`featureName`** — the `.nax/features/<name>` dir name (drives acceptance scoping in Step 3). If only a raw path was given with no matching feature dir, ask which feature dir it maps to when Step 3 needs it.
- **`specSource`** — `{ kind: "markdown" | "prd", path }`.

Read the spec source in full — the `.md` body, or the `prd.json` stories+ACs. If a markdown spec exists but is empty, print `Error: spec file is empty at <path>` and stop. Print `Feature: <featureName>` and `Spec: <path> (<kind>)`. (In workflow-draft and ready-audit modes, Step 1c, the spec is needed only to check a premise against it or to refresh the PR body in 7d; read the parts those need, when they come up.)

**Preflight — is there anything to finish?** Run `git fetch origin` first: every later comparison against the base (this count, an advisor's file inventory, the fix diff) is wrong against a stale local branch. Detect the base branch (`git remote show origin | grep 'HEAD branch'`; fallback `main`, then `master`) and count commits ahead of the **remote** base:
```bash
git rev-list --count origin/<base>..HEAD 2>/dev/null
```
If `0`, the branch has nothing beyond base — the feature is already merged and there is nothing to review or ship. Print:
```
<featureName> is 0 commits ahead of <base> — already merged / nothing to finish.
```
and stop, unless the user explicitly tells you to proceed anyway. This fails fast on the same condition `post-impl-review` would hit at its empty-diff guard (Step 4), before spending Step 2's config read and Step 3's acceptance run.

## Step 1b: Resume an escalated finish phase (only when an artifact exists)

Nax's **finish phase** — the post-run phase it runs in-process after a successful `nax run` — can stop with `status: "escalated"`: it pushed its partial fixes and asked for human judgment, with no way back in. This skill is that way back. Resume **only** on `escalated`; every other status is a finished run. (Older nax ran the same logic as an external flow; the artifacts are identical, so nothing here depends on which produced them.)

This runs after Step 1 because it needs the resolved `featureName` to find the directory. Take the newest `*.result.json` by mtime and read its `status`:

```bash
# <outputDir> defaults to ~/.nax/<projectKey>; see the reference for the override
# and identity cross-check, which you MUST do before trusting the key.
ls -t <outputDir>/finish-audit/<featureName>/*.result.json 2>/dev/null | head -1
```

- **No artifact, unreadable, or `status` is anything but `escalated`** → say nothing and continue normally at Step 2. This is the ordinary case: only nax's finish phase writes these files, so a feature you finished by hand has none.
- **`status: "escalated"`** → print the `escalationReason` and the findings, confirm with the user that these are still live (they may have fixed them by hand since), and on confirmation run in **resume mode**: Step 4 loads findings from the artifact instead of deriving them, and Step 8 becomes required.

**Read `references/resume-from-escalation.md` before acting on an artifact** — it owns artifact discovery (the `outputDir` override, `projectKey` derivation, the `.identity` cross-check, the legacy repo-local path), the full result shape and round outcomes, and the sidecar contract.

## Step 1c: Resume a workflow-mode draft (only when a workflow result exists)

nax's **workflow mode** runs per-story review and fix rounds, then one branch review and up to `workflow.maxBranchFixRounds` (default 2) branch fix and re-review rounds, and publishes the PR/MR as a **draft** whenever anything needs a human, or as **ready** when nothing deterministic holds it back and the advisor approves (the `finish-approval` decision). Nothing in nax takes a draft to ready, and nothing re-checks an advisor-approved ready PR. This skill does both: it resumes on outcome `draft` (workflow-draft mode) and audits outcome `ready` (ready-audit mode).

Like Step 1b, this needs the resolved `featureName`. Find the newest workflow run directory (newest by mtime, or latest `featureWorkflow.startedAt`) and read its `result.json`:

```bash
ls -td .nax/features/<featureName>/workflow/*/ 2>/dev/null | head -1
```

- **No directory, unreadable, or no `featureWorkflow`** → say nothing and continue normally at Step 2. This is the ordinary case: only a workflow-mode run writes these files.
- **`featureWorkflow.outcome` is `ready`** (written as `opened` by older nax) → the PR/MR is already ready, but "ready" is often an advisor's call (nax asks the advisor for approval when nothing deterministic holds the PR back). Run in **ready-audit mode**: the same open-items list minus promotion. Verify every advisor decision, the readiness approval included; verify the ledger cannot-verify lines; and read the PR's live CI checks. Nothing open → report it clean, with the evidence, and stop. Something open → triage it like a draft item, push fixes to the same PR, and record it as below. For a blocking item, **offer** to convert the PR back to draft (`gh pr ready --undo` / `glab mr update <iid> --draft`) while it is fixed, then re-promote. Never flip it without the user's approval.
- **`local-only`** (no forge, push failed, or `workflow.publish: none`) or **`pushed`** (`workflow.publish: push`; branch pushed, no PR) — `skipped` on older nax → continue normally; Step 7 offers to open one.
- **`draft`** → print `featureWorkflow.reasons` and the open items (built per the reference), confirm with the user that they are still live (they may have fixed some by hand since), and on confirmation run in **workflow-draft mode**: Steps 3-8 change as the reference's "Steps 3-8 in workflow modes" section says, and Step 8 becomes required.

**Ready-audit mode** follows the same workflow-mode changes for Steps 3, 4, 5, 6 and 8, and skips only the promotion in 7f/7g. So acceptance (Step 3) and the repo-root gates (Step 6) still run. A **blocking item** in ready-audit mode is a red required CI check, an advisor decision whose premise turned out false, or a CRITICAL/HIGH finding; only those make the skill offer to convert the PR back to draft.

If Step 1b also found an escalated finish-audit artifact, ask the user which one they mean to resume; do not merge them.

**Read `references/resume-from-workflow-draft.md` before acting on an artifact** — it owns artifact discovery, the field-by-field result contract (and how to fail soft on older nax), how the open-items list is built, how each kind of item is handled, the decisions sidecar, and how Steps 3-8 change in workflow modes.

## Step 2: Understand the nax config (quality + acceptance commands)

Before running anything, learn what *this* repo runs. Never hardcode `bun test` / `npm run lint` / etc. — read them from config.

**Find repoRoot:** the directory containing `.nax/`. Usually the cwd; if `.nax/` isn't in cwd, walk up until you find it. If there is no `.nax/` directory, print `Error: no .nax/ directory found — is this a nax repo? Run nax-setup first.` and stop.

**Read root config:**
```bash
cat .nax/config.json 2>/dev/null
```
Extract:
- `quality.commands` → `build`, `typecheck`, `lint`, `test` (the **unscoped** variants — Step 6 runs the whole repo, not a scoped subset). A gate whose command is unset is **skipped**, not failed — an unset command is the only way a gate is off. (`quality.requireTypecheck` / `requireLint` / `requireTests` no longer exist; nax rejects them at parse time, so no config you read will carry one.)
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
Config: monorepo (6 pkgs, project.type=monorepo) · root quality: typecheck,lint,test (build unset) · acceptance: enabled
```
If a gate the user expects is missing (e.g. no `test` command at all), say so plainly — don't silently skip it.

## Step 3: Acceptance tests green (changed feature only) — fail-fast gate

Run this **before** the review: it is the cheap, deterministic proof that the feature meets its own spec contract. Scope it to the feature being finished, using the `acceptance` block Step 1's `nax features resolve` returned. Branch on `acceptance.status`:
- **`disabled`** → print `Acceptance disabled in config — skipping.` and go to Step 4.
- **`no-prd`** → no `prd.json` resolved for the feature; list the feature dir checked and ask the user for the acceptance test path (or whether acceptance was generated at all). Do not silently skip.
- **`ok`** → **open `references/acceptance.md` now and follow it** to run every group whose `exists` is `true`. In workflow modes a group with `exists: false` is expected (the workflow never generates one): skip it with a note, as the workflow reference says.

Two rules from that file hold for every group, because getting them wrong reads like a missing test rather than a wrong directory: run each group with **cwd = `<repoRoot>/<packageDir>`** (the group's `command` is package-relative; never run a group with a non-empty `packageDir` from `repoRoot`), and substitute the **absolute** `<repoRoot>/<testPath>` for `{{FILE}}`. `No test files found`, `Script not found`, or a missing `.nax/…config` means a wrong cwd or path, not a missing test: fix the invocation and re-run.
- **No `acceptance` block** (older nax) → resolve the targets per the Step 3 fallback in `references/older-nax-fallback.md`, then run them per `references/acceptance.md`.

The run must be **green** for every group before Step 4.

## Steps 4-5: Review and triage

- **Normal mode and escalated resume (Step 1b)** → **open `references/review-and-triage.md` now and follow it.** It owns the phased review, the collapsed run for a trivial diff, the resume-mode use of the artifact's findings, and the fix-verification ladder. In outline: invoke the `post-impl-review` skill with `--phase spec <specSource.path>` (never dispatch the review subagent yourself), fix its drift, then `--phase quality`; collapse to one `--phase full` pass only for a diff of about 3 files and 150 lines or less. Verify fixes at the cheapest sufficient level: nothing for waived or LOW-only, one targeted verification subagent for fixes to a bounded set of files, a same-phase re-run only for broad or structural fixes.
- **Workflow-draft and ready-audit modes (Step 1c)** → do not run `post-impl-review`. Triage the open items per `references/resume-from-workflow-draft.md`.

In every mode: apply nothing without explicit user approval, re-run the feature's acceptance tests after any fix that changed code, and do not advance to Step 6 while a CRITICAL or HIGH item is open and unaddressed, or acceptance is red, unless the user explicitly waives it. Note waived findings; they belong in the PR/MR body.

## Step 6: Repo-root quality gates green

Run the **repo-root** quality commands — every gate that is configured *and* required — from `repoRoot`, regardless of whether the repo is single-package or a monorepo. In workflow-draft mode this is required: the tree changed after the workflow's final gates.

For each of `build`, `typecheck`, `lint`, `test` — skipping any whose command is unset, which is the only way a gate is off — matching the gate order nax's own finish phase runs:
```bash
<the exact command string from quality.commands.<gate>>
```
Run the **unscoped** commands (the full repo), not the `*Scoped` variants — this is the final whole-repo gate. **Never run `formatFix`/`formatFixScoped`/`lintFix` as a gate**: they mutate files, so a green from one proves only that it rewrote the tree. They are proposed fixes, applied under user approval, after which the real gate re-runs. There is no `format` key in nax's `quality.commands` schema, and unknown keys are stripped rather than rejected, so a `format` entry in a config is silently ignored by nax itself — do not resurrect it as a gate here. Capture each exit code.

**Run each gate as its own command — one tool call per gate, the command string exactly as configured.** Never loop over the commands in one shell line: zsh does not word-split an unquoted `$cmd`, so every gate "runs" as a single missing command. Exit `127` (command not found) or `126` (not executable) means the gate **did not run** — not a pass, not a defect: fix the invocation and run it again, and never report it as run.

**A formatter is a fix, not a gate step.** When a gate fails on formatting (biome, prettier, gofmt, ruff format), the formatter write (`formatFix`, `lintFix`, `biome format --write`, …) is a proposed fix like any other: list the files it will rewrite, apply it only on explicit approval (or as part of an approved fix batch that named it), then re-run **every** gate — build, typecheck and test as well as the one that failed.

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
  build      (skipped — not configured)
```

## Step 7: Open or promote the MR/PR (only on explicit approval)

Now everything is green. Prepare the PR/MR, then either **open a new one** or **promote the existing draft to ready** — **only after the user explicitly approves**. Ask that approval **once**, as one question. Its options are the actions you can take (for example commit + push + promote, commit + push only, show the diff first) and, when any fix changed runtime behaviour (anything beyond formatting, renames, comments or tests), **a targeted review of the fix diff first** (Step 5's targeted-verification subagent, `references/review-and-triage.md`; in workflow modes, the workflow reference's "Targeted review of the fix diff"). Re-ask only a question that got no answer. nax's **autoPR** may already have opened a PR/MR for the branch (draft or ready) during the run, so this step **detects first** and never blindly creates.

**Full mechanics live in `references/open-pr-mr.md`** — read the file before 7a, every run, even when you know it; do not work 7e–7g from memory. It covers, in order: 7a detect platform (`gh`/`glab`) + base branch, 7b ensure a pushable branch and reconcile the working tree (`git status --porcelain` before push — catches both nax-leftover and your-own-uncommitted fixes; never push dirty or to `main` without approval), 7c find a PR/MR template, 7d compose the body from the **spec**, 7e **detect whether a PR/MR already exists for the branch** and branch on it, 7f create a new one on approval (only when none exists), 7g promote an existing **draft → ready** on approval (leaving its autoPR body intact by default; a body refresh is offered, not forced). If a PR/MR already exists **and is already ready**, report its URL and stop — nothing to open. Leave the branch pushed if the user cancels.

> **Workflow modes (Step 1c).** The PR/MR already exists, so go straight to 7g (promote) on explicit approval. Ticking the body checklist, the evidence comment, the green-checks rule and the never-promote-a-conflicting-PR rule are in `references/resume-from-workflow-draft.md` (Steps 3-8 section and Promotion).

## Step 8: Record the resume decisions (resume modes only — required)

Skip this step entirely on an ordinary run; it applies only when Step 1b or Step 1c entered a resume mode.

Write a sidecar beside the artifact you resumed from, recording how each escalated finding was ruled on:
```
<outputDir>/finish-audit/<featureName>/<runId>.decisions-<timestamp>.json
```
One entry per finding in the artifact — **every** finding, waivers included — each with a one-line `reason`, plus the resume's `outcome`. **Shape and field rules live in `references/resume-from-escalation.md`**; follow it rather than improvising the JSON.

**Workflow modes (Step 1c).** Write the sidecar beside the result instead: `.nax/features/<featureName>/workflow/<runId>/decisions-<timestamp>.json`. Shape and field rules live in `references/resume-from-workflow-draft.md`.

Write it as soon as triage is done and any fixes are committed, with `outcome: "pending"`. **`outcome` records what happened, never what is about to:** rewrite the same file after the step that settles it — after the promote/create call succeeds (`promoted` / `opened`, plus the `url`), after the ready audit ends (`verified-ready`), or when the user stops (`abandoned`, no `url`). **Do not defer the first write past Step 7** — if the user abandons the PR at the approval gate, the judgments they just made are still worth keeping. This file is the only record that a human ever ruled on these findings; nothing in nax writes it, and an unwritten one cannot be reconstructed.

## Final summary

Close with a one-line verdict the user can scan — reflect what actually happened to the PR/MR (opened new, promoted draft→ready, or already ready):
```
nax-finish: <feature> — acceptance PASS · review ALIGNED · quality PASS · MR opened: <url>
nax-finish: <feature> — acceptance PASS · review ALIGNED · quality PASS · MR promoted to ready: <url>
nax-finish: <feature> — acceptance PASS · review ALIGNED · quality PASS · MR already ready: <url>
```
In resume mode, report the escalation's disposition instead of a review verdict, and name the sidecar:
```
nax-finish: <feature> — resumed escalation (3 findings: 1 fixed, 2 waived) · acceptance PASS · quality PASS · MR opened: <url>
  decisions: <outputDir>/finish-audit/<feature>/<runId>.decisions-<timestamp>.json
```
In workflow-draft mode, report the open items' disposition and name the sidecar:
```
nax-finish: <feature> — resumed workflow draft (2 items: 1 fixed, 1 verified) · acceptance skipped (not generated by workflow) · quality PASS · checks green on <sha> · PR promoted to ready: <url>
  decisions: .nax/features/<feature>/workflow/<runId>/decisions-<timestamp>.json
```
In ready-audit mode, report the audit and the head the checks went green on:
```
nax-finish: <feature> — ready audit (4 items: 3 verified, 1 fixed) · acceptance skipped (not generated by workflow) · quality PASS · checks green on <sha> · PR verified ready: <url>
  decisions: .nax/features/<feature>/workflow/<runId>/decisions-<timestamp>.json
```
Use `acceptance PASS (<n> tests)` instead whenever an acceptance group actually ran.
If any gate was waived by the user, say so explicitly in the summary rather than implying a clean pass.

## Common mistakes

| Mistake | Do instead |
|:--------|:-----------|
| Skipping acceptance or the quality gates because the finish phase already ran them | It ran them against a tree that has since changed — both re-run in resume mode (Steps 3, 6) |
| Finishing a resume without writing the decisions sidecar | It is the only record of the human ruling — write it even when the PR is abandoned (Step 8) |
| Hand-resolving the spec with `ls`/`find` when `nax features resolve` exists | Run `nax features resolve "<args>" --json` and branch on `status`; only hand-resolve via the documented Fallback when the command is unavailable on older nax (Step 1) |
| Hardcoding `bun test` / `npm run lint` | Read `quality.commands.*` and `acceptance.command` from config (Step 2) |
| Detecting monorepo with `ls .nax/mono/*/config.json` | Use `find .nax/mono -name config.json` (configs nest deeper) and trust `project.type: "monorepo"` (Step 2) |
| Applying acceptance/review/quality fixes but never committing them — PR ships the unfixed code | Treat Step 7b as the reconciliation point: `git status --porcelain` before push catches both nax-leftover and your-own-uncommitted fixes; commit (with approval) or explicitly leave out (Step 7b) |
| Looping per-package quality in a monorepo | Run the **root** `quality.commands` once — they fan out via the orchestrator (Step 6) |
| Applying review/fix changes without asking | Every fix needs explicit user approval (Steps 3, 5, 6) |
| Opening the PR/MR automatically | Show body, open/promote **only** on explicit approval (Step 7f/7g) |
| Blindly `gh pr create` / `glab mr create` when nax autoPR already opened one | Detect first (7e); create only if none exists, promote draft→ready if a draft exists, report-and-stop if already ready (Step 7e–7g) |
| Overwriting the autoPR body when promoting a draft | Leave the existing body intact by default; offer a spec-body refresh, apply only on explicit approval (Step 7g) |
| Pushing to `main`/`master` | Branch first (Step 7b) |
| Claiming a clean pass after waiving a finding | State waived findings in the body and final summary |
| Advancing past a red gate | Each gate is blocking unless the user explicitly waives it |
| Running the gates in one shell loop and reporting exit 127 as "ran" | One tool call per gate; 127/126 means the gate did not run (Step 6) |
| Running a formatter's `--write` to clear a lint failure without asking | It is a proposed fix: approval first, then re-run every gate (Step 6) |
| Writing the sidecar with the outcome you expect (`promoted`) before it happens | Write `pending`, then rewrite the outcome after the call that settles it (Step 8) |
| Comparing against a local `main` that was never fetched | `git fetch origin` in the preflight; compare against `origin/<base>` or the workflow `seed` (Step 1) |
| Promoting a workflow draft without clearing its open items | The draft means something needs a human; promote only when every item is fixed, verified, confirmed, or explicitly waived (Step 1c) |
