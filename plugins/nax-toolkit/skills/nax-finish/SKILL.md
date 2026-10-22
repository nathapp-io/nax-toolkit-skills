---
name: nax-finish
description: Take a nax feature's PR/MR to ready through nax's own commands with one approval. Resolves the feature, reads the workflow run with nax workflow status, reads the PR, its open items and live CI, gathers evidence and drafts a ruling reply for every item a human must settle, then asks once - post the rulings, apply any CI fix, run nax bot review then nax bot fix (with an optional profile or model) - and runs it all; nax bot fix re-reviews its own push and marks the draft ready once every item is settled and CI is green. Skips the ask only when the user explicitly says auto-approve. When the feature has no PR yet, runs the repo-root gates with nax gates run and opens one. For a draft published before nax 0.91.2 (no item index), records rulings with nax workflow record and promotes with nax workflow promote. Triggers: "finish this nax feature", "what is open on this nax PR", "nax-finish workflow draft", "/nax-finish <feature>".
---

# nax-finish

nax finishes its own PRs. Inside `nax run`, workflow mode reviews the branch, repairs a failing CI run (`workflow.ciRepairRounds`, default 1) and publishes the PR, opening one nax bot thread per item a human must settle. A collaborator settles an item by replying on its thread. `nax bot review` records those rulings; `nax bot fix` fixes agreed findings, pushes, re-reviews its own push and marks the draft ready once every item is settled and CI is green on the head.

This skill drives that to the end: **read everything, prepare every ruling, ask once, run.** It never re-reviews the branch itself, re-runs acceptance, writes rulings into files by hand, or marks a workflow PR ready itself (sole exception: a repo with no CI, after the user waives CI by name; see `CI no-checks` in Step 3).

**Announce at start:** "Using nax-finish on `<feature>`: read PR and items -> one approval -> rulings + nax bot review/fix." When the feature has no PR yet: "Using nax-finish on `<feature>`: gates -> one approval -> open PR/MR + nax bot review."

## The one approval

Everything up to the approval is read-only and runs without asking: resolving, status, PR/CI reads, reading code and logs, running tests and `nax gates run`. Do not stop to ask the user how to rule on an item, which item to look at first, or whether to keep going; decide from the evidence and put the result in the plan.

Then ask **one** question (Step 4) that covers every write: posting ruling replies on the PR, a hand fix for red CI or a red gate (commit + push), `nax bot review`, `nax bot fix`, and the profile or model to run them with. `nax bot review` / `fix` are billed agent sessions and `fix` pushes, so they are part of this approval, never launched without it.

**Auto-approve:** skip the question only when the user explicitly said so in this request (`auto`, `auto-approve`, `don't ask`, or similar). Never infer it from an earlier request or session. With auto-approve, run the plan as written with no `--profile`/`--model` unless the user named one, and still print the plan before running it.

After the approval, run the whole plan without further questions. Ask again only when something outside the plan comes up: a new red CI cause, a merge conflict, a refusal from nax, or a ruling the evidence does not support.

**nax version.** This file is for nax >= 0.91.3 (`nax --version`): earlier versions do not re-review after `nax bot fix` pushes. On an older nax, say so and ask the user to upgrade. This skill does not handle pipeline-mode escalated finish artifacts (`finish-audit/`) or run acceptance tests: workflow mode turns acceptance off, and pipeline mode is frozen.

Run every `nax` command from `repoRoot` (the directory holding `.nax/`), or pass `-d <repoRoot>`.

**Long commands.** `nax bot review` and `nax bot fix` run agent sessions, and `fix`'s ready pass also waits for CI (`workflow.timeouts.ciWaitMs`, default 20 minutes). Run them in the background (or with the longest tool timeout) and wait for the exit; a tool timeout is not a nax failure and never a reason to launch the command again.

## Step 1: Resolve the feature

`args` is the text after `/nax-finish` (may be empty). When it names a PR/MR (number or URL) rather than a feature, find the feature whose `.nax/features/*/workflow/*/result.json` has that `featureWorkflow.url`; if none matches, ask.

```bash
nax features resolve "<args>" --json
```

Branch on `status`: `ok` -> record `featureName`; `ambiguous` (or `feature-not-found` with `candidates`) -> list the candidates, ask, re-run with the pick; `missing` / `feature-not-found` with no candidates -> show `checked` and ask; `not-a-nax-repo` -> tell the user this is not a nax repo (no `.nax/config.json`; run nax-setup first) and stop.

