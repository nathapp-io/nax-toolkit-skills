---
name: nax-finish
description: Show where a nax feature's PR/MR stands and take it the rest of the way through nax's own commands. Resolves the feature, reads the workflow run with nax workflow status, shows the PR, its open items and live CI, explains how a collaborator rules on an item by replying on its nax bot thread, and on explicit approval runs nax bot review then nax bot fix, which record the rulings and mark the draft ready once every item is settled and CI is green. When the feature has no PR yet, runs the repo-root gates with nax gates run and opens one on approval. For a draft published before nax 0.91.2 (no item index), records rulings with nax workflow record and promotes with nax workflow promote. Triggers: "finish this nax feature", "what is open on this nax PR", "nax-finish workflow draft", "/nax-finish <feature>".
---

# nax-finish

nax finishes its own PRs now. Inside `nax run`, workflow mode reviews the branch, repairs a failing CI run (`workflow.ciRepairRounds`, default 1) and publishes the PR, opening one nax bot thread per item a human must settle. A collaborator settles an item by replying on its thread, and `nax bot review` + `nax bot fix` record those rulings and mark the draft ready once every item is settled and CI is green on the head.

This skill is the short helper on top: **here is the PR, here is what is open, here is how it gets settled**. It runs nax's commands; it never re-reviews the branch, re-runs acceptance, writes rulings into files by hand, or marks a PR ready itself.

**Announce at start:** "Using nax-finish on `<feature>`: status -> PR and open items -> rulings -> nax bot review/fix." When the feature has no PR yet: "Using nax-finish on `<feature>`: gates -> open PR/MR."

**Approval.** `nax bot review` and `nax bot fix` are billed agent sessions, and `nax bot fix` pushes to the PR branch. Ask before each launch, naming the command. Every code change, commit, push and forge write in this skill also needs explicit approval.

**nax version.** This file is for nax >= 0.91.2 (`nax --version`). On an older nax, say so and ask the user to upgrade; this skill no longer carries the older paths. It no longer handles pipeline-mode escalated finish artifacts (`finish-audit/`) or runs acceptance tests: workflow mode turns acceptance off, and pipeline mode is frozen.

Run every `nax` command from `repoRoot` (the directory holding `.nax/`), or pass `-d <repoRoot>`.

## Step 1: Resolve the feature

`args` is the text after `/nax-finish` (may be empty). When it names a PR/MR (number or URL) rather than a feature, find the feature whose `.nax/features/*/workflow/*/result.json` has that `featureWorkflow.url`; if none matches, ask.

```bash
nax features resolve "<args>" --json
```

Branch on `status`: `ok` -> record `featureName`; `ambiguous` (or `feature-not-found` with `candidates`) -> list the candidates, ask, re-run with the pick; `missing` / `feature-not-found` with no candidates -> show `checked` and ask; `not-a-nax-repo` -> tell the user this is not a nax repo (no `.nax/config.json`; run nax-setup first) and stop. The spec is not read here; read it only when an item needs it.

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

## Step 3: Show the PR and what is open

Gather, then print in one block:

1. **PR state and head:** `gh pr view <url> --json number,isDraft,headRefOid,url` (GitLab: `glab mr view <iid>`).
2. **Live CI on the head:** `gh pr checks <url> --json name,state,bucket,link` (GitLab: `glab ci status --branch <branch>`). `pass`/`skipping` green, `fail`/`cancel` red, `pending` pending. The status JSON's `ci` is a publish-time snapshot; trust the live read.
3. **Open items:** `openItems` from Step 2, grouped by kind, each with its id, severity, `file:line`, the full issue, the suggestion and any advisor ruling. Do not truncate. Then `supplementaryItems` under "Also to verify (not blocking)".
4. **Does the PR carry the item index?** It is a top-level nax bot comment ending in `<!-- nax-bot:v1 key=w-index -->`:
   ```bash
   gh pr view <url> --json comments --jq '[.comments[].body | select(contains("key=w-index -->"))] | length'
   glab api "projects/:id/merge_requests/<iid>/notes?per_page=100" | grep -c 'key=w-index -->'
   ```
   - **Index present** -> the rulings live on the PR: Steps 4-5.
   - **No index** (published before nax 0.91.2, or item posting failed at publish) -> **open `references/legacy-draft.md` now and follow it** instead of Steps 4-5. `nax bot fix` holds such a PR with `no nax item index on this PR`.

