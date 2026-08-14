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
| `$REPO_ROOT/.nax/features/<feature>/` | `prd.json`, `sessions/`, `stories/` |
| `$GLOBAL_DIR/events/$(basename "$REPO_ROOT")/events.jsonl` | Pipeline lifecycle events |
| `$OUTPUT_DIR/prompt-audit/<feature>/` | Prompt audit (opt-in; `config.agent.promptAudit.dir` overrides) |
| `$OUTPUT_DIR/review-audit/<feature>/` | Review audit (opt-in) |

> Events are keyed on `basename(REPO_ROOT)`, **not** `PROJECT_KEY` — under a `name` override the two directories differ legitimately. Don't "correct" one to match the other.

## Step 1: Status

```bash
cat "$OUTPUT_DIR/features/<feature>/status.json"
```
Extract: `run.status` · `run.startedAt`/`completedAt`/`crashedAt` · `run.crashSignal` (15=SIGTERM, 9=SIGKILL) · `progress.{passed,failed,pending,blocked}` · `current` · `postRun.acceptance.status` · `postRun.regression.status` · `cost.spent`/`cost.limit` (flag if spent ≥ limit).

Missing file → suspect resolution before crash. If `ls "$OUTPUT_DIR/features/"` shows other features the root is right and the run truly wrote nothing (`[WARN] status.json not found — check events and session descriptors`). If it's empty, re-resolve Step 0 and say which root you tried.

## Step 2: Per-story state

```bash
cat "$REPO_ROOT/.nax/features/<feature>/prd.json"
```
Per story pull `id`, `title`, `status`, `attempts`, `escalations`, `priorErrors`, `dependencies`:
```
US-001  "Implement search index"  failed   3 attempts  [escalated fast→balanced→powerful]
US-002  "Add query endpoint"      blocked  0 attempts  [waiting on US-001]
```
Print each failed story's last `priorErrors` entry below the table.

## Step 3: Sessions and stage progress

```bash
ls  "$REPO_ROOT/.nax/features/<feature>/sessions/"
cat "$REPO_ROOT/.nax/features/<feature>/sessions/<sessionId>/descriptor.json"
```
Pull `id`, `role`, `state`, `storyId`, `completedStages`, `lastActivityAt`. Terminal states are `COMPLETED`/`FAILED`; flag `FAILED` sessions and `RUNNING` ones idle >60s. Partial `completedStages` pinpoints the stalled stage.

Then, per failed story, which `context-manifest-<stage>.json` files exist (`context`, `execution`, `acceptance-setup`) — missing = never reached:
```bash
ls "$REPO_ROOT/.nax/features/<feature>/stories/<storyId>/"
```

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

Skip unless the user asked for prompt or review audit.

**Prompt audit** — `<runId>.jsonl` files correlating with `status.json` → `run.id`. From the last entry print `ts`, `stage`, `storyId`, `callType`, `turn`, `durationMs` (>60000 suggests agent timeout), and `errorCode`/`errorMessage` on error entries. Nothing there → likely disabled (`config.agent.promptAudit.enabled`).

**Review audit** — print `reviewer` (semantic/adversarial), `passed`, `blockingThreshold`, `advisoryFindings` count, and flag `parsed: false` (parse error, heuristic fallback) and `failOpen: true` (degraded, result unreliable).

> For cross-run **recurrence-demotion** telemetry (`advisoryFindings[].meta.coverageGap`) use the **nax-coverage-gap** skill — that asks whether demotion drops real bugs, distinct from this skill's single-run RCA.

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
| `[FAILED]` | Exhausted all escalation tiers — read `priorErrors` |
| `[REVIEW]` | Review audit anomaly — parse error, failOpen, advisory drops |
| `[COST]` | Stopped at cost limit — raise `cost.limit` |
| `[PRECHECK]` | Precheck failed — dirty git, missing build tools, lockfile |
| `[WARN]` | Non-blocking, worth noting |

## Common failure patterns

| Indicators | Action |
|:-----------|:-------|
| `durationMs > 60000`, session `FAILED` | Agent timeout — retry with a `--profile` giving longer timeout or a stronger tier |
| All 3 tiers in `escalations`, `status: failed` | Read `priorErrors` — a repeating identical error means the spec or test is wrong |
| `run.status: precheck-failed`, no `story:started` | Check `git status`, build tools, and that the test command runs standalone |
| `run.crashSignal` set, no `run:completed` | Check for OOM; retry `nax run -f <feature> --resume` |
| `parsed: false` in review audit | Usually transient — retry; if persistent, inspect model output in prompt audit |
| Many `blocked` stories, one root `failed` | Fix the root; the rest unblock on retry |
| `postRun.acceptance.status: failed` | Read `postRun.acceptance.failedACs` |
| `cost.spent >= cost.limit` | Raise `config.cost.limit` or trim prompts |
| Empty `$OUTPUT_DIR`, "nothing ever ran" | Wrong root — re-resolve Step 0 against the `.identity` files before concluding this |