**Preflight.** `git fetch origin`, detect the base (`git remote show origin | grep 'HEAD branch'`, fallback `main`, then `master`), and run `git rev-list --count origin/<base>..HEAD`. `0` -> print `<featureName> is 0 commits ahead of <base> — already merged / nothing to finish.` and stop unless the user says to go on.

## Step 2: Read the run

```bash
nax workflow status -f <featureName> --json
```

Exit `0` = ready with nothing open, `2` = something needs a human, `1` = error (`{"error": …}`). Branch:

- **Exit `1` with `no workflow result for feature …` or `… has not started its feature steps`** -> no workflow run: go to Step 6.
- **`outcome` absent, `local-only` or `pushed`** -> no PR yet: go to Step 6 (say which).
- **`outcome` `draft` or `ready` with a `url`** -> Step 3.
- Any other error -> report it and stop.

## Step 3: Read the PR and prepare every item

Gather:

1. **PR state and head:** `gh pr view <url> --json number,isDraft,headRefOid,url,mergeable` (GitLab: `glab mr view <iid>`).
2. **Live CI on the head:** `gh pr checks <url> --json name,state,bucket,link` (GitLab: `glab ci status --branch <branch>`). `pass`/`skipping` green, `fail`/`cancel` red, `pending` pending. The status JSON's `ci` is a publish-time snapshot; trust the live read.
3. **Open items:** `openItems` from Step 2, each with its id, kind, severity, `file:line`, issue, suggestion and any advisor ruling, plus `supplementaryItems` (not blocking). Confirm each is still live on the PR: an item whose thread's last nax bot comment is a `Recorded: …` echo with no later reply from a writer is settled (a later writer reply reopens it).
4. **Item index:** a top-level nax bot comment ending in `<!-- nax-bot:v1 key=w-index -->`:
   ```bash
   gh pr view <url> --json comments --jq '[.comments[].body | select(contains("key=w-index -->"))] | length'
   glab api --paginate "projects/:id/merge_requests/<iid>/notes?per_page=100" | grep -c 'key=w-index -->'
   ```
   **No index** (published before nax 0.91.2, or item posting failed at publish) -> **open `references/legacy-draft.md` now and follow it** instead of Steps 4-5.

If nothing is open, CI is green and the PR is ready, report it clean with the head sha and stop.

Then work every open item into a planned action. Only the evidence decides; do not ask the user per item.

| Item | Planned action |
|:--|:--|
| `finding`, or a `story` whose gap is code | **Leave to `nax bot fix`**: it works every open item thread and `fix`'s own re-review records `fixed`. A finding that names a missing test is fixed only when that test exists and passes. |
| `advisor` / `ruling` | Verify the premise: "already fixed by `<sha>`" -> `git show <sha>`, read `file:line`, run the named or nearest test; "out of scope" -> find the spec or PRD line; `waive` -> confirm the risk is the one described, no larger. Draft `confirm: <evidence>` or `override: <reason>`. `defer` is not a ruling: no later step remains, so plan a fix (leave to bot) or a `waive: <reason>`. |
| `cannot-verify` / already-fixed | Run the commands or read the code paths the text names. Checked -> draft `verified: <evidence>`. Not checkable here -> draft `waive: <why it cannot be checked>` and flag it in the plan. |
| `gate` | Reproduce with `nax gates run --gate <name> --json`, find the cause, plan the hand fix. After it is pushed, the reply is `fixed <sha>` (bot fix may try a code fix, but only a reply or the next publish settles a gate item). |
| `story` that is out of scope or accepted as is | Draft `waive: <reason>` citing the spec or PRD. |
| **Red CI on the head** (not an item; it gates readiness) | `nax run` spent its repair rounds and `nax bot fix` does not repair CI. Read the failing job's log (`gh run view <run-id> --job <job-id> --log-failed`, ids in the check's `link`; GitLab: the job trace), find the root cause, plan the hand fix. Re-run a job only for a proven infrastructure flake. |
| `CI conflicting` (merge conflicts with the base) | Plan a rebase or merge of the base. Never ready a conflicting PR. |
| `CI no-checks` (the repo has no CI) | `nax bot fix` can never ready it. Plan: settle every item, then the user waives CI by name and you mark it ready by hand (`gh pr ready <url>` / `glab mr update <iid> --ready`). |

