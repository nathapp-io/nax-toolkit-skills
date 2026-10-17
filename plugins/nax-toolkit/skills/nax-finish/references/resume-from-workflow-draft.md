# Resume from a workflow-mode draft (Step 1c detail)

nax's **workflow mode** (config `workflow`, or a profile that enables it) runs, per story, implementer -> gates -> story review -> fix rounds; then, per feature, repo gates -> branch review -> branch fix -> branch re-review (fix and re-review repeat up to `workflow.maxBranchFixRounds`, default 2) -> final gates -> publish. Publish opens the PR/MR as a **draft** whenever anything needs a human, and as **ready** when nothing deterministic holds it back and the advisor approves (the `finish-approval` decision; see Ready-audit mode). Nothing in nax takes a draft to ready on its own: the workflow is single-pass by design, so the human judgment it asked for has nowhere to go. This skill is that path, and it drives it through nax's own commands.

When a draft result exists for the feature, Step 4's review derivation is **already done** (the story reviews, the branch review and the re-review all ran), so resume loads the open items nax recorded instead of paying for a fresh review, and triages them under the skill's normal Step 5 discipline.

## nax version: 0.89 or later

This file is for **nax >= 0.89**, which has `nax workflow status`, `nax workflow record` and `nax workflow promote`. Step 1c's first call tells you which you have: when `nax workflow status -f <feature> --json` prints no JSON, or stderr shows `unknown command`, the nax is older. Say so once, and use **"Workflow draft on nax < 0.89"** in `older-nax-fallback.md` in place of this file's "Reading the run", "Items `openItems` does not hold", "Recording the decisions" and "Promotion" sections. "Handling each kind", the targeted review, ready-audit mode and "Steps 3-8 in workflow modes" below still apply.

Never hand-build what these commands produce: the open-items list, the decisions sidecar, the checklist ticks and the evidence comment. Hand-rebuilt versions of each have broken on real runs.

## Reading the run: `nax workflow status`

From `repoRoot`:

```bash
nax workflow status -f <featureName> --json
```

It reads the newest workflow run's `result.json` (skipping an unreadable one) and writes nothing. Exit codes:

- **`0`**: outcome `ready` and nothing open.
- **`2`**: something needs a human: a draft, open items, or a run that never reached publish.
- **`1`**: error, printed as `{"error": "..."}` on stdout. `no workflow result for feature <feature>` and `workflow for <feature> has not started its feature steps` mean no workflow artifact: say nothing and continue normally at Step 2. Report any other error to the user.

The JSON object:

| Field | Notes |
|:--|:--|
| `runId`, `runDir` | The run you act on; `runDir` is relative to the project. Record `runId`. |
| `step` | `done` on a finished workflow. Anything else means the workflow stopped early; say so. |
| `outcome` | `ready` \| `draft` \| `local-only` \| `pushed`; absent when the run never reached publish (treat as the ordinary case and say the workflow did not publish). |
| `ci` | The CI state **at publish time**: a snapshot. Re-read the live checks before trusting it. |
| `url` | The PR/MR. Absent: fall back to branch detection (Step 7e). |
| `workflowPassed` | Whether nax's own blocking kinds (`finding`, `ruling`, `gate`) are clear. It does not mean ready. |
| `reasons` | Why the PR is a draft, in nax's words. |
| `openItems` | The open items, below. |

**`openItems` is nax's complete list for the run.** Each item is `{ id, kind, severity?, file?, line?, issue, suggestion?, ruling? }`. Its `id` is the `**<id>**` token in the PR body's "Before marking ready" checklist, and the id `nax workflow record` accepts. Kinds:

| Kind | What it is | `id` |
|:--|:--|:--|
| `finding` | A blocking review finding still open (the branch review's, and the re-review's leftovers). A finding whose advisor ruling is a `waive` not flagged for a human is left out; it shows up only as a trusted decision | `B<n>` |
| `ruling` | A finding the advisor ruled on; `ruling` holds the decision | `B<n>` |
| `cannot-verify` | A check the branch review could not make itself | `_run:cv<n>` |
| `gate` | A red final gate | the gate name |
| `advisor` | A held finish-approval, or a decision flagged for a human | the decision id (`D-<n>`), or `_run:approval` |
| `story` | A story that did not finish | the story id |
| `ci` | A CI state that blocked at publish | `_run:ci` |
| `reason` | A draft reason no other item explains | `_run:reason<n>` |

