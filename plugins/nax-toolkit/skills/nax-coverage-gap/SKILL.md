---
name: nax-coverage-gap
description: Use to review adversarial-review "coverage-gap" demotions across nax runs — the Phase-0 telemetry that decides whether recurrence-demotion is dropping genuinely out-of-scope opinions (working as intended) or real in-scope defects (a signal to invest in Phase 1). Triggers on "check coverage-gap demotions", "is recurrence-demotion dropping real bugs", "adversarial demotion telemetry".
---

# nax-coverage-gap

Aggregate adversarial-review **recurrence-demotion** telemetry across runs and help judge whether the demotions are correct. Reads audit artifacts from disk; prints a structured report.

**Announce at start:** "Using nax-coverage-gap to review recurrence-demotion telemetry for `<project>`."

---

## Background — what a coverage-gap demotion is

nax's adversarial review can auto-demote a finding to advisory once it recurs past `review.adversarial.recurrenceDemotion.maxBlockingRounds` (default 2) — this stops out-of-scope-but-true findings from deadlocking a story. Each demoted finding is tagged **`meta.coverageGap: true`** and also emits a structured log event **`review.adversarial.recurrence_demoted`**.

These demotions are the **Phase-0 telemetry gate**: the whole point of measuring them is to answer one question —

> Are we demoting **genuinely out-of-scope** opinions (correct — Phase 0 is working), or dropping **real in-scope defects** the ACs required (the signal to build Phase 1: commit-the-failing-test materialization + pause-for-human)?

Only runs made against nax that includes the recurrence-demotion feature (PR #1337 / the `coverageGap` tag) produce this data. On older runs the report is empty.

---

## Artifact layout

| Location | What lives here |
|:---------|:----------------|
| `~/.nax/<project>/review-audit/<feature>/*.json` (global) | Per-round adversarial + semantic review-audit records. `advisoryFindings[].meta.coverageGap` lives here. |
| `<repo>/.nax/review-audit/<feature>/*.json` (project-local) | Same records when the run configured a project-local `outputDir`. |
| `~/.nax/<project>/features/<feature>/runs/<runId>.jsonl` | Structured logger output — the `review.adversarial.recurrence_demoted` event. |

`<project>` is usually `$(basename <repo>)`. Check both the global and project-local `review-audit` trees.

---

## Step 1 — locate the audit records

```bash
PROJ=<project>            # e.g. nathapp-nestjs-platform
FEAT=<feature-or-glob>    # a feature name, or * for all
ls ~/.nax/$PROJ/review-audit/$FEAT/ 2>/dev/null | head
# project-local fallback:
ls <repo>/.nax/review-audit/$FEAT/ 2>/dev/null | head
```

If neither exists, tell the user no review-audit records are present for that project and stop.

## Step 2 — extract coverage-gap demotions

Requires `jq`. For each adversarial record, pull `advisoryFindings` tagged `coverageGap`:

```bash
ROOT=~/.nax/$PROJ/review-audit          # or <repo>/.nax/review-audit
for f in $ROOT/$FEAT/*adversarial*.json; do
  jq -r --arg f "$f" '
    (.advisoryFindings // [])
    | map(select(.meta.coverageGap == true))
    | select(length > 0)
    | .[] as $d
    | "\(.storyId // "?")\t\($d.file)\t[\($d.category)]\t\($d.message[0:90])"
  ' "$f" 2>/dev/null
done | sort | uniq -c | sort -rn
```

Each line: `<count> <storyId> <file> [<category>] <message>` — the count is how many rounds/records that same demotion appeared in. Also record the build that produced them (§8.8 provenance):

```bash
for f in $ROOT/$FEAT/*adversarial*.json; do
  jq -r 'select((.advisoryFindings // []) | any(.meta.coverageGap == true))
         | "\(.storyId)\t\(.naxVersion // "?")\t\(.naxCommit // "?")"' "$f" 2>/dev/null
done | sort -u
```

(Records with `naxVersion: "?"` predate the version-stamping fix — treat their `blockingThreshold`/telemetry as unverified.)

**Cross-check via the log event** (optional, catches demotions even if audit is absent):

```bash
grep -h "recurrence_demoted" ~/.nax/$PROJ/features/$FEAT/runs/*.jsonl 2>/dev/null \
  | jq -r '.data | "\(.storyId)\t\(.file)\t[\(.category)]"' 2>/dev/null | sort | uniq -c | sort -rn
```

## Step 3 — print the report

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NAX COVERAGE-GAP TELEMETRY: <project>
Features: <feature(s)>   nax build(s): <naxVersion (naxCommit), …>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DEMOTIONS PER STORY
────────────────────────────────────────
<feature> <storyId>:  <N> demotion(s)
  x<rounds>  <file>  [<category>]  <message>
  …

AGGREGATE
────────────────────────────────────────
stories with demotions: <n>   total demotions: <m>   distinct findings: <k>
```

## Step 4 — adjudicate each distinct demotion (the actual gate)

For every **distinct** demoted finding, read the story's acceptance criteria (from `<repo>/.nax/features/<feature>/prd.json` → the story's `acceptanceCriteria`) and classify it:

| Verdict | Meaning | Action |
|:--------|:--------|:-------|
| **Out-of-scope** | A production-hardening opinion (atomicity, expiry, tenant-scoping, concurrency…) the ACs never stated | Correct demotion. **Phase 0 is working.** No action beyond, optionally, adding it as a new AC / declaring it out-of-scope in the spec. |
| **In-scope defect** | The AC required this behavior and a green test should have caught it, yet it was demoted | **Wrong demotion.** This is the Phase-1 signal — the finding should have been materialized as a failing AC-mapped test, not dropped. Escalate. |
| **Test-gap** | The demotion is really "the covering test is fake/tautological" | Should have blocked (test-gap carve-out); if it was demoted, investigate the guard. |

**Decision rule:** if in-scope-defect demotions are essentially **zero** across a representative sample, Phase 0 is sound and Phase 1 (materialization + pause-for-human) is **not** yet warranted. If real in-scope defects are being demoted, that is the concrete evidence to build Phase 1. See the findings report §8.6/§13 for the deferred Phase-1 design.

---

## Notes

- **Developers working inside the nax repo** can run the aggregator directly: `bun scripts/analyze-coverage-gap.ts ~/.nax --since <YYYY-MM-DD> --project <project>` (mirrors `analyze-adversarial-convergence.ts`). This skill is the portable, no-repo-checkout equivalent.
- For single-run failure diagnosis (why did one run fail/stall/crash), use **nax-diagnose** instead — this skill is cross-run telemetry, not incident RCA.
