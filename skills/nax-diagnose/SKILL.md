---
name: nax-diagnose
description: Use when a nax run has failed, stalled, crashed, or produced unexpected results and you need to find the root cause.
---

# nax-diagnose

Diagnose why a nax run failed by reading its artifacts from disk. Print a structured root-cause report to the terminal.

**Announce at start:** "Using nax-diagnose to diagnose `<feature-name>` run failure."

---

## Artifact layout

nax writes artifacts to two locations. Know which is which before reading anything:

| Location | What lives here |
|:---------|:----------------|
| `~/.nax/<project>/features/<feature>/` | `status.json`, `runs/` (JSONL logger output) |
| `.nax/features/<feature>/` (project-local) | `prd.json`, `sessions/`, `stories/` |
| `~/.nax/events/<project>/events.jsonl` | Pipeline lifecycle events (global, flat file) |
| `~/.nax/<project>/prompt-audit/<feature>/` | Prompt audit (optional, if enabled) |
| `~/.nax/<project>/review-audit/<feature>/` | Review audit (optional, if enabled) |

**`<project>`** = `$(basename $PWD)`. All steps below use this convention.

---

## Step 1: Resolve the feature name

`args` is the text the user typed after invoking the skill.

**If `args` is a plain name** (e.g. `graphify-kb`): use it as the feature name.

**If `args` is empty**:
```bash
ls .nax/features/ 2>/dev/null
```
- If exactly one feature: use it, print the resolved name.
- If multiple: list them and ask the user to pick.
- If none: print error and stop:
  ```
  No features found under .nax/features/. Pass a feature name: /nax-diagnose <name>
  ```

---

## Step 2: Read the status file

```bash
cat ~/.nax/$(basename $PWD)/features/<feature>/status.json 2>/dev/null
```

Extract and print:
- `run.status` — overall run outcome (`running`, `completed`, `failed`, `crashed`, `stalled`, `precheck-failed`)
- `run.startedAt` / `run.completedAt` / `run.crashedAt` — timing
- `run.crashSignal` — signal that killed the process (if crashed: SIGTERM=15, SIGKILL=9)
- `progress.passed` / `progress.failed` / `progress.pending` / `progress.blocked` — story counts
- `current` — which story was active when the run stopped
- `postRun.acceptance.status` — acceptance gate result
- `postRun.regression.status` — regression gate result
- `cost.spent` / `cost.limit` — cost tracking (flag if `spent >= limit`)

If `status.json` is missing, print:
```
[WARN] status.json not found — run may have crashed before writing status.
       Check event log and session descriptors directly.
```

---

## Step 3: Read the PRD for per-story state

```bash
cat .nax/features/<feature>/prd.json 2>/dev/null
```

For each story, extract:
- `id`, `title`, `status`
- `attempts` — how many times tried
- `escalations` — tier escalations (fromTier, toTier, reason)
- `priorErrors` — accumulated error messages
- `dependencies` — blocked-by story IDs

Print a story state table:
```
STORY STATE
────────────────────────────────────────
US-001  "Implement search index"  failed   3 attempts  [escalated fast→balanced→powerful]
US-002  "Add query endpoint"      blocked  0 attempts  [waiting on US-001]
US-003  "Write E2E tests"         pending  0 attempts
```

For each failed story, print its `priorErrors` last entry below the table.

---

## Step 4: Inspect session descriptors

```bash
ls .nax/features/<feature>/sessions/ 2>/dev/null
```

For each session directory:
```bash
cat .nax/features/<feature>/sessions/<sessionId>/descriptor.json
```

Extract: `id`, `role`, `state`, `storyId`, `completedStages`, `lastActivityAt`

Terminal states are `COMPLETED` and `FAILED`. Flag sessions in `FAILED` state or sessions still `RUNNING` with a stale `lastActivityAt` (>60s ago):
```
[FAILED] sess-abc123 (role: implementer, story: US-001) — state: FAILED
         completedStages: [context, prompt]   last activity: 2026-06-10T14:23:11Z
         (stalled after prompt stage — execution never started)
```

Partial `completedStages` shows exactly which pipeline stage the session got stuck at.

---

## Step 5: Check context manifests for missing stages

```bash
ls .nax/features/<feature>/stories/<storyId>/ 2>/dev/null
```

List which `context-manifest-<stage>.json` files exist for each failed story. Missing = never reached.

Known stage names written to context manifests: `context`, `execution`, `acceptance-setup`

Print:
```
STORY US-001 STAGE PROGRESS
  [OK] context
  [MISSING] execution  ← run stopped here
  [MISSING] acceptance-setup
```

---

## Step 6: Check the run event log

Two separate sources for the run timeline — read both:

**A. Pipeline lifecycle events (global):**
```bash
grep "<feature>" ~/.nax/events/$(basename $PWD)/events.jsonl 2>/dev/null | tail -20
```
Events emitted: `run:started`, `story:started`, `story:completed`, `story:failed`, `run:completed`, `run:paused`

Look for:
- Missing `run:completed` entry = run crashed mid-flight
- `story:failed` entry with reason field = last story failure message
- `story:started` with no matching `story:completed` or `story:failed` = story currently stuck