nax already cross-checks `reasons` against the items: a reason it cannot attribute becomes a `reason` item. Do not re-derive that by hand.

**Facts `status` does not print** live in `<runDir>/result.json` (read it with your own file tool; `jq` is optional) when an item needs them:

- `featureWorkflow.seed` (the commit the workflow started from) and `fixBase` (the commit before the branch fix). `fixBase..HEAD` is the branch-fix diff.
- `featureWorkflow.rulings[]`: `{ findingId, action, needsHumanConfirm, source, decisionId, text, why, costIfWrong }`, the full advisor ruling behind a `ruling` item.
- `featureWorkflow.minors[]`: `{ id, storyId, text, triage }`, and `newMinors[]`, plain strings. `leave` minors and `newMinors` are notes: surface the count.
- `branch-rereview.json` beside it: `{ verdicts: [{ id, addressed, note }], newFindings: [...] }`.

## Items `openItems` does not hold

Four kinds of item still come from elsewhere. Add them to the list, labelled as shown:

1. **Trusted advisor decisions.** `nax advisor list -f <feature> --json` lists every decision for the feature, flagged first, including those nax applied without asking (a confident `waive`, a `carry`, pre-flight rulings). Every decision that is not already an `advisor` or `ruling` item is a trusted decision: label it by its id. They shaped the branch without a human seeing them, so they are verified too. In ready-audit mode the approved `finish-approval` decision is one of them.
2. **Story-level cannot-verify lines.** `<runDir>/ledger.md` lines `<storyId>: cannot-verify: <text>`. `openItems` holds only the branch review's cannot-verify items, so a story-level line whose text matches none of them is its own item: label it `<storyId>:cv<n>`.
3. **Live CI.** Read the PR's checks on its current head: `gh pr checks <url> --json name,state,bucket,link` (GitHub) or `glab ci status --branch <branch>` (GitLab). One item per failing or pending check, labelled `check:<name>`. A `_run:ci` item from `openItems` closes only when the checks are green on the pushed head.
4. **Fix-now minors.** Each `featureWorkflow.minors[]` entry with `triage: "fix-now"` that `branch-rereview.json` did not mark addressed: one item, labelled by the minor's `id`.

