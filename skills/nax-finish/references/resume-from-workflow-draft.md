# Resume from a workflow-mode draft (Step 1c detail)

nax's **workflow mode** (config `workflow`, or a profile that enables it) runs, per story, implementer -> gates -> story review -> fix rounds; then, per feature, repo gates -> branch review -> branch fix -> branch re-review (fix and re-review repeat up to `workflow.maxBranchFixRounds`, default 2) -> final gates -> publish. Publish opens the PR/MR as a **draft** whenever anything needs a human, and as **ready** when nothing deterministic holds it back and the advisor approves (the `finish-approval` decision; see Ready-audit mode). Nothing in nax takes a draft to ready: the workflow is single-pass by design, so the human judgment it asked for has nowhere to go. This skill is that path.

When a draft result exists for the feature, Step 4's review derivation is **already done** — the story reviews, the branch review and the re-review all ran — so resume loads the open items from the artifacts instead of paying for a fresh review, and triages them under the skill's normal Step 5 discipline.

Resume applies to `featureWorkflow.outcome == "draft"` and, in **ready-audit mode**, to `ready`.
- `ready` (older nax: `opened`) means the PR/MR is already ready. Build the same open-items list, verify it, and fix what it finds, but skip promotion; see "Ready-audit mode" below.
- `local-only` / `pushed` (older nax: `skipped`) mean no PR/MR was opened; continue normally, and Step 7 offers to open one.
- Anything else, or no artifact, is the ordinary case.

**Start from the verdict, but never stop at it.** nax 0.88+ writes `result.verdict = { workflowPassed, outcome, reasons[], openItems[] }` (nested under `verdict`, not top-level). `verdict.openItems[]` is **partial**: it holds the open blocking findings, the branch review's cannot-verify items and red final gates — not advisor holds, fix-now minors, incomplete stories or CI. Read it first and use its `id`s (they are the `**<id>**` tokens in the PR body), then build the full union below. When `verdict` is absent (older nax), derive everything from the fields below. Every field in this document may be missing on an older nax — **fail soft**: use what is there and tell the user plainly what was missing (e.g. "no `url` in the result — will detect the PR by branch", "no ids in `branch-review.json` — matched findings by file:line").

## Locating the artifact

The workflow writes **repo-local**, under the feature directory:

```
<repoRoot>/.nax/features/<feature>/workflow/<runId>/
  result.json  ledger.md  feature-report.md  preflight.json
  branch-review.json  branch-rereview.json
  package-*.diff
  US-001/  US-002/ ...                      # per-story dirs
```

Pick the **newest `<runId>` dir by mtime**; when mtimes are unreliable (fresh checkout, copied tree), use the dir whose `result.json` has the latest `featureWorkflow.startedAt`. Record the `<runId>` you acted on.

```bash
ls -td <repoRoot>/.nax/features/<feature>/workflow/*/ 2>/dev/null | head -1
```

Read with your own file-reading tool; `jq` is fine where it exists but do not depend on it. Confirm `result.json`'s `feature` matches the `featureName` Step 1 resolved. A missing dir, an unreadable or unparseable `result.json`, or a missing `featureWorkflow` means "no workflow artifact" — say nothing and continue normally.

## The result contract

`result.json` (relevant fields only):