**B. Structured logger output (per-run JSONL):**
```bash
ls -t ~/.nax/$(basename $PWD)/features/<feature>/runs/ 2>/dev/null | head -3
tail -30 ~/.nax/$(basename $PWD)/features/<feature>/runs/<runId>.jsonl 2>/dev/null
```
This file contains `debug`/`info`/`warn`/`error` log entries from the run. Look for:
- Error-level entries near the end
- Exit codes: 124 = timeout, 134 = SIGABRT (Bun JSC crash), 132 = SIGILL

---

## Step 7: Prompt audit (only if explicitly requested)

Skip this step unless the user said "check prompt audit", "include prompt audit", or similar.

**Prompt audit location:** `~/.nax/<project>/prompt-audit/<feature>/`

Files are named `<runId>.jsonl` (correlates with `status.json` → `run.id`):
```bash
ls ~/.nax/$(basename $PWD)/prompt-audit/<feature>/ 2>/dev/null | sort | tail -5
tail -5 ~/.nax/$(basename $PWD)/prompt-audit/<feature>/<runId>.jsonl
```

Each line is a `PromptAuditEntry` (success) or `PromptAuditErrorEntry` (failure). Print from the last entry:
- `ts`, `stage`, `storyId`, `callType`, `turn`
- `durationMs` — values >60000ms suggest agent timeout
- `errorCode` / `errorMessage` — present only on error entries

If no files found:
```
[INFO] No prompt audit files found. Prompt audit may be disabled (check config.agent.promptAudit.enabled).
```

---

## Step 8: Review audit (only if explicitly requested)

Skip this step unless the user said "check review audit", "include review audit", or similar.

**Review audit location:** `~/.nax/<project>/review-audit/<feature>/`

```bash
ls ~/.nax/$(basename $PWD)/review-audit/<feature>/ 2>/dev/null | sort | tail -5
cat ~/.nax/$(basename $PWD)/review-audit/<feature>/<latest-file>
```

Extract and print:
- `reviewer` — `semantic` or `adversarial`
- `parsed` — `false` = JSON parse error, heuristic fallback used
- `failOpen` — `true` = review degraded gracefully (result may be unreliable)
- `passed` — final verdict
- `blockingThreshold` — findings below this level are advisory only
- `advisoryFindings` count — findings that were dropped as non-blocking

Flag issues:
```
[WARN] Review parse failed (parsed: false) — heuristic fallback used
[WARN] failOpen: true — review degraded gracefully, result may be unreliable
[WARN] 3 advisory findings dropped (blockingThreshold: error) — may hide real issues
```

---

## Step 9: Print diagnosis report

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NAX DIAGNOSIS: <feature-name>
Project: <project>  Run: <run.id or "unknown">
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RUN STATUS: <status>  [<startedAt> → <completedAt or "—">]
Stories: <passed> passed · <failed> failed · <pending> pending · <blocked> blocked

STORY STATE
────────────────────────────────────────
<story table from Step 3>

FAILURE SUMMARY
────────────────────────────────────────
<root cause findings, one per line, with severity prefix>

RECOMMENDED ACTIONS
────────────────────────────────────────
<actionable next steps>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Severity classification

| Prefix | Meaning |
|:-------|:--------|
| `[CRASH]` | Process killed by signal (SIGTERM/SIGKILL/SIGABRT) — check system resources |
| `[BLOCKED]` | Story blocked by a failed dependency — fix the dependency story first |
| `[STALLED]` | Session in FAILED state or RUNNING with stale activity — check agent timeout |
| `[FAILED]` | Story exhausted all escalation tiers — inspect `priorErrors` for root cause |
| `[REVIEW]` | Review audit anomaly — parse error, failOpen, or advisory findings dropped |
| `[COST]` | Run stopped at cost limit — increase `cost.limit` in config |
| `[PRECHECK]` | Precheck failed — git dirty files, missing build tools, or lockfile issues |
| `[WARN]` | Non-blocking issue worth noting |

---

## Common failure patterns

| Scenario | Indicators | Recommended action |
|:---------|:-----------|:-------------------|
| Agent timeout | `durationMs > 60000` in prompt audit, session `state: FAILED` | Retry with `--profile` using a longer timeout or more powerful tier |
| Escalation exhausted | `escalations` has all 3 tiers, `status: failed` | Read `priorErrors` — if same error repeats, the spec or test may be wrong |
| Precheck failure | `run.status: precheck-failed`, missing `story:started` events | Run `git status`, check build tools, verify test command works standalone |
| Crash mid-run | `run.crashSignal` present, no `run:completed` event | Check system resources (OOM); retry with `nax run -f <feature> --resume` |
| Review parse failure | `parsed: false` in review audit | Usually transient — retry; if persistent, check model output in prompt audit |
| Blocked dependency chain | Multiple stories `status: blocked`, one root `status: failed` | Fix the root failure first; others will unblock automatically on retry |
| Acceptance gate failed | `postRun.acceptance.status: failed` | Check `postRun.acceptance.failedACs` for which ACs are unmet |
| Cost limit hit | `cost.spent >= cost.limit` in status | Increase `config.cost.limit` or optimize prompts |