Items 3 and 4 are recorded through `nax workflow record` (it accepts kinds `ci` and `minor` with any id). Items 1 and 2 are not yet accepted (nax#2578): their rulings go in the `## Also verified` comment (see Promotion) and are named in the final summary.

Print the whole list grouped by kind, each with its id or label, severity, `file:line`, the full issue, the suggestion, and any ruling joined to it. Do not truncate. If the list is empty and the outcome is still `draft`, say so and ask the user whether to go straight to the gates and promotion. Then confirm with the user that the items are still live: they may have fixed some by hand since the draft was opened. Drop confirmed-fixed items from the work list, but still record them (`verified`, with the evidence).

## Handling each kind

Fixes need explicit user approval, as everywhere in this skill. Hold item judgments until the user has seen the list.

- **Finding (`finding`, `ruling`)**: triage like Step 5: recommend a fix for CRITICAL/HIGH and for clear low-risk MEDIUM, state LOW. On approval, apply the change the `suggestion` names, **and add the test it names** (a finding whose suggestion mentions a missing test is not fixed until that test exists and passes). The user may waive a finding as an intentional deviation; record `waived` with the reason. Never mark a finding fixed without a commit. For a `ruling` item, verify the advisor's ruling as below as well.
- **Advisor decision** (`advisor` items, the ruling on a `ruling` item, trusted decisions): a judgment, not a defect, and its rationale is only as good as what the advisor checked (it often says so: "I did not run the tests"). **Verify the premise before anyone confirms it:**
  - "already fixed by `<sha>`" → `git show <sha>`, read the changed code at the finding's `file:line`, and run the test the finding names (or the nearest scoped test); state whether the fix covers the whole finding or only part of it.
  - "out of scope" / "not required" → find the spec or PRD line that says so.
  - `waive` (an accepted risk) → read the code and confirm the risk described is the real one, no larger.
  - `hold` / `fix` → confirm the defect exists at `file:line` (a probe or failing test is the strongest evidence).
  - a hold on **coverage, not a defect** ("did not read the whole diff", "N files changed, including …", "needs verification against the PR base") → check the premise against the real base: `git fetch origin`, then `git diff --stat <seed>..HEAD` and `git diff --name-only origin/<base>...HEAD`. A file count taken against a stale local `main` is the usual cause. Show both inventories, then offer: a targeted review of `<seed>..HEAD` (below), an override with the inventory as the evidence, or keep the draft.

  **To prove a test catches the defect**, run it against the pre-fix code in a throwaway worktree: `git worktree add <tmp> <pre-fix-sha>`, copy the new test file in, run it there (expect red), then `git worktree remove <tmp>`. Never `git stash` in the live tree to fake the pre-fix state: the stash stack is shared with every other worktree and session.

  Then show the user the decision (`text`, `why`, `costIfWrong`, or the `nax advisor list` rationale) **with your verification evidence**:
  - **Flagged or held** — ask the user to **confirm** it (`confirmed`) or **override** it (`overridden`; if the override means code changes, handle it as a finding too).
  - **Trusted** — list it as `verified` when the premise held. When it did not, raise it to the user as an override candidate; never leave a trusted decision with a false premise standing silently.
  - A `carry` was applied by nax as ruled: treat it as a trusted decision and verify its premise.
  - A `defer` is **not resolved**: it points at a later step, and in a workflow draft no later step remains. Treat `defer` as "needs a human now": fix it, or have the user explicitly accept the risk or file it elsewhere (record where in the `reason`). Never carry a `defer` forward as done.
- **Red gate (`gate`)** — reproduce it with `nax gates run --gate <name> --json` (Step 6), show the output tail, fix with approval, and re-run until green. Step 6 re-runs every gate anyway; this item is closed only when its gate is green there.
- **CI (`ci`, `check:<name>`)** — the local gates being green does not clear it; CI runs things they do not (e2e, other OSes, services).
  1. Read the failing job's log: `gh run view <run-id> --job <job-id> --log-failed` (the ids are in the check's `link`), or the GitLab job trace.
  2. Find the root cause in the log (for example a 429 from a rate-limited endpoint, a missing service, a flaky timeout) before proposing anything; do not re-run blindly. A check that cannot run on this host (e2e under a macOS sandbox) is still fixed from its CI log.
  3. Fix it with approval, commit, push, and **wait for the checks on the new head**. Wait **at most about 15 minutes** (`gh pr checks <url> --watch --fail-fast`, or one status read every 30-60 s); when the bound passes with checks still pending, report them as pending and ask the user. Never wait in an unbounded loop. Read checks by `bucket`: `pass` and `skipping` are green, `fail` and `cancel` are red, `pending` is pending (`gh pr checks` exits 8 for pending, which is not a failure). "Required" means a check the branch protection requires (`gh pr checks <url> --required`); on GitLab, where there is no such flag, treat every pipeline job not marked `allow_failure` as required. Re-run a job only when the log shows an infrastructure flake, and say so in the `reason`.
  4. The item closes only when that check is green on the pushed head, or the user explicitly waives it by name (`waived`, with the reason).
- **Story (`story`)** — read the story's dir (`<runDir>/US-00N/`) and the PRD for what is missing; treat the gap as a finding against the spec (propose a fix, with approval) or have the user waive it.
- **Cannot-verify** (`cannot-verify` items, `<storyId>:cv<n>` lines) — do not wave it through. Actually verify it now: run the tests or commands the text names, read the code paths it refers to, and report concrete evidence (command and result, or file:line). `verified` requires evidence in the `reason`. If it genuinely cannot be checked here (needs a deployed environment, a human with credentials), say so and let the user decide: record `waived` with that reason, or leave the draft.
- **Reason (`reason`)** — a draft reason nax could not tie to another item, such as `branch review did not run`, uncommitted changes after the branch fix, or a nothing-verified gate run. Explain what it means for this PR, find its cause in the run (`ledger.md`, the story dirs, `git status`), and resolve it like a finding: `fixed` (with the commit), `verified` (with evidence it no longer holds), or `waived` by the user with the reason.
- **Fix-now minor (`minor`)** — fix it with approval (`fixed`, with the commit) or have the user waive it.