| Field | Notes |
|:--|:--|
| `schemaVersion`, `runId`, `feature` | Identity. |
| `stories` | An object keyed by story id (`{ "US-001": { state, phase, … } }`), not an array. `complete` is the only finished state; anything else (including `complete-gate-open`) is an open item. |
| `featureWorkflow.step` | Last step reached (`done` on a finished workflow). Anything else means the workflow stopped early — say so. |
| `featureWorkflow.startedAt`, `seed`, `fixBase` | `seed` = the commit the workflow started from; `fixBase` = the commit before the single branch fix. `fixBase..HEAD` is the branch-fix diff (used for the optional targeted review). |
| `featureWorkflow.reviewRan`, `fixRan` | Whether the branch review and the branch fix executed. |
| `featureWorkflow.reviewOpen[]` | Findings still open after the workflow: `{ id, severity, kind, file, line, issue, suggestion }`. `kind` is typically `spec` or `quality`. |
| `featureWorkflow.rulings[]` | Advisor/automated decisions: `{ findingId, action, needsHumanConfirm, source, decisionId, text, why, costIfWrong }`. `action` is e.g. `fix`, `defer`, `accept-risk`. |
| `featureWorkflow.minors[]` | The story loops' deferred minors: `{ id, storyId, text, triage }`, `triage` `fix-now` or `leave`. A `fix-now` minor went to the branch fix: it is an open item unless the re-review marked it addressed (`branch-rereview.json` `verdicts[]`). A `leave` minor is a note: surface the count. |
| `featureWorkflow.newMinors[]` | Plain strings: minors the branch review or re-review raised. Notes, not items. When an advisor quotes a minor count that differs from `minors` + `newMinors`, list the artifact's items and say which ones it meant. |
| `featureWorkflow.reasons[]` | Why the PR is a draft, in nax's words (e.g. `1 ruling(s) flagged for a human`). Treat every reason generically — do not assume only one kind exists. |
| `featureWorkflow.repoGates`, `finalGates` | `{ ran[], failing[] }`. `finalGates` ran after the branch fix and is the one that matters. |
| `featureWorkflow.ci` | `green` \| `failed` \| `pending` \| `skipped` \| `conflicting` (the PR has merge conflicts; never promote) \| `no-checks` \| `unavailable` (checks could not be read) — the CI wait's verdict at publish time. It is a snapshot: re-read the PR's live checks (below) before trusting it. |
| `featureWorkflow.flaggedDecisions` | Advisor decision ids flagged for a human (e.g. `["D-1", "D-2"]`). |
| `featureWorkflow.outcome` | `ready` \| `draft` \| `local-only` \| `pushed` (`FeatureOutcome`; older nax wrote `opened` for `ready` and `skipped` for no forge). |
| `featureWorkflow.url` | The PR/MR. May be absent on older nax; fall back to branch detection (Step 7e). |
| `featureWorkflow.timings`, `tokensByRole` | Informational. |

`branch-rereview.json`: `{ verdicts: [{ id, addressed, note }], newFindings: [{ severity, kind, file, line, issue, suggestion }] }`. `branch-review.json` may carry findings with `id: null` (ids are assigned later); join by file:line when ids are missing.

`ledger.md` lines of interest:

```
<storyId|_run>: cannot-verify: <text>
_run: feature draft <url>: <reasons>
```

**Advisor decisions** have their own source of truth: `nax advisor list -f <feature> --json` lists every decision for the feature, flagged first, including the **trusted** ones nax applied without asking (for example a `waive` or `accept-risk` the advisor was confident about) and pre-flight rulings. On an older nax without the command, read `.nax/features/<feature>/decisions.jsonl` (one JSON object per line: `id`, `kind`, `action { type, reason? | instruction? }` — `reason` on `waive`/`defer`/`hold`/`escalate-tier`, `instruction` on `fix`, neither on `approve` — `needsHumanConfirm`, `confidence`, `rationale`, `auditRef`, `anchorFile`, `rulingTitle`, `findingSeverity`).

**CI** is read live from the forge, not only from `featureWorkflow.ci`: `gh pr checks <url-or-branch> --json name,state,bucket,link` (GitHub) or `glab ci status --branch <branch>` (GitLab).

A `cannot-verify` line is something the workflow could not check itself (a runtime behaviour, an external service, a manual step). The `feature draft` line repeats the reasons and, on older nax, may be the only place the URL appears.

## Building the open-items list

The open items are the **union** of the following, de-duplicated by finding id (else by file:line plus issue text). Give each a stable label (`B3`, `US-004`, `gate:lint`, `cv-1`) used in triage and in the sidecar.

