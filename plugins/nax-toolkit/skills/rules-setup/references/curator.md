# nax Curator — Reference

The curator is a built-in post-run plugin (`nax-curator`) that runs automatically after every nax run. It mines run artifacts using 6 deterministic heuristics (no LLM) and writes proposals to `<runOutputDir>/curator-proposals.md` for human review.

## Heuristics

| ID | Signal | Default threshold | Proposal target |
|:---|:-------|:-----------------|:----------------|
| **H1** — Repeated review finding | Same review rule ID fired ≥ N times across stories | 2 | Add to `.nax/rules/curator-suggestions.md` |
| **H2** — Empty pull-tool result | Same keyword returned 0 results ≥ N times | 2 | Add to `.nax/features/<id>/context.md` |
| **H3** — Repeated rectification cycle | Story needed ≥ N fix cycles | 2 | Add to `.nax/features/<id>/context.md` (HIGH severity) |
| **H4** — Escalation chain | Same tier escalation path (e.g. fast→powerful) ≥ N times | 2 | Add to `.nax/features/<id>/context.md` |
| **H5** — Stale chunk excluded | Same context chunk excluded as stale across ≥ N runs | 2 | Drop from `.nax/rules/curator-suggestions.md` |
| **H6** — Fix-cycle unchanged | Story had ≥ N consecutive fix iterations with no change | 2 | Advisory only (no auto-target) |

H1 is the highest-value signal for rule authoring. It requires review audit to be enabled:

```json
{
  "review": { "audit": { "enabled": true } }
}
```

## Commands

```bash
# Show proposals for the latest run
nax curator status

# Show proposals for a specific run
nax curator status --run <runId>

# Re-run heuristics on existing observations (useful after tuning thresholds)
nax curator dryrun

# Apply checked proposals to canonical files
nax curator commit <runId>

# Prune old rows from the cross-run rollup (default: keep 50 runs)
nax curator gc
```

## Review and apply workflow

**Never apply proposals without explicit user approval.** The agent presents proposals and waits; the user decides what to adopt.

1. Run `nax curator status` and read the full output of `curator-proposals.md`
2. Present all proposals to the user — grouped by severity (HIGH first), with the evidence line for each
3. **Wait for the user to say which proposals to adopt.** Do not proceed until the user responds.
4. For each approved proposal:
   - Mark it `[x]` in `curator-proposals.md`
5. Run `nax curator commit <runId>` — applies only the checked proposals (appends for `add`, removes lines for `drop`)
6. Show the user the resulting diff in the modified files and ask for final confirmation before staging
7. `git add` and `git commit` only after the user confirms

**Does not commit to git automatically** — always require explicit user sign-off.

### Presenting proposals to the user

Show proposals in this format, grouped by action and sorted HIGH → MED → LOW:

```
Curator found N proposals for run <runId>:

ADD to .nax/rules/curator-suggestions.md
  [HIGH] H1 — "unsafe-op" review finding fired 4× across stories s1, s2, s3, s4
  [MED]  H3 — story s7 needed 3 rectification cycles (context may be missing)

DROP from .nax/rules/curator-suggestions.md
  [LOW]  H5 — chunk "redis-cache-setup" excluded as stale in 3 runs

ADVISORY (no file change)
  [LOW]  H6 — story s9 had 2 consecutive fix iterations with no change

Which proposals should I apply? (list numbers, "all", or "none")
```

Wait for the user's response before doing anything.

## Tuning thresholds

If proposals are too noisy, increase thresholds. If too quiet, decrease them:

```json
{
  "curator": {
    "thresholds": {
      "repeatedFinding": 3,
      "rectifyAttempts": 3
    }
  }
}
```

## Combined authoring workflow

1. Run nax on your feature stories
2. `nax curator status` — fetch and present proposals to the user (see format above)
3. Wait for user approval — apply only approved proposals via `nax curator commit <runId>`
4. Show the user the diff in modified files, confirm before staging
5. Move adopted content from `.nax/rules/curator-suggestions.md` into the appropriate rule file with proper frontmatter (see main `rules-setup` skill for how)
6. Run `nax rules lint` to validate neutrality
7. Commit the updated rule files after user confirms

The curator surfaces **what** to add; `rules-setup` guides **how** to write it well.