## Targeted review of the fix diff (optional)

The workflow already ran story reviews and a branch review plus re-review, so a full `post-impl-review` here would re-derive what exists. Do not run one by default. After fixes land, **offer** a single targeted review as an option in the Step 7 approval question (always when a fix changed runtime behaviour: anything beyond formatting, renames, comments or tests) scoped to what changed since the draft: the fix diff (`git diff <draftHeadSha>..HEAD`, where `<draftHeadSha>` is the PR head when the draft was opened, `git rev-parse origin/<branch>` before your first commit). Use Step 5's targeted-verification subagent (the findings you fixed plus the files touched), not a whole-diff phase. Escalate to a full same-phase `post-impl-review` only for broad or structural fixes.

## Recording the decisions: `nax workflow record`

Resume is the only place a human ruling on a workflow draft is captured. `nax workflow record` validates the rulings against the run's open items and writes the sidecar `<runDir>/decisions-<timestamp>.json`. **Never write or edit the sidecar by hand.**

1. Write the rulings as a **JSON array** to a file outside the repo (your scratchpad or a temp dir), one entry per item you rule on:

   ```json
   [
     { "id": "B3", "kind": "finding", "disposition": "fixed", "reason": "Real defect in the retry path; fixed and the named test added.", "sha": "a1b2c3d" },
     { "id": "D-1", "kind": "advisor", "disposition": "confirmed", "reason": "Deferral accepted; follow-up tracked as <issue ref>." },
     { "id": "check:e2e", "kind": "ci", "disposition": "fixed", "reason": "429 from the rate-limited fixture endpoint; stubbed it; green on e5f6a7b.", "sha": "e5f6a7b" }
   ]
   ```

   - `kind`: the item's kind, except that a `ruling` item is recorded as `advisor`. Live CI checks are `ci`, fix-now minors are `minor`.
   - `disposition`: `fixed` (code changed; `sha` required, 7 to 40 hex characters) \| `waived` (judged not a defect, or accepted risk) \| `confirmed` (ruling upheld) \| `overridden` (ruling reversed) \| `verified` (cannot-verify or already-fixed item, evidence in `reason`). Only `fixed` takes a `sha`.
   - `reason`: one non-empty line. An `advisor` entry's reason carries the verification evidence (the commit read, the test run and its result); a `ci` entry's carries the check name, the root cause and the head sha it went green on.

2. Record them, once triage is done and any fixes are committed:

   ```bash
   nax workflow record -f <featureName> --decisions <file> --json
   ```

   Exit `0` prints `{ sidecar, outcome, decisions, unruled }`; the sidecar's outcome starts as `pending`. `unruled` lists the open items with no entry yet: rule on them and run `record` again with the new entries (it merges by id, so a re-ruled id replaces its old entry in place). Exit `1` names the invalid entry (`unknown item B9; open items: B1, B2`, `decision B1: disposition fixed requires a sha`): correct the file and run it again. **Do not defer the first `record` past Step 7**: if the user abandons the PR at the approval gate, the rulings they just made are still worth keeping.

3. Record the outcome only after the step that settles it. `nax workflow promote --yes` records `promoted` itself. Record the others with `--outcome`. `--outcome` alone only updates an existing sidecar: when `record` has not run yet for this run (the user stopped before any ruling, or there were no items), pass `--decisions` with a file holding `[]` as well, or `record` exits 1 with `no decisions sidecar for run <runId>; pass --decisions`.
   - The user stops: `nax workflow record -f <featureName> --outcome abandoned` (plus `--decisions <file>` as above).
   - A ready audit ends: `--outcome verified-ready` (see Ready-audit mode).
   - Promotion stopped after the PR was marked ready (see Promotion): `--outcome promoted`.

   `--outcome promoted` and `--outcome verified-ready` are refused while the PR is still a draft.