If nothing is open, CI is green and the PR is ready, report it clean with the head sha and stop. A ready PR with open items or red CI is not clean: say so, and carry on to Step 4.

## Step 4: Settle the items

Only a collaborator with write access rules. A reply from anyone else (a PR author without write access, other bots) is conversation, never a ruling. Resolving a thread without replying does not rule.

**How to rule:** reply on the item's thread (its first line reads `Open item **<id>** (<kind>): …`). A reply whose first line starts with a keyword is read directly:

| Reply | Records |
|:--|:--|
| `fixed <sha>` (7-40 hex), optional reason after ` — `, ` - ` or `: ` | `fixed` at that commit |
| `waive: <reason>` / `waived: <reason>` | `waived` (reason required) |
| `confirm` / `confirmed`, optional `: <reason>` | `confirmed` (advisor ruling upheld) |
| `override: <reason>` / `overridden: <reason>` | `overridden` (advisor ruling reversed; reason required) |
| `verified` / `verify`, optional `: <reason>` | `verified` (cannot-verify or already-fixed item) |

Any other collaborator reply is read by one model call and recorded only when its meaning is clear; otherwise nax bot asks in the thread. nax bot echoes each ruling it records (`Recorded: …`); a later reply replaces the earlier ruling. nax bot itself can only ever record `fixed`, and only `nax bot review` does so, when it re-checks an item after a push.

The user writes the replies on the PR. Your job is to make each ruling well-founded before it is written:

- **Advisor decisions** (`advisor` and `ruling` items): verify the premise first. "already fixed by `<sha>`" -> `git show <sha>`, read the code at `file:line`, run the named or nearest test. "out of scope" -> find the spec or PRD line. `waive` -> confirm the risk is the one described, no larger. `defer` is not resolved: no later step remains, so it needs a fix or an explicit waive now.
- **Cannot-verify items:** actually run the commands or read the code paths the text names, and give the evidence to put in the `verified: <reason>` reply. If it cannot be checked here, say so; the user may waive it.
- **Findings** (`finding`): either leave them to nax bot (Step 5: `nax bot fix` pushes the fix, the next `nax bot review` records `fixed`), or fix by hand on approval: commit, push, then the user replies `fixed <sha>`. A finding whose suggestion names a missing test is not fixed until that test exists and passes.
- **Red gate** (`gate`): reproduce with `nax gates run --gate <name> --json`, fix on approval, push; the user replies `fixed <sha>` (or the next workflow publish closes it). nax bot may attempt a code fix for any open item thread, but only a reply or the next publish settles a gate item.
- **Story** (`story`): read `<runDir>/<storyId>/` and the PRD for what is missing; fix it like a finding, or the user waives it.
- **Red CI on the head:** CI is not an item thread; it gates readiness directly. `nax run` already spent its repair rounds, and `nax bot fix` does not repair CI. Read the failing job's log (`gh run view <run-id> --job <job-id> --log-failed`, ids in the check's `link`; GitLab: the job trace), find the root cause before proposing anything, fix on approval, push, and wait for the new head at most about 15 minutes (`gh pr checks <url> --watch --fail-fast`). Re-run a job only for a proven infrastructure flake.

To prove a test catches a defect, run it against the pre-fix commit in a throwaway `git worktree`, never with `git stash` in the live tree.

Before any push, reconcile the tree and stay off the base branch (`references/open-pr-mr.md` 7b).

`CI conflicting` means the PR has merge conflicts with the base: resolve them (rebase or merge the base, on approval), push, and review again; never ready a conflicting PR. `CI no-checks` (the repo has no CI) can never go green, so `nax bot fix` never readies the PR: the only way out is the user waiving CI by name and marking the PR ready by hand (`gh pr ready <url>` / `glab mr update <iid> --ready`), on explicit approval, once every item is settled.

Hold judgments until the user has seen the whole list, and confirm the items are still live (some may have been fixed by hand since publish).

## Step 5: Run nax bot

On explicit approval, from `repoRoot`:

```bash
nax bot review <pr-number>     # records rulings, re-checks earlier findings, answers threads
nax bot fix <pr-number>        # fixes agreed findings and pushes; readies the draft once all is settled
```

Both take `--profile <name>` and `--model <value>`; `review` also takes `--decisions <path>`. Always review first: `nax bot fix` refuses with `no nax bot review of head <sha>; run nax bot review <n> first` when the head has moved since the last review, so any push (yours or a CI fix) needs a fresh review before fix. On a workflow PR whose head the branch review already covered, the review reads only the conversation and the commits pushed after publish.

