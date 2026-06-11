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

1. After a run: `nax curator status` — read `curator-proposals.md`
2. Check (`[x]`) any proposals worth adopting
3. `nax curator commit <runId>` — applies checked proposals (appends for `add`, removes lines for `drop`), opens modified files in `$EDITOR` for final review
4. Does **not** commit to git — stage and commit the result manually

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
2. `nax curator status` — review H1/H3/H4 proposals for rule candidates
3. Check proposals worth adopting, run `nax curator commit <runId>`
4. Move content from `.nax/rules/curator-suggestions.md` into the appropriate rule file with proper frontmatter
5. Run `nax rules lint` to validate neutrality
6. Commit the updated rule files

The curator surfaces **what** to add; `rules-setup` guides **how** to write it well.
