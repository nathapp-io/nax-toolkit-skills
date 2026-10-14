---
name: nax-finish
description: Finalize a completed nax feature through to an opened MR/PR, or resume one that nax left unfinished: an escalated finish phase, or a workflow-mode draft PR. Resolves the feature spec (spec.md, .nax/specs/, docs/specs/, or prd.json fallback) and short-circuits if already merged. Reads the nax config for the repo's real quality and acceptance commands, drives acceptance tests green, runs post-impl-review in two phases (spec, then code-quality) in isolated subagents, triages findings with the user, runs the repo-root quality gates green, then opens a PR/MR with gh/glab or promotes a draft, only on explicit approval. For an escalated finish it loads findings from the finish-audit artifact; for a workflow draft it builds the open-items list from the workflow result, clears each item, and promotes the draft. Both record the rulings. Triggers: "finish this nax feature", "nax-finish escalated", "nax-finish workflow draft", "/nax-finish <feature>".
---

# nax-finish

Finalize a completed nax feature: prove the changed feature's acceptance tests pass, review the implementation, fix what the user approves, prove the repo-root quality gates are green, and — only on explicit approval — open a PR/MR whose body summarizes the spec. This skill **orchestrates**; it delegates the actual review to the `post-impl-review` skill — which owns its own dispatch and runs the review in an isolated, read-only subagent, so only the findings come back — and runs the repo's own configured commands rather than inventing any.

**Order rationale:** the cheap, deterministic acceptance gate runs **before** the expensive LLM review — a feature that fails its own spec contract shouldn't consume a full review + triage. Review itself is **phased**: spec-relative review runs **first**, its drift is fixed, and only then does code-quality review run — against the now-stabilized diff, so the open-ended quality pass never judges code the spec-fixes are about to rewrite (and you never burn a triage round on throwaway lines). The heavy repo-root quality gate runs **last**, once, after all review fixes are in, so it isn't re-invalidated and re-run.

**Announce at start:** "Using nax-finish to finalize `<feature>`: config → acceptance → spec-review → fix → quality-review → fix → quality-gates → PR/MR." In resume mode (Step 1b), announce instead: "Using nax-finish to resume the escalated finish of `<feature>`: acceptance → triage <n> escalated finding(s) → fix → quality-gates → PR/MR." In workflow-draft mode (Step 1c), announce instead: "Using nax-finish to take the workflow draft of `<feature>` to ready: acceptance (if enabled) → clear <n> open item(s) → fix → quality-gates → promote draft."

Work through the steps in order. **Each gate is blocking** — do not advance to the next step while the current one is red, unless the user explicitly tells you to proceed. Track the steps with TodoWrite so the user can see where the run is.

## Step 1: Resolve the feature and the spec source

`args` is the text typed after `/nax-finish`. `/nax-finish graphify-kb` gives `args = "graphify-kb"`; `/nax-finish` alone gives `args = ""`.

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

nax's **workflow mode** runs per-story review and fix rounds, then one branch review, one branch fix and one re-review, and publishes the PR/MR as a **draft** whenever anything needs a human, or as **ready** when nothing deterministic holds it back and the advisor approves (the `finish-approval` decision). Nothing in nax takes a draft to ready, and nothing re-checks an advisor-approved ready PR. This skill does both: it resumes on outcome `draft` (workflow-draft mode) and audits outcome `ready` (ready-audit mode).

Like Step 1b, this needs the resolved `featureName`. Find the newest workflow run directory (newest by mtime, or latest `featureWorkflow.startedAt`) and read its `result.json`:

```bash
ls -td .nax/features/<featureName>/workflow/*/ 2>/dev/null | head -1
```