Ruling replies are read by keyword on their first line: `fixed <sha>` (7-40 hex, optional reason after ` — `, ` - ` or `: `), `waive: <reason>`, `confirm[: <reason>]`, `override: <reason>`, `verified[: <reason>]`. A later reply replaces an earlier ruling. Only a collaborator with write access rules; a reply posted with the user's own `gh`/`glab` login counts when that login has write access. Check it here (`gh api repos/{owner}/{repo}/collaborators/<login>/permission --jq .permission` must be `write`, `maintain` or `admin`; GitLab: Developer or higher); if it is lower, nax silently drops the replies, so say so in the plan and hand the drafts to someone who can post them.

To prove a test catches a defect, run it against the pre-fix commit in a throwaway `git worktree`, never with `git stash` in the live tree.

## Step 4: Ask once

Print the whole picture in one block, then ask (skip the question only on explicit auto-approve):

```
PR <url> · draft · head <sha7> · CI <green|red: names|pending>
Open items (N):
  D-1  advisor  <issue>            -> post "confirm: read 4f2e1aa store.ts:88; store.test.ts green"
  B3   finding  <file:line> <issue> -> nax bot fix
  G-1  gate     lint               -> hand fix (<cause>), push, post "fixed <sha>"
CI:  check:e2e red (<root cause>)  -> hand fix, push
Also to verify (not blocking): ...
Plan: hand fixes + push -> post 2 rulings -> nax bot review <n> -> nax bot fix <n>
Run it? Profile or model for nax bot (default: project config)?
```

Accepted answers: approve as is, approve with `--profile <name>` and/or `--model <value>` (both apply to review and fix), change individual rulings, or stop. If the user changes a ruling, apply the change and run; do not re-ask.

## Step 5: Run the plan

In this order, without further questions:

1. **Hand fixes** (red CI, red gate, conflicts): before any commit, `git status --porcelain` must be clean apart from your fix, and you must not be on the base branch (`references/open-pr-mr.md` 7b). Commit with a conventional message, push. For a CI fix, wait for the new head at most about 15 minutes (`gh pr checks <url> --watch --fail-fast`); if it is still red, report the new cause and ask.
2. **Post the rulings** as replies on each item's thread (its first line reads `Open item **<id>** (<kind>): …`), plain text, first line the keyword:
   ```bash
   # GitHub: item threads are review comments; reply to the opener
   gh api "repos/{owner}/{repo}/pulls/<n>/comments" --paginate \
     --jq '.[] | select(.in_reply_to_id == null and (.body | contains("Open item **<id>**"))) | .id'
   gh api -X POST "repos/{owner}/{repo}/pulls/<n>/comments/<comment-id>/replies" -f body='confirm: <evidence>'
   # GitLab: find the discussion whose first note is the opener, then add a note
   glab api "projects/:id/merge_requests/<iid>/discussions?per_page=100"
   glab api -X POST "projects/:id/merge_requests/<iid>/discussions/<discussion-id>/notes" -f body='confirm: <evidence>'
   ```
   A republish can leave older, closed openers for the same id. Reply only on the opener whose `<!-- nax-bot:v1 key=w-<id>.<hash> -->` key is listed in the item index and whose thread is unresolved, and post exactly one reply per item. On GitHub Enterprise or self-hosted GitLab, pass `--hostname <host>` to `gh api` / `glab api`.
3. **Review once:** `nax bot review <n> [--profile …] [--model …]`. It records the rulings (echoing `Recorded: …` on each thread), re-checks earlier findings and answers threads. It is required before fix: fix refuses when the head has no review.
4. **Fix once:** `nax bot fix <n> [--profile …] [--model …]`. When it pushes, it waits for the new head, re-reviews it and runs the ready pass itself. **Never run `nax bot review` again after `fix`**; that review already ran.

Read the output:

