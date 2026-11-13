---
name: nax-diagnose
description: Use when a nax run has failed, stalled, crashed, or produced unexpected results and you need to find the root cause.
---

# nax-diagnose

Diagnose a failed nax run by reading its artifacts from disk. Print a structured root-cause report.

**Announce at start:** "Using nax-diagnose to diagnose `<feature>` in `<project>`."

## Step 0: Resolve project, repo, and feature

`args` is what the user typed — usually a project name, a feature name, or both. Resolve all three before reading anything; the cwd may be a subdirectory or an unrelated repo, and the artifact root is a configured path, not `basename $PWD`.

`GLOBAL_DIR` = `$NAX_GLOBAL_CONFIG_DIR` if set, else `~/.nax`.

**Project → repo (preferred path).** Each project has an identity file naming its checkout:
```bash
cat "$GLOBAL_DIR/<name>/.identity"      # → { "name", "workdir", ... }
```
`PROJECT_KEY` = that directory name, `REPO_ROOT` = its `workdir`. If `<name>` has no identity file, grep all of them for a near match:
```bash
grep -H '"workdir"' "$GLOBAL_DIR"/*/.identity      # every project and its checkout
```

**No project named** — walk up from cwd for `.nax/config.json` (this is nax's own `findProjectDir`):
```bash
d=$PWD; while [ "$d" != "/" ] && [ ! -f "$d/.nax/config.json" ]; do d=$(dirname "$d"); done
```
Then `PROJECT_KEY` = `name` from `$d/.nax/config.json`, else `basename $d`. If the walk finds nothing, list the identities above and ask which project — never guess.

**`OUTPUT_DIR`** = `outputDir` from `$REPO_ROOT/.nax/config.json`, else from `$GLOBAL_DIR/config.json` (absolute or `~/`-prefixed), else `$GLOBAL_DIR/$PROJECT_KEY`.

**Feature** — from `args`, else:
```bash
(cd "$REPO_ROOT" && nax features resolve "<args>" --json)   # <args> may be empty
```
Take `featureName` on `ok` or `missing` (a missing *spec* is fine — diagnosis reads `prd.json`). On `ambiguous`/`feature-not-found` with candidates, ask which. With no candidates, stop. If the command isn't JSON (older nax), `ls "$REPO_ROOT/.nax/features/"` and apply the same rules.

Print the resolved roots, then proceed:
```
Project koda   Repo /home/me/work/koda   Out ~/.nax/koda   Feature graphify-kb
```

## Artifact layout

Two roots, not interchangeable. Use these variables — never a cwd-relative path:

| Location | What lives here |
|:---------|:----------------|
| `$OUTPUT_DIR/features/<feature>/` | `status.json`, `runs/` (logger JSONL) |
| `$REPO_ROOT/.nax/features/<feature>/` | `prd.json`, `sessions/` |
| `$REPO_ROOT/.nax/features/<feature>/workflow/<runId>/` | Workflow run: `ledger.md`, `result.json`, `branch-review.json`, `feature-report.md`, and one `<storyId>/` dir per story (`brief.md`, `report.md`, `review.json`) |
| `$GLOBAL_DIR/events/$(basename "$REPO_ROOT")/events.jsonl` | Run lifecycle events |
| `$OUTPUT_DIR/prompt-audit/<feature>/` | Prompt audit (opt-in; `config.agent.promptAudit.dir` overrides) |

> Events are keyed on `basename(REPO_ROOT)`, **not** `PROJECT_KEY` — under a `name` override the two directories differ legitimately. Don't "correct" one to match the other.

## Step 1: Status

```bash
cat "$OUTPUT_DIR/features/<feature>/status.json"
```
Extract: `run.status` · `run.startedAt`/`completedAt`/`crashedAt` · `run.crashSignal` (15=SIGTERM, 9=SIGKILL) · `progress.{passed,failed,pending,blocked}` · `current` · `cost.spent`/`cost.limit` (flag if spent ≥ limit) · `workflow.step` · `workflow.outcome`/`url`/`passed` · `workflow.stories.<id>.{state,round}`.

`nax workflow status -f <feature> -d "$REPO_ROOT" --json` prints the newest workflow run's outcome, its PR/MR URL and the open items (no step or per-story state). It exits `2` whenever the feature is not `ready` with nothing open, so exit 2 means "needs a human", not a crash.

Missing file → suspect resolution before crash. If `ls "$OUTPUT_DIR/features/"` shows other features the root is right and the run truly wrote nothing (`[WARN] status.json not found — check events and session descriptors`). If it's empty, re-resolve Step 0 and say which root you tried.

## Step 2: Per-story state

Per story, take `state` and `round` from `status.json` → `workflow.stories.<id>` (end states: `complete`, `complete-with-rulings`, `complete-gate-open`; `round` = story fix rounds used), and `title`, `status`, `dependencies` from the PRD:
```bash
cat "$REPO_ROOT/.nax/features/<feature>/prd.json"
```
```
US-001  "Implement search index"  failed               round 5  [same 2 items open since round 3]
US-002  "Add query endpoint"      blocked              -        [waiting on US-001]
US-003  "Wire CLI flag"           complete-gate-open   round 1
```
Workflow fix rounds are not recorded in the PRD's `attempts`/`escalations`/`priorErrors` (they stay empty); the round-by-round history is in `ledger.md` (Step 3). Print each failed story's last ledger line below the table.

## Step 3: Sessions and workflow progress

```bash
ls  "$REPO_ROOT/.nax/features/<feature>/sessions/"
cat "$REPO_ROOT/.nax/features/<feature>/sessions/<sessionId>/descriptor.json"
```
Pull `id`, `role`, `state`, `storyId`, `lastActivityAt`. Terminal states are `COMPLETED`/`FAILED`; flag `FAILED` sessions and `RUNNING` ones idle >60s.

Then read the newest workflow run directory. `ledger.md` is the run's step-by-step log, one line per story transition plus `_run:` lines for the repo gates, branch review and branch fix:
```bash
W=$(ls -td "$REPO_ROOT/.nax/features/<feature>/workflow/"*/ | head -1)
cat "$W/ledger.md"
```
Look for a story stuck in `fix round N/M` with the same open items each round, `DONE_WITH_CONCERNS` from the implementer, and `_run: repo gates red: <gate>` (written after the stories finish, before the branch review and branch fix; check the later `_run:` lines and `workflow.passed` to see whether the fix turned it green). For a failed story read `$W/<storyId>/report.md` (the implementer's report) and `$W/<storyId>/review.json` (the story review's open findings); for a branch-level failure read `$W/branch-review.json`.

## Step 4: Run timeline

```bash
grep "<feature>" "$GLOBAL_DIR/events/$(basename "$REPO_ROOT")/events.jsonl" | tail -20
```
Events: `run:started`, `story:started|completed|failed`, `run:completed`, `run:paused`. No `run:completed` = crashed mid-flight; a `story:started` with no terminal partner = stuck story.

```bash
ls -t "$OUTPUT_DIR/features/<feature>/runs/" | head -3
tail -30 "$OUTPUT_DIR/features/<feature>/runs/<runId>.jsonl"
```
Look for error-level entries near the end, and exit codes: 124 = timeout, 134 = SIGABRT (Bun JSC crash), 132 = SIGILL.

## Step 5: Audits (only if asked)

Skip unless the user asked for a prompt audit.

**Prompt audit** — `<runId>.jsonl` files named by the workflow run id (the same id as the `workflow/<runId>/` directory, not `status.json` → `run.id`). From the last entry print `ts`, `stage`, `storyId`, `callType`, `turn`, `durationMs` (>60000 suggests agent timeout), and `errorCode`/`errorMessage` on error entries. Nothing there → likely disabled (`config.agent.promptAudit.enabled`).

Review findings of a workflow run are not in a separate audit: read `$W/<storyId>/review.json` (story review) and `$W/branch-review.json` (branch review).

## Step 6: Report

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NAX DIAGNOSIS: <feature>
Project: <project>  Run: <run.id or "unknown">
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RUN STATUS: <status>  [<startedAt> → <completedAt or "—">]
Stories: <passed> passed · <failed> failed · <pending> pending · <blocked> blocked

STORY STATE
────────────────────────────────────────
<table from Step 2>

FAILURE SUMMARY
────────────────────────────────────────
<one finding per line, severity-prefixed>

RECOMMENDED ACTIONS
────────────────────────────────────────
<actionable next steps>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Prefix | Meaning |
|:-------|:--------|
| `[CRASH]` | Killed by signal — check system resources |
| `[BLOCKED]` | Blocked by a failed dependency — fix that story first |
| `[STALLED]` | Session FAILED, or RUNNING with stale activity — check agent timeout |
| `[FAILED]` | Story used all its fix rounds, or ended `complete-gate-open` — read its ledger lines and `review.json` |
| `[REVIEW]` | Review anomaly — findings that never close across rounds, or a branch review that blocks the run |
| `[COST]` | Stopped at cost limit — raise `cost.limit` |
| `[PRECHECK]` | Precheck failed — dirty git, missing build tools, lockfile |
| `[WARN]` | Non-blocking, worth noting |

## Common failure patterns

| Indicators | Action |
|:-----------|:-------|
| `durationMs > 60000`, session `FAILED` | Agent timeout — retry with a `--profile` giving longer timeout or a stronger tier |
| `run.status: precheck-failed`, no `story:started` | Check `git status`, build tools, and that the test command runs standalone |
| `run.crashSignal` set, no `run:completed` | Check for OOM; re-run `nax run -f <feature>` (stories already `passed` in the PRD are skipped) |
| Many `blocked` stories, one root `failed` | Fix the root; the rest unblock on retry |
| Story at its last `fix round` in `ledger.md`, same items open each round | Read `<storyId>/review.json` — a finding that never closes usually means the spec or AC is wrong, not the code |
| `_run: repo gates red: <gate>` in `ledger.md`, `workflow.passed` not true | The branch fix did not turn the gate green; run that gate's command from `.nax/config.json` in the repo |
| `cost.spent >= cost.limit` | Raise `config.cost.limit` or trim prompts |
| Empty `$OUTPUT_DIR`, "nothing ever ran" | Wrong root — re-resolve Step 0 against the `.identity` files before concluding this |