- **No directory, unreadable, or no `featureWorkflow`** → say nothing and continue normally at Step 2. This is the ordinary case: only a workflow-mode run writes these files.
- **`featureWorkflow.outcome` is `ready`** (written as `opened` by older nax) → the PR/MR is already ready, but "ready" is often an advisor's call (nax asks the advisor for approval when nothing deterministic holds the PR back). Run in **ready-audit mode**: the same open-items list minus promotion. Verify every advisor decision, the readiness approval included; verify the ledger cannot-verify lines; and read the PR's live CI checks. Nothing open → report it clean, with the evidence, and stop. Something open → triage it like a draft item, push fixes to the same PR, and record it as below. For a blocking item, **offer** to convert the PR back to draft (`gh pr ready --undo` / `glab mr update <iid> --draft`) while it is fixed, then re-promote. Never flip it without the user's approval.
- **`local-only`** (no forge, push failed, or `workflow.publish: none`) or **`pushed`** (`workflow.publish: push`; branch pushed, no PR) — `skipped` on older nax → continue normally; Step 7 offers to open one.
- **`draft`** → print `featureWorkflow.reasons` and the open items (built per the reference), confirm with the user that they are still live (they may have fixed some by hand since), and on confirmation run in **workflow-draft mode**: Steps 3-8 adjust as marked below, and Step 8 becomes required.

**Ready-audit mode** follows the workflow-draft markers below for Steps 3, 4, 5, 6 and 8, and skips only the promotion in 7f/7g. So acceptance (Step 3) and the repo-root gates (Step 6) still run. A **blocking item** in ready-audit mode is a red required CI check, an advisor decision whose premise turned out false, or a CRITICAL/HIGH finding; only those make the skill offer to convert the PR back to draft.

If Step 1b also found an escalated finish-audit artifact, ask the user which one they mean to resume; do not merge them.

**Read `references/resume-from-workflow-draft.md` before acting on an artifact** — it owns artifact discovery, the field-by-field result contract (and how to fail soft on older nax), how the open-items list is built, how each kind of item is handled, and the decisions sidecar.

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

Run this **before** the review: it's the cheap, deterministic proof that the feature meets its own spec contract. If it can't pass its own acceptance tests, stop here rather than burning a full review + triage.

**Scope to the feature being finished — not the whole acceptance suite.** Step 1's `nax features resolve … --json` already resolved the acceptance targets deterministically — it carries an **`acceptance` block** computed from the same SSOT (`groupStoriesByPackage`) the nax runtime uses to place and run these tests, so you do **not** re-derive paths by hand. The block has shape:

```jsonc
"acceptance": {
  "status": "ok" | "disabled" | "no-prd",
  "enabled": true,                 // effective acceptance.enabled
  "groups": [                      // one entry per package the feature touches
    { "packageDir": "apps/api",    // "" for the root package; repo-root-relative
      "testPath": "apps/api/.nax/features/<feature>/.nax-acceptance.test.ts",  // canonical, repo-root-relative
      "exists": true,              // is the test file present on disk?
      "command": "npx jest … {{FILE}}",  // resolved per-package override else root; may be absent
      "language": "typescript" }
  ]
}
```

> **⚠️ The group's fields are in two different reference frames — and the JSON has no `cwd` field.**
> `packageDir`/`testPath` are **repo-root-relative**, but `command` comes verbatim from that package's `.nax/mono/<packageDir>/config.json` and is authored **package-relative** — e.g. `bun vitest run --config .nax/vitest.acceptance.config.ts {{FILE}}`, where `.nax/…` means `<packageDir>/.nax/…`, **not** the root `.nax/`. So pasting `command` with the root-relative `testPath` and running it from `repoRoot` does **not** reproduce what nax does.
>
> **This fails per-group, not uniformly — and usually only for the minority. That is the trap.** Groups that inherit the **root** `command` with no package-relative paths and no package-local runner (e.g. `uv run pytest {{FILE}}`) pass from `repoRoot` — so a feature spanning six packages can go **5-for-5 green** from the wrong cwd, then fail on the single group with a per-package `command` override (`bun vitest --config .nax/…`). Only the overriding group is position-sensitive.
>
> That lopsided score is what makes this misdiagnose so reliably: by the time the odd group fails, the root cwd has been "confirmed" five times, so the error reads as *"this package's test/config is missing"* rather than *"I'm in the wrong directory."* **Green from `repoRoot` is not evidence the approach is right — the passing groups are the ones that can't detect the mistake.** The nax runtime spawns **every** group with `cwd = <repoRoot>/<packageDir>` and an **absolute** `{{FILE}}`; **Run them** mirrors that exactly. Reproduce the runtime uniformly — never generalize from whichever groups happened to pass.