1. **`reviewOpen[]`** — each entry is a finding item.
2. **Advisor decisions — all of them.** One `advisor` item per decision from `nax advisor list -f <feature> --json` (else `decisions.jsonl`), plus each `featureWorkflow.rulings[]` entry, de-duplicated by `decisionId`. Join each to its finding so the user sees the decision and the finding together: a `rulings[]` entry by its `findingId` (in `reviewOpen`, `branch-review.json`, or `branch-rereview.json` `newFindings`) and its `decisionId`; an advisor-list decision, which carries no `findingId`, by `id` = `decisionId` when a ruling names it, else by `anchorFile` / `storyId` / `rulingTitle`. A decision with no matching finding is still an item. Mark each as **flagged** (`needsHumanConfirm: true`) or **trusted** (applied without asking). Trusted decisions are listed too: they shaped the branch without a human ever seeing them.
3. **Re-review leftovers** — `branch-rereview.json` `newFindings[]`, and `verdicts[]` with `addressed: false`, that are not already in `reviewOpen`. These are the usual source of a draft: the one branch fix introduced or exposed something and no step remained to handle it.
4. **Red `finalGates.failing[]`** — one gate item per failing gate. Include `repoGates.failing` only if `finalGates` is missing.
5. **Stories not `complete`** — one item per story, with its state.
6. **Ledger `cannot-verify` lines** — one item each, keyed by story id (or `_run`).
7. **Red or pending CI** — one `ci` item per failing check on the PR's current head (from the live checks above), and one item when `featureWorkflow.ci` is `failed` or `pending` but the live checks cannot be read. A `CI failed` reason is explained only by these items.

8. **Fix-now minors** — each `minors[]` entry with `triage: "fix-now"` that the re-review did not mark addressed.

Cross-check against `reasons[]` (`verdict.reasons`, else `featureWorkflow.reasons`): every reason must be explained by at least one item. An advisor hold (e.g. `advisor held: …`) is explained by its `finish-approval` decision from `nax advisor list`, never by `openItems`. A reason with no matching item becomes an item of its own (kind `reason`), shown to the user — never drop one, and never promote while one is unexplained. If the union is empty and the outcome is still `draft`, say so and ask the user whether to proceed straight to the gates and promotion.

Print the list grouped by kind, each with its label, severity, `file:line`, the full issue, and the suggestion. Do not truncate. Then confirm with the user that the items are still live: they may have fixed some by hand since the draft was opened. Drop confirmed-fixed items from the work list, but still record them in the sidecar (`verified`, with the evidence).

## Handling each kind

Fixes need explicit user approval, as everywhere in this skill. Hold item judgments until the user has seen the list.

- **Finding (`reviewOpen`, re-review leftovers)** — triage like Step 5: recommend a fix for CRITICAL/HIGH and for clear low-risk MEDIUM, state LOW. On approval, apply the change the `suggestion` names, **and add the test it names** (a finding whose suggestion mentions a missing test is not fixed until that test exists and passes). The user may waive a finding as an intentional deviation; record `waived` with the reason. Never mark a finding fixed without a commit.
- **Advisor decision** — a judgment, not a defect, and its rationale is only as good as what the advisor checked (it often says so: "I did not run the tests"). **Verify the premise before anyone confirms it:**
  - "already fixed by `<sha>`" → `git show <sha>`, read the changed code at the finding's `file:line`, and run the test the finding names (or the nearest scoped test); state whether the fix covers the whole finding or only part of it.
  - "out of scope" / "not required" → find the spec or PRD line that says so.
  - `accept-risk` / `waive` → read the code and confirm the risk described is the real one, no larger.
  - `hold` / `fix` → confirm the defect exists at `file:line` (a probe or failing test is the strongest evidence).
  - a hold on **coverage, not a defect** ("did not read the whole diff", "N files changed, including …", "needs verification against the PR base") → check the premise against the real base: `git fetch origin`, then `git diff --stat <featureWorkflow.seed>..HEAD` and `git diff --name-only origin/<base>...HEAD`. A file count taken against a stale local `main` is the usual cause. Show both inventories, then offer: a targeted review of `<seed>..HEAD` (below), an override with the inventory as the evidence, or keep the draft.

  **To prove a test catches the defect**, run it against the pre-fix code in a throwaway worktree: `git worktree add <tmp> <pre-fix-sha>`, copy the new test file in, run it there (expect red), then `git worktree remove <tmp>`. Never `git stash` in the live tree to fake the pre-fix state: the stash stack is shared with every other worktree and session.

  Then show the user the decision (`text`, `why`, `costIfWrong`) **with your verification evidence**:
  - **Flagged** — ask the user to **confirm** it (`confirmed`) or **override** it (`overridden`; if the override means code changes, handle it as a finding too).
  - **Trusted** — list it as `verified` when the premise held. When it did not, raise it to the user as an override candidate; never leave a trusted decision with a false premise standing silently.
  - A `defer` is **not resolved**: it points at a later step, and in a workflow draft no later step remains. Treat `defer` as "needs a human now" — fix it, or have the user explicitly accept the risk or file it elsewhere (record where in the `reason`). Never carry a `defer` forward as done.
