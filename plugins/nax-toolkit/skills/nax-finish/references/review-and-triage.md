# Review and triage (Steps 4-5 detail)

Read this in the normal and escalated-resume modes, after Step 3 is green. Workflow-draft and ready-audit modes do not use it: they triage the workflow's open items instead (`resume-from-workflow-draft.md`).

## Step 4: Review the implementation — spec phase first (phased by default)

> **Resume mode (Step 1b).** The escalated artifact already holds the review output — findings with full `problem` and `fix` prose — so **skip this step's derivation for the escalated phase**. Surface those findings verbatim (severity, title, problem, fix), state which phase escalated and how many fix rounds preceded it (`rounds[]`, which is **absent** when none ran), and carry them into Step 5 as that phase's findings. Do not re-invoke `post-impl-review` to re-derive what you already have. The other, non-escalated phase is not re-run up front either — Step 5's verification ladder re-reviews whatever your fixes actually reach. Everything else proceeds normally.


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

**Phase 1 — spec findings (from Step 4's `--phase spec` run).** Triage the spec-relative findings (Compliance, Drift, Integration, Convention) per the discipline above, getting acceptance green again after any fix. **Resolve or get the user to waive every CRITICAL/HIGH before running the quality phase** — stabilizing the diff first is the entire point of phasing; a quality review on code you're about to rewrite for spec reasons is wasted.

**Phase 2 — quality review on the stabilized diff.** Once the spec fixes are in and acceptance is green, invoke `post-impl-review --phase quality <path>` (same resolved spec path — only used for the header; the quality worker doesn't read it) to review code-quality against the now-stable diff. Surface its verdict + findings verbatim, then triage them per the same discipline.

> **Collapsed run (tiny diff).** If Step 4 collapsed to a single `--phase full` pass, there is no separate quality phase — you already triaged the merged spec+quality findings once under the discipline above. Skip Phase 2.

Do not advance to Step 6 while a CRITICAL or HIGH finding is open and unaddressed in either phase, or while acceptance is red, unless the user explicitly waives it. Note any waived findings — they belong in the PR/MR body later.

## Common mistakes

| Mistake | Do instead |
|:--------|:-----------|
| Reviewing before the feature passes its own tests | Acceptance is the fail-fast gate — run it before review (Steps 3 → 4) |
| Running code-quality review before the spec drift is fixed | Review is phased: `--phase spec` → fix the drift → `--phase quality` on the stabilized diff, so quality never judges code about to be rewritten (Steps 4–5) |
| Dispatching the review subagent yourself, or fanning out one review per package | Just invoke the `post-impl-review` skill — it owns its dispatch and runs one isolated subagent over the whole diff (holistic integration findings); don't wrap it in your own Task call (Step 4) |
| Scheduling a wakeup / polling / sleeping to "wait" for the review worker | The review call returns its findings inline; if the runtime backgrounds the worker, await its completion notification instead. Never call a wait/wakeup/poll/sleep tool to wait (that path errors, e.g. a wakeup with no prompt) (Step 4) |
| Not re-checking acceptance after a review fix | A fix can break the contract — re-run the feature's acceptance tests (Step 5) |
| Re-running the full post-impl-review phase after every small fix | Scale verification to the fix: skip for waived/LOW-only, one targeted subagent for bounded fixes, full same-phase re-run only for broad/structural changes (Step 5) |