> **Workflow-draft mode (Step 1c).** Workflow mode turns acceptance off for its own run (the run log says `execution.mode "workflow" overrides: acceptance.enabled=false`), but `nax features resolve` reports the **project** config, so it can say `enabled: true` for a feature whose run never generated a test. Honour it this way:
> - `enabled: false` → print `Acceptance disabled in config — skipping.` and move on.
> - `enabled: true` → run every group whose `exists` is `true`, as below (the tree has changed since the workflow's gates).
> - A group with `exists: false` is **expected** here, not a defect: print `Acceptance not generated in workflow mode — skipping <testPath>.` and proceed. Do not stop to ask, and never generate or invent an acceptance test.
>
> Report a skipped group in the final summary as `acceptance skipped (not generated by workflow)`, never as a pass.

Branch on `acceptance.status`:
- **`disabled`** → print `Acceptance disabled in config — skipping.` and go to Step 4.
- **`no-prd`** → no `prd.json` resolved for the feature; acceptance targets can't be computed. List the feature dir checked and ask the user for the acceptance test path (or whether acceptance was generated at all) — do not silently skip.
- **`ok`** → run **each** group whose `exists` is `true`, per **Run them** below. A feature spanning `apps/api` + `apps/web` yields two groups — **all** existing groups must pass, and each runs in **its own** `packageDir` with **its own** `command`/`language` (the two groups routinely use different runners: `uv run pytest` in `apps/api`, `bun vitest` in `apps/web`). If a group has `exists: false`, its test file was expected (canonical path) but never generated — surface that to the user rather than skipping silently (except in workflow-draft and ready-audit modes, where it is expected; see the note below).

> **Fallback (older nax — no `acceptance` block in the resolve output).** If the Step 1 output lacks an `acceptance` field (older nax `features resolve`, or you used the manual Step 1 fallback), resolve the acceptance target(s) by hand per the **Step 3 fallback** in `references/older-nax-fallback.md` — it covers the single-package path, the per-package monorepo search, and the not-found prompt. Then run them as below.

**Run them:** for **each** group, reproduce what the nax runtime does — two rules, both mandatory:

1. **cwd = `<repoRoot>/<packageDir>`** (`packageDir: ""` → `repoRoot`, the root package's legitimate cwd). Never run a group with a **non-empty** `packageDir` from `repoRoot`.
2. **`{{FILE}}` = the absolute path** `<repoRoot>/<testPath>`.

```bash
# Set repoRoot once (Step 2 already located it), then per group:
#   packageDir="apps/web"  testPath="apps/web/.nax/features/<f>/.nax-acceptance.test.tsx"
repoRoot="$(pwd)"   # or the dir containing .nax/ — must be absolute and non-empty
( cd "$repoRoot/apps/web" && bun vitest run --config .nax/vitest.acceptance.config.ts \
    "$repoRoot/apps/web/.nax/features/<f>/.nax-acceptance.test.tsx" )
```
- If the group's `command` is set, use it, substituting the absolute file for `{{FILE}}` (nax also accepts `{{file}}`/`{{files}}`) — otherwise run it **as-is**; its relative paths are already correct once cwd is the package dir. Don't "fix" a `--config .nax/…` path by prefixing `packageDir` — that breaks it.
- If `command` is absent, use `quality.commands.test`'s runner **for that group's package** where it's per-file-capable; otherwise the language-native runner matched to the group's `language` (`bun test <file>`, `uv run pytest <file>`, `go test <pkg>`). Never assume `bun`, and never infer the runner from the **root** `project.language` — on a monorepo it often differs from the package's (a root `project.language: "python"` alongside a TypeScript `apps/web` is common). Trust the group's own `language`.

**A resolution error is NOT a missing test and NOT a pass.** With the wrong cwd these commands fail in ways that read like the test or config is absent — every one of these means *you ran it from the wrong directory*, so fix the cwd and re-run rather than reporting the file doesn't exist, "fixing" the config, or skipping the group:

| Symptom | Real cause |
|---|---|
| `No test files found` (vitest/jest) | The `{{FILE}}` filter matched nothing: a root-relative path (`apps/web/.nax/…`) can't match under a package cwd, where the file is `.nax/…`. Pass the **absolute** path. |
| `Script not found "vitest"` / `command not found` | Ran from `repoRoot`; the runner is a **package** dependency, not a root one |
| `Cannot find … .nax/vitest.acceptance.config.ts` / `config not exist` | Ran from `repoRoot`, so the command's package-relative `.nax/` resolved against the **root** `.nax/`. The config really does live at `<packageDir>/.nax/` |
| `file or directory not found: <testPath>` (pytest) | Root-relative `{{FILE}}` passed under a package cwd — pass the **absolute** path |

If a group's test file genuinely doesn't exist, the resolve output already says `exists: false` — trust that field over any runner error. When in doubt, confirm with `ls "$repoRoot/<testPath>"` before claiming it's missing.

The run must be **green** for every group. If it fails:
1. Show the failure output.
2. **First rule out the cwd/path errors above** — a resolution failure is a harness mistake, not a defect; fix it and re-run before touching any code.
3. Otherwise treat it as a real defect in the changed feature. Propose a fix, apply it **with user approval** (the same approval discipline as Step 5), and re-run.
4. Loop until green. Do not advance while acceptance is red unless the user explicitly waives it.

Print `Acceptance: PASS (<feature> — N tests)` when green.

## Step 4: Review the implementation — spec phase first (phased by default)

> **Resume mode (Step 1b).** The escalated artifact already holds the review output — findings with full `problem` and `fix` prose — so **skip this step's derivation for the escalated phase**. Surface those findings verbatim (severity, title, problem, fix), state which phase escalated and how many fix rounds preceded it (`rounds[]`, which is **absent** when none ran), and carry them into Step 5 as that phase's findings. Do not re-invoke `post-impl-review` to re-derive what you already have. The other, non-escalated phase is not re-run up front either — Step 5's verification ladder re-reviews whatever your fixes actually reach. Everything else proceeds normally.

> **Workflow-draft mode (Step 1c).** The workflow already ran story reviews, a branch review and a re-review, so **do not run a full `post-impl-review` by default**. Load the open items from the reference's list, surface them verbatim (id, severity, `file:line`, issue, suggestion, and any ruling joined to them), and carry them into Step 5. After fixes land, offer an optional **targeted review of the fix diff only** (see the reference); never run the phased review unprompted.

Now that the feature passes its own contract, review the working code. nax-finish drives `post-impl-review` in **two phases by default**: spec-relative review first (Step 4 → spec triage in Step 5), then — after the spec drift is fixed — code-quality review on the **now-stabilized** diff (the quality phase in Step 5). Reviewing quality last means the open-ended quality pass never judges code the spec-fixes are about to rewrite, and you never burn a triage round on throwaway lines. **post-impl-review owns the phasing** via its `--phase` flag; nax-finish only decides *whether* to phase.

**Decide phased vs. collapsed (this run).** Default to **phased** — a typical nax feature spans several stories and hundreds of lines, which is real spec-review surface where drift is plausible and reviewing quality on the *stabilized* diff pays off. Measure the changed diff first (you don't have a stat yet — the preflight only counted commits):
```bash
git diff <base>...HEAD --stat    # ignore .nax/, lockfiles, and generated output when reading the counts
```
Collapse to a single `--phase full` pass **only** when the change is genuinely trivial and single-concern — **≤ ~3 files and ≤ ~150 lines** after that noise — where meaningful spec drift across stories is implausible and a second phase's extra diff-fetch + triage round isn't worth it (a hotfix, a one-file tweak, a doc/config touch-up). In the collapsed case run one `post-impl-review <path>` (no flag), triage its merged findings once in Step 5, and skip the separate quality phase. Otherwise — the normal multi-story case — proceed phased, below.

**Invoke the spec phase.** Invoke the `post-impl-review` skill with `--phase spec` and the **resolved `specSource.path`** — not the bare feature name — otherwise post-impl-review repeats the same `spec.md` lookup that already failed in Step 1 for most features:
- `specSource.kind === "markdown"` → invoke `post-impl-review --phase spec <path>`.
- `specSource.kind === "prd"` → invoke `post-impl-review --phase spec <path-to-prd.json>`; the requirements source is the PRD's structured stories/ACs, not a prose spec (post-impl-review already supports structured/inferred requirement sources).

**Do not dispatch a subagent yourself.** post-impl-review owns its own dispatch (its Step 0): it resolves the spec path in your context, then runs the actual review in isolated worker subagent(s) over the whole diff and returns only the structured findings + verdict. In the spec phase that is a single SPEC worker covering Compliance, Drift, Integration, and Convention. That keeps the context-hungry part (the full diff plus every unchanged collaborator and rule file it reads) out of the nax-finish context through triage, fixing, the quality gates, and PR composition — you get back just what Step 5 triage needs. It is also deliberately holistic (one review over the whole diff, never per-package), so its Integration dimension still catches defects on the boundary *between* packages on a monorepo.

When post-impl-review returns, its report is already the relayed verdict + findings. **Surface it to the user verbatim** and hold the findings list for Step 5.

Note that review adds signal even on a green feature: the spec phase checks whether each *covering test is actually sound* (tautological or order-dependent tests make a green run meaningless), so don't treat Step 3's pass as making the review redundant.

If post-impl-review stops with its own error (no diff, no base branch, etc.), surface that error and stop; there is nothing to finalize.

## Step 5: Triage and fix — spec phase, then quality phase

Triage runs **once per review phase**. Present each phase's findings grouped by severity and apply the **same discipline** to both:

- **Recommend** a fix for every CRITICAL and HIGH finding, and for MEDIUM findings where the fix is clear and low-risk. State LOW findings but don't push fixes for them.
- **Apply nothing without explicit user approval.** Propose the concrete change (file + edit) and wait for the user to approve, modify, or skip each one (batching related fixes is fine — just make the set explicit). The user may legitimately accept a finding as-is (e.g. an intentional deviation) — record that and move on.
- After applying approved fixes, **verify they landed and introduced no new CRITICAL/HIGH findings** — but scale the verification to the fix, don't reflexively re-run the whole phase. A full phase re-run is fresh worker(s) re-deriving the *entire* diff from scratch; running that after every small fix batch is the single largest source of nax-finish's token cost. Pick the cheapest sufficient check:
  - **No code changed** (every finding waived) → **skip verification entirely.** Nothing to re-check.
  - **Only LOW findings were addressed**, with trivial localized edits, and Step 6's quality gates will run anyway → **skip the re-review**; the gates (and a quick read of the edits) are sufficient. Don't spend a review pass to confirm a renamed variable.
  - **CRITICAL/HIGH/MEDIUM fixes touching a bounded set of files** → run **one targeted verification subagent** (a single `general-purpose` Agent/Task call, not a full phase re-run): give it the list of findings you fixed and the files the fixes touched, and ask it to confirm each finding is resolved and that those files introduced no new CRITICAL/HIGH issue. This re-reads only the touched surface, not the whole diff.
  - **Broad or structural fixes** (many files, a changed architecture/API, or new integration surface a localized check can't see across) → re-invoke the **same phase** of `post-impl-review` (`--phase spec`, `--phase quality`, or no flag for a collapsed `full` run) over the whole diff; only here is the whole-diff, cross-cutting re-review worth its cost.
  Each subagent (targeted or full) runs in fresh context and keeps the main context clean across loop iterations. Loop until no CRITICAL/HIGH remains in the phase, or the user explicitly accepts the remaining findings and tells you to proceed.
- **Re-run the feature's acceptance tests (Step 3) whenever a fix changed code.** A review fix can break the contract Step 3 proved; the acceptance run is cheap and feature-scoped, so re-verify it green before moving on. If no code changed (all findings waived), skip the re-run.

> **Workflow-draft mode (Step 1c).** Triage the open items instead of phases:
> - findings like below (add the test the suggestion names);
> - **advisor decisions** — every one, flagged or trusted — with each decision's factual premise **verified against the code** before it is confirmed (a `defer` is not resolved);
> - red gates made green;
> - **red CI checks** fixed from their logs;
> - cannot-verify items actually verified with evidence.
>
> Fixes need explicit user approval, as above. Skip the two-phase flow; the reference has the per-kind handling.

**Phase 1 — spec findings (from Step 4's `--phase spec` run).** Triage the spec-relative findings (Compliance, Drift, Integration, Convention) per the discipline above, getting acceptance green again after any fix. **Resolve or get the user to waive every CRITICAL/HIGH before running the quality phase** — stabilizing the diff first is the entire point of phasing; a quality review on code you're about to rewrite for spec reasons is wasted.

**Phase 2 — quality review on the stabilized diff.** Once the spec fixes are in and acceptance is green, invoke `post-impl-review --phase quality <path>` (same resolved spec path — only used for the header; the quality worker doesn't read it) to review code-quality against the now-stable diff. Surface its verdict + findings verbatim, then triage them per the same discipline.

> **Collapsed run (tiny diff).** If Step 4 collapsed to a single `--phase full` pass, there is no separate quality phase — you already triaged the merged spec+quality findings once under the discipline above. Skip Phase 2.

Do not advance to Step 6 while a CRITICAL or HIGH finding is open and unaddressed in either phase, or while acceptance is red, unless the user explicitly waives it. Note any waived findings — they belong in the PR/MR body later.

## Step 6: Repo-root quality gates green

Run the **repo-root** quality commands — every gate that is configured *and* required — from `repoRoot`, regardless of whether the repo is single-package or a monorepo. In workflow-draft mode this is required: the tree changed after the workflow's final gates.


For each of `build`, `typecheck`, `lint`, `test` — skipping any whose command is unset, which is the only way a gate is off — matching the gate order nax's own finish phase runs:
```bash
<the exact command string from quality.commands.<gate>>
```
Run the **unscoped** commands (the full repo), not the `*Scoped` variants — this is the final whole-repo gate. **Never run `formatFix`/`formatFixScoped`/`lintFix` as a gate**: they mutate files, so a green from one proves only that it rewrote the tree. They are proposed fixes, applied under user approval, after which the real gate re-runs. There is no `format` key in nax's `quality.commands` schema, and unknown keys are stripped rather than rejected, so a `format` entry in a config is silently ignored by nax itself — do not resurrect it as a gate here. Capture each exit code.

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

Now everything is green. Prepare the PR/MR, then either **open a new one** or **promote the existing draft to ready** — **only after the user explicitly approves**. nax's **autoPR** may already have opened a PR/MR for the branch (draft or ready) during the run, so this step **detects first** and never blindly creates.

**Full mechanics live in `references/open-pr-mr.md`** — read it now and follow it. It covers, in order: 7a detect platform (`gh`/`glab`) + base branch, 7b ensure a pushable branch and reconcile the working tree (`git status --porcelain` before push — catches both nax-leftover and your-own-uncommitted fixes; never push dirty or to `main` without approval), 7c find a PR/MR template, 7d compose the body from the **spec**, 7e **detect whether a PR/MR already exists for the branch** and branch on it, 7f create a new one on approval (only when none exists), 7g promote an existing **draft → ready** on approval (leaving its autoPR body intact by default; a body refresh is offered, not forced). If a PR/MR already exists **and is already ready**, report its URL and stop — nothing to open. Leave the branch pushed if the user cancels.

> **Workflow-draft mode (Step 1c).** The PR/MR already exists as a draft, so go straight to 7g on explicit approval (use `featureWorkflow.url` when present, else 7e detection). Record what was cleared in two places, both on explicit approval, after the fixes are pushed and CI is green:
> - **Tick the body checklist.** Edit only the generated "Before marking ready" lines, matched by the exact `**<id>**` token nax rendered (`verdict.openItems[].id`): `- [ ] **<id>** …` → `- [x] **<id>** …`, with ` — fixed in <sha>` / ` — verified` / ` — confirmed` / ` — waived: <reason>` appended to that first line. Never rewrite any other part of the body; the reference has the exact line shape.
> - **Post one evidence comment** (`## Resolved before ready`): one line per item with its disposition and evidence (commit sha, test command and result, CI run link), mirroring the decisions sidecar. Items nax never listed in the body (`ci`, trusted advisor decisions, re-review leftovers) appear only here.
>
> In ready-audit mode (Step 1c, outcome `ready`) there is no checklist, so post the comment only, headed `## Verified after ready`. If any item is still unresolved and unwaived, do not promote. **The PR's checks must be green on the head you pushed before 7g runs** (the reference's `ci` item): wait for them after your push, and never promote over a red required check unless the user explicitly waives it by name.

## Step 8: Record the resume decisions (resume modes only — required)

Skip this step entirely on an ordinary run; it applies only when Step 1b or Step 1c entered a resume mode.

Write a sidecar beside the artifact you resumed from, recording how each escalated finding was ruled on:
```
<outputDir>/finish-audit/<featureName>/<runId>.decisions-<timestamp>.json
```
One entry per finding in the artifact — **every** finding, waivers included — each with a one-line `reason`, plus the resume's `outcome`. **Shape and field rules live in `references/resume-from-escalation.md`**; follow it rather than improvising the JSON.

**Workflow-draft mode (Step 1c).** Write the sidecar beside the result instead: `.nax/features/<featureName>/workflow/<runId>/decisions-<timestamp>.json` — one entry per open item (id, `kind` `finding`/`advisor`/`gate`/`ci`/`story`/`cannot-verify`, disposition `fixed`/`waived`/`confirmed`/`overridden`/`verified`, one-line reason, commit sha when fixed), plus `outcome` (`promoted`, `verified-ready` or `abandoned`) and `url`. Ready-audit mode writes the same file. Shape lives in `references/resume-from-workflow-draft.md`. It is a repo-local `.nax` file: run `git check-ignore` on it, tell the user where it is, and do not commit it unless the repo tracks that directory.

Write it as soon as triage is done and any fixes are committed. **Do not defer it past Step 7** — if the user abandons the PR at the approval gate, the judgments they just made are still worth keeping: write the sidecar with `outcome: "abandoned"` and no `url`. This file is the only record that a human ever ruled on these findings; nothing in nax writes it, and an unwritten one cannot be reconstructed.

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
| Re-deriving the review when an escalated artifact already holds the findings | Check for one after Step 1; on `status: "escalated"` load its findings and triage those (Steps 1b, 4) |
| Treating a missing finish-audit artifact as an error | Only nax's finish phase writes one — no artifact is the ordinary case; continue normally (Step 1b) |
| Resuming from an artifact whose status isn't `escalated` | Gate strictly on `escalated`; `opened`/`promoted`/`already-ready` are finished runs (Step 1b) |
| Skipping acceptance or the quality gates because the finish phase already ran them | It ran them against a tree that has since changed — both re-run in resume mode (Steps 3, 6) |
| Finishing a resume without writing the decisions sidecar | It is the only record of the human ruling — write it even when the PR is abandoned (Step 8) |
| Promoting a workflow draft without clearing its open items | The draft means something needs a human; promote only when every item is fixed, verified, confirmed, or explicitly waived (Step 1c) |
| Re-running a full post-impl-review on a workflow draft | The workflow already reviewed; load the open items and offer only a targeted review of the fix diff (Steps 4-5) |
| Treating a `defer` ruling as resolved | `defer` points at a step that has already passed; get the user to fix it, accept the risk, or file it elsewhere (Step 5) |
| Skipping cannot-verify ledger items | Run the named tests or read the code and report evidence; waive only with a stated reason (Step 5) |
| Overwriting the generated PR body when promoting a workflow draft | Tick only the resolved checklist lines; put the evidence in one PR comment (Step 7) |
| Treating a workflow outcome of `ready` as finished | Ready is often an advisor's approval; run the ready audit (decisions, cannot-verify, live CI) and report clean only with evidence (Step 1c) |
| Hand-resolving the spec with `ls`/`find` when `nax features resolve` exists | Run `nax features resolve "<args>" --json` and branch on `status`; only hand-resolve via the documented Fallback when the command is unavailable on older nax (Step 1) |
| Hardcoding `bun test` / `npm run lint` | Read `quality.commands.*` and `acceptance.command` from config (Step 2) |
| Running the whole acceptance suite | Scope to the changed feature's acceptance file(s) (Step 3) |
| Detecting monorepo with `ls .nax/mono/*/config.json` | Use `find .nax/mono -name config.json` (configs nest deeper) and trust `project.type: "monorepo"` (Step 2) |
| Looking for the acceptance test only in the root `.nax/features/<name>/` on a monorepo | It lives per-package at `<packageDir>/.nax/features/<name>/<testPath>`; `find -path '*/.nax/features/<name>/<testPath>'` to get all of them (Step 3) |
| Running a group's `command` from `repoRoot` | Its paths (`--config .nax/…`) are **package-relative**; spawn with `cwd = <repoRoot>/<packageDir>`, as the nax runtime does (Step 3) |
| Substituting the root-relative `testPath` into `{{FILE}}` | `{{FILE}}` is the **absolute** `<repoRoot>/<testPath>` — root-relative under a package cwd yields `No test files found` (Step 3) |
| Reading `No test files found` / `config not exist` as "no acceptance test" and skipping | That's a wrong-cwd error, not a missing file — trust the group's `exists` field and re-run from `packageDir` (Step 3) |
| Assuming one runner for every group | Each group has its own `language`/`command` — `apps/api` may be `uv run pytest` while `apps/web` is `bun vitest` (Step 3) |
| Applying acceptance/review/quality fixes but never committing them — PR ships the unfixed code | Treat Step 7b as the reconciliation point: `git status --porcelain` before push catches both nax-leftover and your-own-uncommitted fixes; commit (with approval) or explicitly leave out (Step 7b) |
| Reviewing before the feature passes its own tests | Acceptance is the fail-fast gate — run it before review (Steps 3 → 4) |
| Running code-quality review before the spec drift is fixed | Review is phased: `--phase spec` → fix the drift → `--phase quality` on the stabilized diff, so quality never judges code about to be rewritten (Steps 4–5) |
| Dispatching the review subagent yourself, or fanning out one review per package | Just invoke the `post-impl-review` skill — it owns its dispatch and runs one isolated subagent over the whole diff (holistic integration findings); don't wrap it in your own Task call (Step 4) |
| Scheduling a wakeup / polling / sleeping to "wait" for the review worker | The review call returns its findings inline; if the runtime backgrounds the worker, await its completion notification instead. Never call a wait/wakeup/poll/sleep tool to wait (that path errors, e.g. a wakeup with no prompt) (Step 4) |
| Looping per-package quality in a monorepo | Run the **root** `quality.commands` once — they fan out via the orchestrator (Step 6) |
| Applying review/fix changes without asking | Every fix needs explicit user approval (Steps 3, 5, 6) |
| Not re-checking acceptance after a review fix | A fix can break the contract — re-run the feature's acceptance tests (Step 5) |
| Re-running the full post-impl-review phase after every small fix | Scale verification to the fix: skip for waived/LOW-only, one targeted subagent for bounded fixes, full same-phase re-run only for broad/structural changes (Step 5) |
| Opening the PR/MR automatically | Show body, open/promote **only** on explicit approval (Step 7f/7g) |
| Blindly `gh pr create` / `glab mr create` when nax autoPR already opened one | Detect first (7e); create only if none exists, promote draft→ready if a draft exists, report-and-stop if already ready (Step 7e–7g) |
| Overwriting the autoPR body when promoting a draft | Leave the existing body intact by default; offer a spec-body refresh, apply only on explicit approval (Step 7g) |
| Pushing to `main`/`master` | Branch first (Step 7b) |
| Claiming a clean pass after waiving a finding | State waived findings in the body and final summary |
| Advancing past a red gate | Each gate is blocking unless the user explicitly waives it |
| Surfacing only the flagged advisor rulings, or confirming one on the advisor's word | List every decision (`nax advisor list -f <feature> --json`), and verify each one's premise (the cited commit, code or test) before confirming it (Step 1c, reference) |
| Stopping on a missing acceptance test in workflow-draft mode | Workflow mode never generates one; skip that group with a note and proceed (Step 3) |
| Promoting a workflow draft whose CI is red, or whose only reason was `CI failed` | Treat each failing check as a `ci` item: read its log, fix the cause, push, wait for green, then promote (Steps 5, 7) |