- **Red gate** — reproduce the failing gate with the repo's own command from Step 2, show the output, fix with approval, and re-run until green. Step 6 re-runs every gate anyway; this item is closed only when its gate is green there.
- **Red CI check (`ci`)** — the local gates being green does not clear it; CI runs things they do not (e2e, other OSes, services).
  1. Read the failing job's log: `gh run view <run-id> --job <job-id> --log-failed` (the ids are in the check's `link`), or the GitLab job trace.
  2. Find the root cause in the log (for example a 429 from a rate-limited endpoint, a missing service, a flaky timeout) before proposing anything; do not re-run blindly. A check that cannot run on this host (e2e under a macOS sandbox) is still fixed from its CI log.
  3. Fix it with approval, commit, push, and **wait for the checks on the new head**. Wait **at most about 15 minutes** (`gh pr checks <url> --watch --fail-fast`, or one status read every 30-60 s); when the bound passes with checks still pending, report them as pending and ask the user. Never wait in an unbounded loop. Read checks by `bucket`: `pass` and `skipping` are green, `fail` and `cancel` are red, `pending` is pending (`gh pr checks` exits 8 for pending, which is not a failure). "Required" means a check the branch protection requires (`gh pr checks <url> --required`); on GitLab, where there is no such flag, treat every pipeline job not marked `allow_failure` as required. Re-run a job only when the log shows an infrastructure flake, and say so in the `reason`.
  4. The item closes only when that check is green on the pushed head, or the user explicitly waives it by name (`waived`, with the reason).
- **Story not complete** — read the story's dir (`US-00N/`) and the PRD for what is missing; treat the gap as a finding against the spec (propose a fix, with approval) or have the user waive it.
- **Cannot-verify** — do not wave it through. Actually verify it now: run the tests or commands the text names, read the code paths it refers to, and report concrete evidence (command and result, or file:line). `verified` requires evidence in the `reason`. If it genuinely cannot be checked here (needs a deployed environment, a human with credentials), say so and let the user decide: record `waived` with that reason, or leave the draft.

## Targeted review of the fix diff (optional)

The workflow already ran story reviews and a branch review plus re-review, so a full `post-impl-review` here would re-derive what exists. Do not run one by default. After fixes land, **offer** a single targeted review as an option in the Step 7 approval question (always when a fix changed runtime behaviour: anything beyond formatting, renames, comments or tests) scoped to what changed since the draft: the fix diff (`git diff <draftHeadSha>..HEAD`, where `<draftHeadSha>` is the PR head when the draft was opened — `git rev-parse origin/<branch>` before your first commit). Use Step 5's targeted-verification subagent (the findings you fixed plus the files touched), not a whole-diff phase. Escalate to a full same-phase `post-impl-review` only for broad or structural fixes.

## Recording the decisions (required in workflow-draft mode)

Resume is the only place a human ruling on a workflow draft is captured. Write a sidecar beside the result:

```
<repoRoot>/.nax/features/<feature>/workflow/<runId>/decisions-<timestamp>.json
```

