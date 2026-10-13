# Resume from a workflow-mode draft (Step 1c detail)

nax's **workflow mode** (config `workflow`, or a profile that enables it) runs, per story, implementer -> gates -> story review -> fix rounds; then, per feature, repo gates -> branch review -> **one** branch fix -> branch re-review -> final gates -> publish. Publish opens the PR/MR as a **draft** whenever anything needs a human. Nothing in nax takes that draft to ready: the workflow is single-pass by design, so the human judgment it asked for has nowhere to go. This skill is that path.

When a draft result exists for the feature, Step 4's review derivation is **already done** — the story reviews, the branch review and the re-review all ran — so resume loads the open items from the artifacts instead of paying for a fresh review, and triages them under the skill's normal Step 5 discipline.

Resume applies **only** to `featureWorkflow.outcome == "draft"`. `opened` means the PR/MR is already ready (nothing to do — report it per Step 7's rule); `skipped` means no forge was detected (continue normally; Step 7 offers to open one). Anything else, or no artifact, is the ordinary case.

**Prefer the verdict when nax writes one.** nax#2496 proposes a top-level `workflowPassed` and `openItems[]` in `result.json`. When present, read them first and treat `openItems[]` as the authoritative list; still cross-check it against the fields below. When absent (older nax), derive everything from the fields below. Every field in this document may be missing on an older nax — **fail soft**: use what is there and tell the user plainly what was missing (e.g. "no `url` in the result — will detect the PR by branch", "no ids in `branch-review.json` — matched findings by file:line").

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
| `stories[]` | `{ id, state }`. `complete` is the only finished state; anything else (including a story that ended `complete-gate-open`) is an open item. |
| `featureWorkflow.step` | Last step reached (`done` on a finished workflow). Anything else means the workflow stopped early — say so. |
| `featureWorkflow.startedAt`, `seed`, `fixBase` | `seed` = the commit the workflow started from; `fixBase` = the commit before the single branch fix. `fixBase..HEAD` is the branch-fix diff (used for the optional targeted review). |
| `featureWorkflow.reviewRan`, `fixRan` | Whether the branch review and the branch fix executed. |
| `featureWorkflow.reviewOpen[]` | Findings still open after the workflow: `{ id, severity, kind, file, line, issue, suggestion }`. `kind` is typically `spec` or `quality`. |
| `featureWorkflow.rulings[]` | Advisor/automated decisions: `{ findingId, action, needsHumanConfirm, source, decisionId, text, why, costIfWrong }`. `action` is e.g. `fix`, `defer`, `accept-risk`. |
| `featureWorkflow.minors[]`, `newMinors[]` | Low-severity notes. Surface the count; they are not open items unless a ruling flags them. |
| `featureWorkflow.reasons[]` | Why the PR is a draft, in nax's words (e.g. `1 ruling(s) flagged for a human`). Treat every reason generically — do not assume only one kind exists. |
| `featureWorkflow.repoGates`, `finalGates` | `{ ran[], failing[] }`. `finalGates` ran after the branch fix and is the one that matters. |
| `featureWorkflow.outcome` | `draft` \| `opened` \| `skipped`. |
| `featureWorkflow.url` | The PR/MR. May be absent on older nax; fall back to branch detection (Step 7e). |
| `featureWorkflow.timings`, `tokensByRole` | Informational. |

`branch-rereview.json`: `{ verdicts: [{ id, addressed, note }], newFindings: [{ severity, kind, file, line, issue, suggestion }] }`. `branch-review.json` may carry findings with `id: null` (ids are assigned later); join by file:line when ids are missing.

`ledger.md` lines of interest:

```
<storyId|_run>: cannot-verify: <text>
_run: feature draft <url>: <reasons>
```

A `cannot-verify` line is something the workflow could not check itself (a runtime behaviour, an external service, a manual step). The `feature draft` line repeats the reasons and, on older nax, may be the only place the URL appears.

## Building the open-items list

The open items are the **union** of the following, de-duplicated by finding id (else by file:line plus issue text). Give each a stable label (`B3`, `US-004`, `gate:lint`, `cv-1`) used in triage and in the sidecar.

1. **`reviewOpen[]`** — each entry is a finding item.
2. **Rulings with `needsHumanConfirm: true`** — a ruling item. Join it to its finding via `findingId` (in `reviewOpen`, `branch-review.json`, or `branch-rereview.json` `newFindings`) so the user sees the ruling and the finding together. A ruling with no matching finding is still an item; show its `text`.
3. **Re-review leftovers** — `branch-rereview.json` `newFindings[]`, and `verdicts[]` with `addressed: false`, that are not already in `reviewOpen`. These are the usual source of a draft: the one branch fix introduced or exposed something and no step remained to handle it.
4. **Red `finalGates.failing[]`** — one gate item per failing gate. Include `repoGates.failing` only if `finalGates` is missing.
5. **Stories not `complete`** — one item per story, with its state.
6. **Ledger `cannot-verify` lines** — one item each, keyed by story id (or `_run`).

Cross-check against `reasons[]`: every reason should be explained by at least one item. A reason with no matching item is itself surfaced to the user as an unexplained draft reason — do not drop it. If the union is empty and the outcome is still `draft`, say so and ask the user whether to proceed straight to the gates and promotion.

Print the list grouped by kind, each with its label, severity, `file:line`, the full issue, and the suggestion. Do not truncate. Then confirm with the user that the items are still live: they may have fixed some by hand since the draft was opened. Drop confirmed-fixed items from the work list, but still record them in the sidecar (`verified`, with the evidence).

## Handling each kind

Fixes need explicit user approval, as everywhere in this skill. Hold item judgments until the user has seen the list.

- **Finding (`reviewOpen`, re-review leftovers)** — triage like Step 5: recommend a fix for CRITICAL/HIGH and for clear low-risk MEDIUM, state LOW. On approval, apply the change the `suggestion` names, **and add the test it names** (a finding whose suggestion mentions a missing test is not fixed until that test exists and passes). The user may waive a finding as an intentional deviation; record `waived` with the reason. Never mark a finding fixed without a commit.
- **Ruling (`needsHumanConfirm`)** — a human decision, not a defect. Show the ruling `text`, `why`, and `costIfWrong`, then ask the user to **confirm** it (`confirmed`) or **override** it (`overridden`; if the override means code changes, handle it as a finding too). A `defer` ruling is **not resolved**: it points at a later step, and in a workflow draft no later step remains. Treat `defer` as "needs a human now" — fix it, or have the user explicitly accept the risk or file it elsewhere (record where in the `reason`). Never carry a `defer` forward as done.
- **Red gate** — reproduce the failing gate with the repo's own command from Step 2, show the output, fix with approval, and re-run until green. Step 6 re-runs every gate anyway; this item is closed only when its gate is green there.
- **Story not complete** — read the story's dir (`US-00N/`) and the PRD for what is missing; treat the gap as a finding against the spec (propose a fix, with approval) or have the user waive it.
- **Cannot-verify** — do not wave it through. Actually verify it now: run the tests or commands the text names, read the code paths it refers to, and report concrete evidence (command and result, or file:line). `verified` requires evidence in the `reason`. If it genuinely cannot be checked here (needs a deployed environment, a human with credentials), say so and let the user decide: record `waived` with that reason, or leave the draft.

## Targeted review of the fix diff (optional)

The workflow already ran story reviews and a branch review plus re-review, so a full `post-impl-review` here would re-derive what exists. Do not run one by default. After fixes land, **offer** a single targeted review scoped to what changed since the draft: the fix diff (`git diff <draftHeadSha>..HEAD`, where `<draftHeadSha>` is the PR head when the draft was opened — `git rev-parse origin/<branch>` before your first commit). Use Step 5's targeted-verification subagent (the findings you fixed plus the files touched), not a whole-diff phase. Escalate to a full same-phase `post-impl-review` only for broad or structural fixes.

## Recording the decisions (required in workflow-draft mode)

Resume is the only place a human ruling on a workflow draft is captured. Write a sidecar beside the result:

```
<repoRoot>/.nax/features/<feature>/workflow/<runId>/decisions-<timestamp>.json
```

`<timestamp>` is UTC ISO-8601 with `:` and `.` replaced by `-` (e.g. `2026-10-13T09-12-00-000Z`), so a second resume never clobbers the first.

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
- `kind` is `finding` \| `ruling` \| `gate` \| `story` \| `cannot-verify`.
- `disposition` is `fixed` (code changed, `sha` required) \| `waived` (judged not a defect or accepted risk) \| `confirmed` (ruling upheld) \| `overridden` (ruling reversed) \| `verified` (cannot-verify or already-fixed item, with evidence in `reason`).
- `reason` is one line, always.
- `outcome` is `promoted` \| `abandoned`. Write the file even when abandoned (no `url` then, or the draft's url if known). Do not defer it past Step 7.

**It is a repo-local `.nax` file.** Run `git check-ignore -v <sidecar path>`: when ignored (the usual case for `.nax/`), leave it uncommitted and tell the user where it is. Commit it only when the repo tracks that directory, and only with approval.

## Promotion

Step 7g promotes the existing draft on explicit approval. Beyond 7g's default of leaving the generated body untouched, **offer** to append a `## Resolved before ready` section to the PR/MR body listing each open item and its disposition (label, one-line outcome, commit sha when fixed). Append only; never rewrite the generated body. Read the current body (`gh pr view <branch> --json body`), add the section, and write it back only on explicit approval.

## Common mistakes

| Mistake | Do instead |
|:--|:--|
| Promoting the draft without clearing its open items | The draft exists because something needs a human; promote only when every item is fixed, verified, confirmed, or explicitly waived |
| Re-running a full `post-impl-review` | The workflow already reviewed; load the open items, and offer only a targeted review of the fix diff |
| Treating a `defer` ruling as resolved | `defer` points at a step that has already passed; it needs a human decision now |
| Skipping cannot-verify items | Run the named tests or read the code and report evidence; waive only with a stated reason |
| Overwriting the generated PR body | Leave it intact; offer to append a "Resolved before ready" section |
| Assuming the one reason from the example | Reasons vary (rulings, open findings, red gates, incomplete stories, cannot-verify); build the list from every field and cross-check against `reasons[]` |
| Treating a missing field as an error | Older nax omits `url`, ids, and the top-level verdict; fail soft and say what was missing |
| Picking the run dir by name | Newest by mtime, or latest `featureWorkflow.startedAt` |
| Committing the decisions sidecar blindly | It is a repo-local `.nax` file; `git check-ignore` first, commit only if the repo tracks that directory |