Trusted advisor decisions and story-level cannot-verify lines cannot be recorded yet (`record` rejects ids that are not open items; nax#2578). Do not force them in under another kind. Keep their rulings for the `## Also verified` comment.

The sidecar sits under `.nax/features/<feature>/workflow/`, which is git-ignored: leave it uncommitted and tell the user where it is.

## Promotion: `nax workflow promote`

`nax workflow promote` checks that every open item has a recorded ruling and that the PR's checks are green on HEAD, and with `--yes` ticks the checklist, posts the evidence comment, marks the PR ready and records `promoted`. Run it from the checkout whose `HEAD` is the head you pushed: it compares the checks against `git rev-parse HEAD`.

1. **Dry run first**, after pushing (7b):

   ```bash
   nax workflow promote -f <featureName> --json
   ```

   It reads the checks once and never waits. Exit `0` means both checks pass: `ready to promote`. Exit `2` means a check failed; its `detail` says why:
   - `items-ruled` failed (`no ruling recorded for <ids>`, or `no decisions recorded`) → rule on those items and run `record`.
   - `ci-green` failed with `ci pending` → wait for the checks as the `ci` item says (at most about 15 minutes), then run the dry run again.
   - `ci-green` failed with `ci failed`, `ci conflicting`, or `ci unavailable` (including a head mismatch: push first) → handle it as a `ci` item. Never promote a conflicting PR.

   Exit `1` is an error that writes nothing: the run did not end as a draft, has no PR url, the PR is already ready, no forge was detected, or HEAD could not be read. Report it.

2. **Post the `## Also verified` comment first** when the list had trusted advisor decisions or story-level cannot-verify lines: one comment, one line per item (label, kind, disposition, and the evidence), with `gh pr comment <url> --body-file <file>` or `glab mr note create <iid> -m …` (older glab: `glab mr note <iid> -m …`). Keep the comment file beside your decisions file. It is the only record of those rulings until nax#2578 ships, so it goes out before anything can stop the promotion. Name it in the same Step 7 approval question.

3. **Promote on explicit approval** (the single Step 7 question):

   ```bash
   nax workflow promote -f <featureName> --yes --json
   ```

   It re-reads the PR body, ticks the resolved `- [ ] **<id>**` lines, posts one `## Resolved before ready` comment built from the sidecar, marks the PR ready, and records `promoted` with the url. Exit `0` with `promoted: true` is done. Exit `1` with `promote stopped at <action>: <detail>` means a forge command failed: earlier actions stay done and the sidecar is not marked promoted. Report which action failed.
   - Stopped at `tick` or `comment`: fix the cause and run `--yes` again. A re-run ticks idempotently but posts a second evidence comment if the first went through; say so.
   - Stopped at `ready`: fix the cause (`not mergeable`, permissions) and run `--yes` again, with the same caveat about a second comment.
   - Any other exit `1` after the PR turned ready (the sidecar write failed): check the PR state, and if it is ready run `nax workflow record -f <featureName> --outcome promoted`. Do not run `promote` again: it refuses a ready PR.

**When `promote` cannot be used.** It has no override, so three cases fall back to the manual promotion in `older-nax-fallback.md` ("Workflow draft on nax < 0.89", Promotion), each only with the user's explicit approval:
- the user waives a red required check by name (`ci-green` stays failed);
- the repo has no CI at all (`ci no-checks`);
- re-promoting a PR that ready-audit mode turned back into a draft (the run's outcome is `ready`, so `promote` refuses it).

Record the rulings through `nax workflow record` first in each case, and after the manual promotion run `nax workflow record -f <featureName> --outcome promoted`.

**Body refresh.** In workflow modes do not offer 7g's spec-body refresh before promotion: it replaces the "Before marking ready" checklist that `promote` ticks.

## Ready-audit mode

For outcome `ready` the PR/MR is already ready. That is usually an advisor's approval: nax asks the advisor when no deterministic reason holds the PR back. So it gets the same scrutiny as a draft:

- **Build the list as for a draft.** `openItems` is usually short here (cannot-verify items, perhaps a reason); the readiness approval itself is a trusted decision (`kind: "finish-approval"` in `nax advisor list`, its `rationale` the advisor's case for ready). Include every advisor decision, the story-level cannot-verify lines, and red or pending live checks.
- **Verify each item** as "Handling each kind" says.
- **Nothing open** → report the PR clean, with the evidence (decisions verified, checks green on `<sha>`), and stop after recording.
- **Something open** → triage and fix it as for a draft, pushing to the same PR. A blocking item is a red required check, an advisor decision whose premise is false, or a CRITICAL/HIGH defect. For one of those, **offer** to convert the PR back to draft while it is fixed (`gh pr ready <url> --undo` / `glab mr update <iid> --draft`); re-promote it by hand once it is cleared (`promote` refuses this case; see above). Never change the PR's state without the user's approval.
- **Recording.** `nax workflow promote` refuses a ready PR, and the body of a ready PR has no checklist, so do not edit the body. Post the evidence comment by hand, headed `## Verified after ready`, covering every item. Then record: `nax workflow record -f <featureName> --decisions <file> --outcome verified-ready` with the rulings on open items (an empty array `[]` when there are none), or `--outcome promoted` if it went back to draft and was re-promoted.

## Steps 3-8 in workflow modes

`SKILL.md` runs the steps; in workflow-draft and ready-audit modes they change as follows. Ready-audit mode follows the same changes and skips only the promotion.

**Step 3 (acceptance).** Workflow mode turns acceptance off for its own run, but `nax features resolve` reports the project config, so it can say `enabled: true` for a feature whose run never generated a test. `enabled: false` → skip. `enabled: true` → run every group whose `exists` is `true` (per `acceptance.md`). A group with `exists: false` is expected here: print `Acceptance not generated in workflow mode — skipping <testPath>.`, never generate one, and report it as `acceptance skipped (not generated by workflow)`, never as a pass.

**Step 4 (review).** Do not run `post-impl-review`: the workflow already ran story reviews, a branch review and re-reviews. Load the items (above), surface them verbatim, and carry them into Step 5.

**Step 5 (triage).** Triage the items, not review phases, each kind as "Handling each kind" says, with explicit user approval for every fix. Then run `nax workflow record`. The targeted review of the fix diff is offered at the Step 7 approval, not run unprompted.

**Step 6 (repo-root gates)** is required: the tree changed after the workflow's final gates.

**Step 7 (promote).** The PR/MR already exists: commit and push (7b), run the `promote` dry run, and on explicit approval post any `## Also verified` comment, then run `promote --yes`, as "Promotion" says. If any item is still unresolved and unwaived, do not promote. In ready-audit mode post the `## Verified after ready` comment only.

**Step 8 (record).** `nax workflow record` already wrote the sidecar in Step 5, and `promote --yes` set its outcome. Record any other outcome (`abandoned`, `verified-ready`) as "Recording the decisions" says.

## Common mistakes

| Mistake | Do instead |
|:--|:--|
| Building the open-items list by hand from `result.json`, the ledger and the advisor ledger | `nax workflow status -f <feature> --json`, plus only the four supplementary sources above |
| Writing or editing `decisions-*.json` by hand | `nax workflow record --decisions <file>`; it validates ids, kinds and shas |
| Ticking the checklist and posting the evidence comment by hand | `nax workflow promote --yes` does both from the sidecar |
| Posting `## Also verified` after `promote --yes` | Post it first: if the promotion stops, those rulings exist nowhere else |
| Promoting the draft without clearing its open items | `promote` refuses while an item is unruled; rule on every item, fixed, verified, confirmed or explicitly waived |
| Running `promote --yes` without the dry run, or before pushing | Push, dry-run, show the result, then ask; `ci-green` is checked against local HEAD |
| Forcing a trusted decision or story-level cannot-verify line into the sidecar under another kind | Put it in the `## Also verified` comment (nax#2578) |
| Re-running a full `post-impl-review` | The workflow already reviewed; offer only a targeted review of the fix diff |
| Confirming an advisor decision on its own rationale | Verify the premise (commit, code, test) first and show the evidence; list trusted decisions too |
| Treating the `ci` field as live, or promoting on green local gates while CI is red | `ci` is a publish-time snapshot; read the live checks, fix from the log, push, and wait for the new head |
| Treating a `defer` ruling as resolved | `defer` points at a step that has already passed; it needs a human decision now |
| Skipping cannot-verify items | Run the named tests or read the code and report evidence; waive only with a stated reason |
| Treating outcome `ready` as nothing to do | Run ready-audit mode: verify the decisions (the readiness approval included), the cannot-verify lines and live CI |
| Refreshing the PR body before `promote --yes` | The refresh deletes the checklist `promote` ticks; do not offer it in workflow modes |
| Faking the pre-fix state with `git stash` to show a test goes red | Use a throwaway `git worktree` at the pre-fix commit |