`<timestamp>` is UTC ISO-8601 with `:` and `.` replaced by `-` (e.g. `2026-10-13T09-12-00-417Z`), so a second resume never clobbers the first. Take the milliseconds from the clock (`node -e 'console.log(new Date().toISOString())'`); do not pad them with `000`.

```json
{
  "artifact": "<runId>/result.json",
  "feature": "<feature-name>",
  "resumedAt": "2026-10-13T09-12-00-000Z",
  "reasons": ["1 ruling(s) flagged for a human"],
  "decisions": [
    {
      "id": "B3",
      "kind": "finding",
      "disposition": "fixed",
      "reason": "Real defect in the retry path; fixed and the named test added.",
      "sha": "a1b2c3d"
    },
    {
      "id": "D-1",
      "kind": "ruling",
      "disposition": "confirmed",
      "reason": "Deferral accepted; follow-up tracked as <issue ref>."
    },
    {
      "id": "US-004",
      "kind": "cannot-verify",
      "disposition": "verified",
      "reason": "Ran <test command>: 12 passed; read <file>:<line> for the guard."
    }
  ],
  "outcome": "promoted",
  "url": "<pull/merge request url>"
}
```

- One entry per open item — **every** item, waivers and already-fixed ones included.
- `kind` is `finding` \| `advisor` \| `gate` \| `ci` \| `story` \| `cannot-verify` \| `minor` (a fix-now minor) \| `reason` (a draft reason no other item explains) (`ruling`, written by earlier versions of this skill, means `advisor`).
- An `advisor` entry's `reason` carries the verification evidence (the commit read, the test run and its result); a `ci` entry's carries the check name, the root cause and the head sha it went green on.
- `disposition` is `fixed` (code changed, `sha` required) \| `waived` (judged not a defect or accepted risk) \| `confirmed` (ruling upheld) \| `overridden` (ruling reversed) \| `verified` (cannot-verify or already-fixed item, with evidence in `reason`).
- `reason` is one line, always.
- `outcome` is `pending` \| `promoted` \| `verified-ready` (ready-audit mode, PR left ready) \| `abandoned`. Write the file with `pending` once triage is done and fixes are committed; rewrite `outcome` (and `url`) after the call that settles it — the promote succeeding, the audit ending, or the user stopping. Never write `promoted` before the PR is ready. Write the file even when abandoned (no `url` then, or the draft's url if known). Do not defer the first write past Step 7.

**It is a repo-local `.nax` file.** Run `git check-ignore -v <sidecar path>`: when ignored (the usual case for `.nax/`), leave it uncommitted and tell the user where it is. Commit it only when the repo tracks that directory, and only with approval.

## Promotion

Step 7g promotes the existing draft on explicit approval, once the PR's checks are green on the pushed head. Record what was cleared in two places, both only on explicit approval:

1. **Tick the body checklist** — a targeted edit of the generated "Before marking ready" list, nothing else.
   1. Read the body **immediately before writing** (another edit may have landed): `gh pr view <url> --json body -q .body`, or `glab mr view <iid> --output json`.
   2. nax renders each item as `- [ ] **<id>** (<severity>, <kind>) \`file:line\` — <issue>` (or `(<kind>)` alone with no severity; a gate as `- [ ] **<id>** (gate) — final gate <id> is red…`), possibly followed by indented `  Suggestion: …` and `  Advisor: …` lines. The body's kinds are `finding`, `ruling`, `cannot-verify` and `gate`. They differ from the sidecar's (`advisor`, `ci`), and your own labels may differ from nax's ids. So **match each line by the exact `**<id>**` token nax rendered** (`verdict.openItems[].id` in `result.json`, else the bold token in the body), never by the kind or severity text.
   3. Tick only that first line: `- [ ] **<id>**` → `- [x] **<id>**`, with ` — fixed in <sha>`, ` — verified`, ` — confirmed` or ` — waived: <reason>` appended at the end of that line, before any indented continuation lines.
   4. Write it back: `gh pr edit <url> --body-file <file>`, or `glab mr update <iid> --description …`.

   Leave an unresolved item unticked (it blocks promotion anyway). Never reword, reorder or delete any other line of the generated body. Items nax never put in the body (`ci`, trusted advisor decisions, re-review leftovers) go in the evidence comment only. When the list ends with `- …and N more`, the hidden items have no line to tick: report them in the comment and say so.
2. **Post one evidence comment** — `gh pr comment <url> --body-file <file>` or `glab mr note create <iid> -m …` (older glab: `glab mr note <iid> -m …`), headed `## Resolved before ready`. Write one line per item: label, kind, disposition, and the evidence (commit sha, the test command and its result, the CI run link, the verified premise of an advisor decision). It mirrors the decisions sidecar; one comment per finish pass, never one per item.

## Ready-audit mode

For `featureWorkflow.outcome == "ready"` the PR/MR is already ready. That is usually an advisor's approval: nax asks the advisor when no deterministic reason holds the PR back. So it gets the same scrutiny as a draft:

- **Build the list as for a draft.** Include every advisor decision; the **readiness approval itself** is one (`kind: "finish-approval"` in `nax advisor list`, its `rationale` is the advisor's case for ready). Include the ledger cannot-verify lines, and red or pending live CI checks. `reviewOpen` and failing gates are normally empty here; include them if not.
- **Verify each item** as described under "Handling each kind".
- **Nothing open** → report the PR clean, with the evidence (decisions verified, checks green on `<sha>`), and stop. Write the sidecar with `outcome: "verified-ready"`.
- **Something open** → triage and fix it as for a draft, pushing to the same PR. A blocking item is a red required check, an advisor decision whose premise is false, or a CRITICAL/HIGH defect. For one of those, **offer** to convert the PR back to draft while it is fixed (`gh pr ready <url> --undo` / `glab mr update <iid> --draft`); re-promote through 7g once it is cleared. Never change the PR's state without the user's approval.
- **Recording.** A ready PR's body has no checklist (newer nax lists the cannot-verify items under `## Not verified by nax`, without checkboxes), so do not edit the body. Post the evidence comment headed `## Verified after ready`, and write the sidecar with `outcome: "verified-ready"` or, if it went back to draft and was re-promoted, `"promoted"`.

## Common mistakes

| Mistake | Do instead |
|:--|:--|
| Promoting the draft without clearing its open items | The draft exists because something needs a human; promote only when every item is fixed, verified, confirmed, or explicitly waived |
| Re-running a full `post-impl-review` | The workflow already reviewed; load the open items, and offer only a targeted review of the fix diff |
| Confirming an advisor decision on its own rationale | Verify the premise (commit, code, test) first and show the evidence; list trusted decisions too |
| Treating `CI failed` as unexplained, or promoting on green local gates while CI is red | Read the failing job's log, fix the cause, push, and wait for the checks on the new head |
| Treating a `defer` ruling as resolved | `defer` points at a step that has already passed; it needs a human decision now |
| Skipping cannot-verify items | Run the named tests or read the code and report evidence; waive only with a stated reason |
| Overwriting the generated PR body | Tick only the resolved checklist lines; put the evidence in one PR comment |
| Treating outcome `ready` as nothing to do | Run ready-audit mode: verify the decisions (the readiness approval included), the cannot-verify lines and live CI |
| Branching on `opened` / `skipped` only | nax writes `ready` / `draft` / `local-only` / `pushed`; accept the old names as aliases |
| Assuming the one reason from the example | Reasons vary (rulings, open findings, red gates, incomplete stories, cannot-verify); build the list from every field and cross-check against `reasons[]` |
| Treating a missing field as an error | Older nax omits `url`, ids, and the verdict; fail soft and say what was missing |
| Taking `verdict.openItems` as the whole list | It omits advisor holds, fix-now minors, incomplete stories and CI; build the union and explain every reason |
| Faking the pre-fix state with `git stash` to show a test goes red | Use a throwaway `git worktree` at the pre-fix commit |
| Picking the run dir by name | Newest by mtime, or latest `featureWorkflow.startedAt` |
| Committing the decisions sidecar blindly | It is a repo-local `.nax` file; `git check-ignore` first, commit only if the repo tracks that directory |
