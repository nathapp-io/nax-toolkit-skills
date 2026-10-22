# Legacy workflow draft: no item index (Step 3)

A workflow PR published before nax 0.91.2, or one whose item posting failed at publish, has no nax bot item index, so nobody can rule on it from the PR and `nax bot fix` holds it (`no nax item index on this PR`). Its rulings go through the local commands instead: `nax workflow record` writes them to the run's decisions sidecar, and `nax workflow promote` checks them and marks the PR ready. Never write or edit the sidecar, tick the checklist or post the evidence comment by hand.

Triage each item exactly as Step 4 says (verify advisor premises, give cannot-verify evidence, fix with approval). Only the recording differs: the user tells you the ruling, and you record it.

## Record the rulings

1. Write the rulings as a JSON **array** to a file outside the repo (your scratchpad), one entry per item:

   ```json
   [
     { "id": "B3", "kind": "finding", "disposition": "fixed", "reason": "Retry path fixed; named test added.", "sha": "a1b2c3d" },
     { "id": "D-1", "kind": "advisor", "disposition": "confirmed", "reason": "Read 4f2e1aa at store.ts:88; fix covers the finding; store.test.ts green." },
     { "id": "check:e2e", "kind": "ci", "disposition": "fixed", "reason": "429 from the fixture endpoint; stubbed; green on e5f6a7b.", "sha": "e5f6a7b" }
   ]
   ```

   - `kind`: the item's kind, except a `ruling` item is `advisor`. Live CI checks are `ci` (label `check:<name>`); supplementary items keep their own id and kind.
   - `disposition`: `fixed` (needs `sha`, 7-40 hex) | `waived` | `confirmed` | `overridden` | `verified`. Only `fixed` takes a `sha`.
   - `reason`: one non-empty line carrying the evidence.

2. Record, once triage is done and fixes are committed (do not defer this past the promote question: rulings made before an abandon are still worth keeping):

   ```bash
   nax workflow record -f <featureName> --decisions <file> --json
   ```

   Exit `0` prints `{ sidecar, outcome, decisions, unruled }`; rule on anything in `unruled` and run it again (entries merge by id). Exit `1` names the invalid entry: correct the file and re-run.

3. When the user stops instead of promoting: `nax workflow record -f <featureName> --outcome abandoned` (add `--decisions <file>` holding `[]` if `record` never ran for this run).

## Promote

Push first (`references/open-pr-mr.md` 7b), from the checkout whose `HEAD` is the pushed head.

1. **Dry run:** `nax workflow promote -f <featureName> --json`. Exit `0` = ready to promote. Exit `2`: `items-ruled` failed -> rule and `record`; `ci-green` failed with `ci pending` -> wait at most about 15 minutes and dry-run again; `ci failed` / `unavailable` -> fix as Step 4's red-CI item (a head mismatch means push first); `ci conflicting` -> merge conflicts with the base: resolve them, push, dry-run again (never promote a conflicting PR); `ci no-checks` -> no CI, see the hand-ready case below. Exit `1` is an error that wrote nothing (not a draft, no PR url, already ready): report it.
2. **On explicit approval:** `nax workflow promote -f <featureName> --yes --json`. It ticks the checklist, posts the evidence comment, marks the PR ready and records `promoted`. `promote stopped at <action>: <detail>` means a forge command failed and earlier actions stayed done: fix the cause and re-run `--yes` (a re-run may post a second evidence comment if the first went through; say so). If the PR turned ready but the sidecar write failed, run `nax workflow record -f <featureName> --outcome promoted`; do not run `promote` again.

**When `promote` cannot be used** (the user waives a red required check by name, or the repo has no CI at all, `no-checks`), and only with explicit approval: record the rulings first, mark the PR ready by hand (`gh pr ready <url>` / `glab mr update <iid> --ready`), then `nax workflow record -f <featureName> --outcome promoted`.

Do not refresh the PR body before promoting: the refresh deletes the checklist `promote` ticks.

The sidecar lives under `.nax/features/<feature>/workflow/`, which is git-ignored: leave it uncommitted and tell the user where it is.
