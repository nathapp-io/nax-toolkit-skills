# Older-nax fallbacks (manual resolution)

Degraded paths for an older nax that lacks `nax features resolve --json` (or lacks the `acceptance` block in its output), and for nax older than 0.89, which lacks `nax gates run` and `nax workflow status` / `record` / `promote`. Each fallback **mirrors the CLI's algorithm exactly**, so the result is identical to what the modern command would have produced. Only use these when the modern command is unavailable; the happy path in `SKILL.md` is the source of truth.

## Step 1 fallback — resolve the feature + spec source by hand

`nax features resolve` is **unavailable** when its stdout isn't JSON, or stderr shows `unknown command`. Say so once, then resolve by hand; first existing wins.

**If `args` looks like a path** (starts with `./`, `/`, or `~`, contains a `/`, or ends in `.md`/`.json`): use it directly as the spec source — markdown for a `.md`, PRD for a `prd.json`. (This is the route `nax-finish` itself takes when it re-invokes resolution with an already-resolved `specSource.path` such as `.nax/features/<name>/prd.json`.) If it doesn't exist, print `Error: spec not found at <path>` and stop.

**Otherwise treat `args` as a feature name** (if empty, discover first — below), set `featureName`, and search in this order:
1. `.nax/features/<name>/spec.md` — markdown
2. `.nax/specs/<name>.md` — markdown
3. `docs/specs/SPEC-<name>.md` — markdown, **exact filename only**. If that exact path does not exist, you may *list* `docs/specs/*<name>*.md` as candidates, but **never auto-accept a match** — not even a single one. A glob hit only means a filename shares a substring with the feature name; that is not evidence it is this feature's spec, and the path resolved here is handed to `post-impl-review`, which reviews the diff against whatever it is given. Print the candidates and ask the user to pick.
4. `.nax/features/<name>/prd.json` — PRD fallback
```bash
ls .nax/features/<name>/spec.md .nax/specs/<name>.md docs/specs/SPEC-<name>.md 2>/dev/null
ls docs/specs/*<name>*.md 2>/dev/null   # candidates to OFFER only — never auto-accept
ls .nax/features/<name>/prd.json 2>/dev/null
```
**If `args` is empty**, discover candidate features first, then resolve the chosen one via the ordered search above:
```bash
find .nax/features -maxdepth 2 -name prd.json 2>/dev/null   # completed features
find .nax/features -maxdepth 2 -name spec.md 2>/dev/null
```
Multiple → list numbered and ask the user to pick. Exactly one → use it **only if it corroborates the work you are finishing** (branch name matches the feature, or that feature's `.nax/features/<name>/` files appear in the branch's commits); a repo can hold a stale feature dir from unrelated earlier work. With no corroboration, name it and ask before using it.

**If no spec source resolves at all** (no markdown spec *and* no `prd.json`): **ask the user** rather than hard-stopping —
```
No spec or PRD found for "<name>". Checked:
  .nax/features/<name>/spec.md
  .nax/specs/<name>.md
  docs/specs/SPEC-<name>.md
  .nax/features/<name>/prd.json
Where is the spec? Paste a path, or press enter to abort.
```
Use the path the user provides (markdown spec). Abort only if they decline.

## Step 3 fallback — resolve the acceptance target(s) by hand

If the Step 1 output lacks an `acceptance` field (older nax `features resolve`, or you used the manual Step 1 fallback), resolve by hand. First check `acceptance.enabled` from config (Step 2); if `false`, skip the acceptance gate. Then:
- Single-package: `.nax/features/<featureName>/<acceptance.testPath>` — the nax convention places the generated acceptance test inside the feature directory, with the extension matching `project.language` (e.g. `.nax-acceptance.test.ts` for TS, `…test.py` for Python).
- Monorepo: the feature's stories may span **multiple packages**, and nax writes a **per-package feature directory** — the acceptance test lives at `<packageDir>/.nax/features/<featureName>/<acceptance.testPath>`, **not** in the root `.nax/features/<featureName>/` (the root dir holds only `spec.md` / `prd.json` / `acceptance-*.json` — no test file). The same feature name therefore appears under each package that contributes to it. **Discover every package the feature touches** with a recursive search rather than guessing — don't assume it lives in one place:
  ```bash
  # Find every per-package acceptance test for this feature (testPath from config; default _nax_acceptance_test.py / .nax-acceptance.test.ts)
  find . -path "*/.nax/features/<featureName>/<acceptance.testPath>" -not -path '*/node_modules/*' 2>/dev/null
  ```
  Run **each** match, honouring that package's `.nax/mono/<packageDir>/config.json` `acceptance.command`/`testPath` override. A feature spanning `packages/core`, `packages/backtester`, and `apps/api` yields three test files — all three must pass.

  **Run each match the way the runtime does — `cd` into its package first.** A per-package `acceptance.command` is authored **package-relative** (e.g. `bun vitest run --config .nax/vitest.acceptance.config.ts {{FILE}}`, where `.nax/` is `<packageDir>/.nax/`, **not** the root `.nax/`). So for a match at `<packageDir>/.nax/features/<featureName>/<testPath>`: spawn with **cwd = `<repoRoot>/<packageDir>`** and substitute the **absolute** file path for `{{FILE}}`. Run from `repoRoot` instead and you get `No test files found`, `Script not found "vitest"`, or a missing-config error — all of which mean *wrong cwd*, not a missing test. Match the runner to that **package's** language (the root `project.language` often differs); see the Step 3 failure-mode table in `SKILL.md`.