Read the result:

- **Review exit `0`:** `… N findings posted, M threads answered …` plus the artifact path. A warning `no check commands found on the base branch; nax bot fix will refuse` means fix cannot run gates: report it.
- **Fix exit `0`:** `pushed <sha>` or `nothing to fix`. Either way, on a draft, it then applies the readiness rule: every indexed item settled and CI green on the head. After `pushed`, the items it fixed are still open (fix only replies `… Run nax bot review to check it.`), so the draft stays a draft: run `nax bot review` again, which records `fixed` for each item it confirms, then `nax bot fix`, which ends `nothing to fix` and readies the draft. On a PR that is already ready, fix reports nothing about readiness: use Step 3's live reads. Read its nax bot summary comment on the PR (one comment, edited in place each run): `Marked ready.` is done; `Kept as draft: <reason>` names what still holds it (`<n> open item(s): <ids>` -> after a push, review then fix again; otherwise back to Step 4; `CI pending: …` -> wait, then run `nax bot fix` again on the same head; `CI failed: …` -> Step 4's red-CI item; `CI conflicting: …` / `CI no-checks: …` -> Step 4's notes on those two).
- **Exit `1`:** bad input (PR number, `--model`) or an error nax threw: report it.
- **Exit `2`:** the reason is on stderr; when gates failed or the push did not land, the summary comment says so too. `untrusted PR: …` and `head branch is in another repository` are refusals by design; report them. `no check commands found on the base branch; …` needs `quality.commands` merged to the base first. `callOp[…]: no dispatch completed` usually means the agent has no credentials: check `nax auth list`.

Re-read Step 3 after each run and show what changed. Stop when the PR is ready, or when the user stops; leave the branch pushed.

## Step 6: No PR yet

The feature has no workflow PR (no workflow run, `local-only`, or `pushed`).

1. **Gates:** `nax gates run --json` from `repoRoot`. Exit `0` = every gate passed; `2` = a gate is `failed`, `not-run` (exit 127/126: a broken tool or command, never a pass), `timed-out`, or nothing is configured (`gates: []`, which verifies nothing); `1` = nax could not run them (`Project not trusted: <dir>` carries the grant command: show it, never grant trust yourself). Fix red gates on approval and re-run with `--gate <name>`, then a full run. Never run `formatFix`/`lintFix` as a gate; a formatter write is a proposed fix.
2. **Open the PR/MR:** **open `references/open-pr-mr.md` now and follow it**, on explicit approval.
3. **Review:** offer `nax bot review <pr-number>` on the new PR (approval, billed). It is the review for a feature nax's workflow did not review.

## Final summary

One line the user can scan, reflecting what actually happened:

```
nax-finish: <feature> — PR <url> ready · items 4/4 settled (2 fixed, 1 waived, 1 confirmed) · CI green on <sha7>
nax-finish: <feature> — PR <url> still draft · kept: 1 open item(s): D-1 · CI green on <sha7>
nax-finish: <feature> — PR opened <url> · gates PASS · nax bot review posted 2 findings
```

Name any waived gate, check or item explicitly; never imply a clean pass.

## Common mistakes

| Mistake | Do instead |
|:--|:--|
| Re-running a full review or acceptance on a workflow PR | The run reviewed the branch; `nax bot review` covers what came after |
| Writing rulings into `decisions-*.json`, ticking the checklist or marking the PR ready by hand | Rulings are thread replies; `nax bot fix` readies the PR (legacy drafts: `nax workflow record` / `promote`) |
| Running `nax bot fix` after a push without a new review | Review the new head first, or fix refuses |
| Confirming an advisor decision on its own rationale | Verify the premise (commit, code, test) and give the evidence |
| Treating the status JSON's `ci` as live | Read the live checks on the current head |
| Expecting `nax bot fix` to repair CI, record rulings, or ready the draft in the run that pushed | Fix CI from the log; after a push run review then fix again; gate items need a reply or the next publish |
| Treating a reply from someone without write access as a ruling | Only collaborators with write access rule |
| Launching `nax bot review` / `fix` unasked | Both are billed and `fix` pushes: ask at each launch |
| Pushing with a dirty tree or to the base branch | `git status --porcelain` first; branch off the base (`references/open-pr-mr.md` 7b) |
