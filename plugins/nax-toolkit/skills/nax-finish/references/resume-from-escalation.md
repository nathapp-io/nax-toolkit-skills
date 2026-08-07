# Resume from an escalated auto-finish (Step 0 detail)

The nax-finish **autoflow** — the `nax-finish` post-run plugin, which shells out to `acpx flow run` after a successful `nax run` — can end in `escalated`: it stopped rather than guess, having pushed its partial fixes and posted a PR/MR comment or a Telegram message. That escalation is a **dead end in the flow**: the graph has no re-entry point, so the human judgment it asked for has nowhere to go. If a future nax exposes a first-class resume of its own, prefer it over this skill.

This skill is that path. When an escalated artifact exists for the feature, Step 4's review derivation is **already done** — the findings are on disk, with full `problem` and `fix` prose — so resume loads them instead of paying for a fresh review, and triages them under the skill's normal Step 5 discipline.

Resume applies **only** to `status: "escalated"`. Every other terminal status is ignored, including `opened` with a non-empty `rounds` array (a finish that shipped after N automated fix rounds). Those are finished; there is nothing to judge.

## Locating the artifact

The autoflow writes two files per run, into nax's **global per-project output directory** — not the repo:

```
<outputDir>/finish-audit/<feature>/<runId>.result.json   # terminal result
<outputDir>/finish-audit/<feature>/<runId>.jsonl         # one fix round per line, appended live
```