- If you cannot locate an acceptance test file for the feature, list where you looked (root feature dir **and** the recursive per-package search above) and ask the user for the path (or whether acceptance was generated at all) — do not silently skip.

## Step 6 fallback — run the gates by hand on nax < 0.89

Use this when `nax gates run` is not available (no JSON on stdout, or `unknown command`).

For each of `build`, `typecheck`, `lint`, `test`, `e2e` — skipping any whose command is unset, which is the only way a gate is off — in the order `nax gates run` uses (run `e2e`'s `e2eSetup` command first when one is configured):
```bash
<the exact command string from quality.commands.<gate>>
```
Run the **unscoped** commands (the full repo), not the `*Scoped` variants. Never run `formatFix`/`formatFixScoped`/`lintFix` as a gate (see Step 6 in `SKILL.md`). There is no `format` key in nax's `quality.commands` schema, and unknown keys are stripped rather than rejected, so a `format` entry in a config is silently ignored by nax itself — do not resurrect it as a gate here. Capture each exit code.

**Run each gate as its own command — one tool call per gate, the command string exactly as configured.** Never loop over the commands in one shell line: zsh does not word-split an unquoted `$cmd`, so every gate "runs" as a single missing command. Exit `127` (command not found) or `126` (not executable) means the gate **did not run** — not a pass, not a defect: fix the invocation and run it again, and never report it as run.

## Workflow draft on nax < 0.89 — read, record and promote by hand

Use this when `nax workflow status` is not available (no JSON on stdout, or `unknown command`): it replaces the "Reading the run", "Items `openItems` does not hold", "Recording the decisions" and "Promotion" sections of `resume-from-workflow-draft.md`. Its "Handling each kind", targeted review, ready-audit and "Steps 3-8" sections still apply. On nax >= 0.89, only the Promotion subsection below is used, and only for the three cases that file names (a red check waived by name, a repo with no CI, re-promoting after a ready audit).

**Start from the verdict, but never stop at it.** nax 0.88+ writes `result.verdict = { workflowPassed, outcome, reasons[], openItems[] }` (nested under `verdict`, not top-level). `verdict.openItems[]` is **partial**: it holds the open blocking findings, the branch review's cannot-verify items and red final gates — not advisor holds, fix-now minors, incomplete stories or CI. Read it first and use its `id`s (they are the `**<id>**` tokens in the PR body), then build the full union below. When `verdict` is absent (older nax), derive everything from the fields below. Every field in this document may be missing on an older nax — **fail soft**: use what is there and tell the user plainly what was missing (e.g. "no `url` in the result — will detect the PR by branch", "no ids in `branch-review.json` — matched findings by file:line").

### Locating the artifact

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

### The result contract

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

### Building the open-items list

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

### Recording the decisions (required in workflow-draft mode)

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

### Promotion

Step 7g promotes the existing draft on explicit approval, once the PR's checks are green on the pushed head. Record what was cleared in two places, both only on explicit approval:

1. **Tick the body checklist** — a targeted edit of the generated "Before marking ready" list, nothing else. When the body has no such list (a PR re-promoted after a ready audit), skip the tick and post only the comment.
   1. Read the body **immediately before writing** (another edit may have landed): `gh pr view <url> --json body -q .body`, or `glab mr view <iid> --output json`.
   2. nax renders each item as `- [ ] **<id>** (<severity>, <kind>) \`file:line\` — <issue>` (or `(<kind>)` alone with no severity; a gate as `- [ ] **<id>** (gate) — final gate <id> is red…`), possibly followed by indented `  Suggestion: …` and `  Advisor: …` lines. The body's kinds are `finding`, `ruling`, `cannot-verify` and `gate`. They differ from the sidecar's (`advisor`, `ci`), and your own labels may differ from nax's ids. So **match each line by the exact `**<id>**` token nax rendered** (`verdict.openItems[].id` in `result.json`, else the bold token in the body), never by the kind or severity text.
   3. Tick only that first line: `- [ ] **<id>**` → `- [x] **<id>**`, with ` — fixed in <sha>`, ` — verified`, ` — confirmed` or ` — waived: <reason>` appended at the end of that line, before any indented continuation lines.
   4. Write it back: `gh pr edit <url> --body-file <file>`, or `glab mr update <iid> --description …`.

   Leave an unresolved item unticked (it blocks promotion anyway). Never reword, reorder or delete any other line of the generated body. Items nax never put in the body (`ci`, trusted advisor decisions, re-review leftovers) go in the evidence comment only. When the list ends with `- …and N more`, the hidden items have no line to tick: report them in the comment and say so.
2. **Post one evidence comment** — `gh pr comment <url> --body-file <file>` or `glab mr note create <iid> -m …` (older glab: `glab mr note <iid> -m …`), headed `## Resolved before ready`. Write one line per item: label, kind, disposition, and the evidence (commit sha, the test command and its result, the CI run link, the verified premise of an advisor decision). It mirrors the decisions sidecar; one comment per finish pass, never one per item.