- `nax bot fix: PR #<n> — pushed <sha>` or `nothing to fix`, then, after a push, the chained `nax bot review: …` line and `nax bot fix: ready pass — Marked ready.` / `Kept as draft: <reason>`. After `nothing to fix`, read the readiness from the nax bot summary comment on the PR (one comment, edited in place).
- `Kept as draft: CI pending: …` -> the ready pass already waited for CI. Run `nax bot fix <n>` one more time (same approval) only when that output said `nothing to fix`, or its chained review line said `0 findings posted`; then it is a pure readiness check. Otherwise report the pending CI and stop. This is the only second `fix` the skill ever runs.
- `Kept as draft: <n> open item(s): <ids>` -> those items still need a ruling the evidence could not supply, or fix could not close them: report each with what is missing and stop. Do not loop review/fix.
- `PR head did not reach … within 60 s; run nax bot review <n>` or `cost limit reached; …` -> run the one command it names (same approval), once.
- After `pushed <sha>`, a chained review that did not post (its reason on stderr, no ready-pass line) -> report it and stop; run `nax bot review <n>` by hand only when the output names that command.
- `CI failed: …` -> a new red CI cause: report it and ask (Step 3's red-CI row).
- **Exit `1`:** bad input (PR number, `--model`) or a nax error: report it and stop.
- **Exit `2`:** reason on stderr (for fix often just an outcome word such as `gates-failed`, `baseline-red`, `no-change`, `push-rejected`, `cost-limit`; the nax bot `fix-summary` comment on the PR carries the explanation, so read and report it). `untrusted PR: …` and `head branch is in another repository` are refusals by design; `no check commands found on the base branch; …` needs `quality.commands` merged to the base first; `callOp[…]: no dispatch completed` usually means missing agent credentials (`nax auth list`). Report and stop.

Re-read Step 3's PR state once at the end and show what changed. Leave the branch pushed.

## Step 6: No PR yet

The feature has no workflow PR (no workflow run, `local-only`, or `pushed`).

1. **Gates (no ask):** `nax gates run --json` from `repoRoot`. Exit `0` = every gate passed; `2` = a gate is `failed`, `not-run` (exit 127/126: a broken tool or command, never a pass), `timed-out`, or nothing is configured (`gates: []`, which verifies nothing); `1` = nax could not run them (`Project not trusted: <dir>` carries the grant command: show it, never grant trust yourself). For a red gate, find the cause and plan the fix. Never run `formatFix`/`lintFix` as a gate; a formatter write is a proposed fix.
2. **Prepare the PR/MR (no ask):** **open `references/open-pr-mr.md` now** and prepare everything it describes: platform, branch, working-tree state, template, title and body, existing PR.
3. **Ask once** (Step 4's rules, auto-approve included): gate fixes, commit of the listed working-tree changes, push, open (or promote) the PR/MR with the shown title and body, then `nax bot review <n>` and `nax bot fix <n>`, with an optional profile or model. The user may approve the review alone.
4. **Run** it in that order, review once and fix once, reading the output as in Step 5.

## Final summary

One line the user can scan, reflecting what actually happened:

```
nax-finish: <feature> — PR <url> ready · items 4/4 settled (2 fixed, 1 waived, 1 confirmed) · CI green on <sha7>
nax-finish: <feature> — PR <url> still draft · kept: 1 open item(s): D-1 (needs your ruling: <why>) · CI green on <sha7>
nax-finish: <feature> — PR opened <url> · gates PASS · nax bot review posted 2 findings
```

Name any waived gate, check or item explicitly; never imply a clean pass.

## Common mistakes

| Mistake | Do instead |
|:--|:--|
| Asking the user how to rule on each item, or pausing between steps | Gather evidence, draft every ruling, ask once (Step 4) |
| Running `nax bot review` again after `nax bot fix` | fix re-reviews its own push (nax >= 0.91.3); run review once, before fix |
| Re-launching review or fix after a tool timeout | Run them in the background and wait for the exit |
| Looping review/fix until the PR is ready | One review, one fix; report what still holds the draft |
| Launching `nax bot review` / `fix` without the approval | They are billed and fix pushes: they are part of the one approval unless the user said auto-approve |
| Treating auto-approve as implied | Only an explicit word in this request counts |
| Re-running a full review or acceptance on a workflow PR | The run reviewed the branch; `nax bot review` covers what came after |
| Writing rulings into `decisions-*.json`, ticking the checklist or marking a workflow PR ready by hand | Rulings are thread replies; `nax bot fix` readies the PR (legacy drafts: `nax workflow record` / `promote`; no-CI repos: by hand only after the user waives CI by name) |
| Confirming an advisor decision on its own rationale | Verify the premise (commit, code, test) and put the evidence in the reply |
| Treating the status JSON's `ci` as live | Read the live checks on the current head |
| Expecting `nax bot fix` to repair CI | Fix CI from the log as part of the plan |
| Pushing with a dirty tree or to the base branch | `git status --porcelain` first; branch off the base (`references/open-pr-mr.md` 7b) |