Resolve `<outputDir>` in this order (this mirrors `projectOutputDir()` in nax's `src/runtime/paths.ts`):

1. **`outputDir` override** — read `outputDir` from the project config (`<repoRoot>/.nax/config.json`), else the global config (`~/.nax/config.json`). When set it is absolute or `~/`-prefixed; expand `~/` and use it directly.
2. **Default** — `<globalDir>/<projectKey>`, where `<globalDir>` is `$NAX_GLOBAL_CONFIG_DIR` if set, else `~/.nax`, and `projectKey` is `config.name` (project, then global) trimmed and non-empty, else `basename(repoRoot)`.

**Cross-check the key before trusting it.** Each project directory carries an identity file at `<globalDir>/<projectKey>/.identity`, a JSON object whose `workdir` field is the repo it belongs to. Read it and compare `workdir` to `repoRoot`. If they differ, the key is wrong (a renamed project, a `name` override, two repos sharing a basename) — read the other `<globalDir>/*/.identity` files and use the directory whose `workdir` matches.

Read these with your own file-reading tool. Shelling out to `jq` is fine where it exists, but do not depend on it: nothing else in this skill does, and it is not installed everywhere.

Note the identity file always lives under `<globalDir>/<projectKey>/`, even when an `outputDir` override sends the artifacts elsewhere — so use it to confirm the key, not to locate the artifacts.

**Repo-local fallback.** A hand-run `acpx flow run` with no `auditDir` in its input writes to `<repoRoot>/.nax/finish-audit/<feature>/` with the run id `run`. Check this second, only if the resolved output directory has nothing.

**Pick the newest by mtime**, and record the basename you acted on:

```bash
ls -t <outputDir>/finish-audit/<feature>/*.result.json 2>/dev/null | head -1
```

Newest-by-mtime rather than newest run id because `runId` identifies a **nax run, not a finish attempt**: the plugin names the file `<ctx.runId>.result.json` and deletes any existing one before starting, so finishing the same run twice overwrites in place. The file you read may be an autoflow's second attempt at a run you already resumed once.

## Deciding whether to resume

Read the artifact and gate on `status`:

- **`escalated`** → offer resume. Print the reason and the findings, and ask the user to confirm before proceeding — the artifact may be from an older attempt whose findings they already fixed by hand.
- **anything else, or no artifact, or unparseable JSON** → say nothing about resume and run the skill normally from Step 1. A missing artifact is the ordinary case: the artifact is written **only** by the autoflow, never by this skill, so a feature finished by hand has none.

The result shape (nax's `flows/nax-finish/types.ts`):

| Field | Notes |
|:--|:--|
| `feature` | Feature name. Confirm it matches the `featureName` Step 1 resolved. |
| `status` | `opened` \| `promoted` \| `already-ready` \| `escalated` \| `nothing-to-finish` |
| `escalationReason` | Why it stopped, e.g. `quality review raised a finding needing human judgment` |
| `findings[]` | `{ severity: CRITICAL\|HIGH\|MEDIUM\|LOW, title, problem, fix }` — the review output, in full |
| `rounds[]` | **Absent, not empty**, when no fix round ran. `{ ts, phase, attempt, committed, findings[], failing?, sha? }` |
| `url` | The PR/MR carrying the escalation comment, when one exists |
| `deliveryError` | Set when the escalation could not be delivered to its channel |

`rounds[].phase` is one of `acceptance` \| `spec` \| `quality` \| `gate`. It is worth reading aloud: a `quality` escalation with **no `quality` round** means the reviewer escalated on its first pass and the automated fix loop never attempted these findings at all. That is a different situation from an escalation after three failed fix attempts, and it changes how much weight to give the reviewer's opinion.

## What resume does and does not skip

**Skipped — Step 4's review derivation for the escalated phase.** The findings are in the artifact. Surface them verbatim (severity, title, problem, fix), note which phase escalated and how many fix rounds preceded it, and carry them into Step 5 as that phase's findings. Do not re-invoke `post-impl-review` to re-derive what you already have.

**Not skipped — everything else.** Resume re-runs Step 3 (the feature's acceptance tests) and Step 6 (the repo-root quality gates) exactly as a normal run does. The autoflow proved them green against a tree that no longer exists: it pushed partial fixes, and you are about to edit the tree again during triage. Their earlier green is stale evidence. This is the same reasoning the autoflow itself applies when its `quality_gates` node re-runs acceptance unconditionally even on the happy path — a conditional skip is a check that can be *wrong*, in the direction that ships unverified code.

Step 5's existing verification ladder handles the rest: fixes that are broad or structural re-invoke the relevant `post-impl-review` phase over the whole diff, which is also what re-checks the *other*, non-escalated phase if your fixes reach it. No new rule is needed for that.

## Recording the decisions (required in resume mode)

Resume is the only place a human ruling on autoflow findings is captured. Nothing else records it — the flow's own artifact ends at the escalation, and this skill writes nothing on an ordinary run. Write a sidecar next to the artifact:

```
<outputDir>/finish-audit/<feature>/<runId>.decisions-<timestamp>.json
```

`<timestamp>` is UTC ISO-8601 with `:` and `.` replaced by `-` (matching the run-id convention, e.g. `2026-08-07T09-12-00-000Z`). Timestamped rather than a bare `<runId>.decisions.json` so a second resume of the same escalation never clobbers the first — two resumes of one escalation is exactly the signal worth keeping.

```json
{
  "artifact": "run-2026-01-31T04-05-06-789Z.result.json",
  "feature": "<feature-name>",
  "resumedAt": "2026-01-31T09-12-00-000Z",
  "escalationReason": "quality review raised a finding needing human judgment",
  "decisions": [
    {
      "title": "<finding title, copied verbatim from the artifact>",
      "severity": "HIGH",
      "decision": "fixed",
      "reason": "Real gap — the rollback path now restores the dropped state.",
      "sha": "a1b2c3d"
    },
    {
      "title": "<finding title, copied verbatim from the artifact>",
      "severity": "MEDIUM",
      "decision": "waived",
      "reason": "Self-corrects on the next successful request; cosmetic."
    }
  ],
  "outcome": "opened",
  "url": "<pull/merge request url>"
}
```

- One entry per finding in the artifact — **every** finding, including ones left alone.
- `decision` is `fixed` (code changed, `sha` required) \| `waived` (judged not a defect) \| `deferred` (real, but not for this PR — say where it went, e.g. an issue number, in `reason`).
- `reason` is one line, always. A waiver with no reason is the entry that will be useless in three weeks.
- `outcome` is the terminal status of *this* resume: `opened` \| `promoted` \| `already-ready` \| `abandoned`.

**Write it as soon as triage and any fixes are committed.** Do not defer it past Step 7 — a resume the user aborts at the PR gate still made real judgments, and those are the ones worth having. In that case write the sidecar with `outcome: "abandoned"` and no `url`.

This is what later answers whether the deeper fix is worth building: if most escalated findings are waived, the reviewer's escalate bar is miscalibrated and the fix is a prompt change; if most are fixed, an in-flow waiver ledger and a real `nax finish --resume` earn their keep.

## Common mistakes

| Mistake | Do instead |
|:--|:--|
| Looking for the artifact in the repo | It lives under `<outputDir>/finish-audit/<feature>/` (`~/.nax/<project>/…` by default); the repo path is only a hand-run `acpx flow run` fallback |
| Deriving `projectKey` from the directory name and trusting it | Cross-check `<globalDir>/<projectKey>/.identity`'s `workdir` against `repoRoot`; scan all identities on a mismatch |
| Picking the artifact with the highest-sorting run id | Pick the newest by **mtime** — a run id is reused when the same run is finished twice |
| Resuming from a non-escalated artifact | Gate strictly on `status: "escalated"`; everything else is finished |
| Treating a missing artifact as an error | It is the ordinary case — only the autoflow writes one. Run normally from Step 1 |
| Re-running `post-impl-review` to re-derive the escalated findings | They are in the artifact with full `problem`/`fix` prose — load and triage them |
| Skipping acceptance or the quality gates because the autoflow ran them | It ran them against a tree that has since changed; both re-run (Steps 3, 6) |
| Reading an absent `rounds` as "the fix loop tried and failed" | `rounds` is **omitted** when no round ran — no round for the escalated phase means the findings were never attempted |
| Finishing a resume without writing the sidecar | It is the only record of the human ruling; write it even when the PR is abandoned |
| Recording only the findings you fixed | Every finding gets an entry, waivers included — the waive rate is the measurement |
