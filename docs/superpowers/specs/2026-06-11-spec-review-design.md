# Spec Review Skill — Design

**Date:** 2026-06-11  
**Status:** Approved

## Overview

A manually-invoked skill (`/spec-review`) that reads a feature spec and reviews the changed code (diff against the repo's default branch) for compliance and drift. Produces a terminal-only, severity-graded findings report with a single verdict.

## Goals

- **Compliance check:** every AC/story/requirement in the spec is covered by the diff
- **Drift detection:** the implementation matches the spec's described approach, API shape, and constraints
- **Unified verdict:** `ALIGNED`, `NEEDS WORK`, or `FAILING`

## Invocation

```
/spec-review [arg]
```

`arg` is optional. Resolution order:

1. **Explicit path** — arg starts with `./`, `/`, or ends in `.md` → use directly
2. **Feature name** — plain name (e.g. `graphify-kb`) → resolve to `.nax/features/<name>/spec.md`
3. **No arg** — scan `.nax/features/*/spec.md` and `.nax/specs/*.md`; one found → use it; multiple found → list and ask user to pick
4. **Not found** — print error with paths checked, stop

## Diff Scope

1. **Detect base branch** — `git remote show origin` → `HEAD branch`; fall back to checking `origin/main` then `origin/master`; if neither exists, print error and stop
2. **Changed files** — `git diff <base>...HEAD --name-only` (list) and `git diff <base>...HEAD` (full diff)
3. **Filter noise** — exclude lockfiles (`bun.lock`, `package-lock.json`, `*.lock`), generated files (`*.generated.*`, `dist/`, `build/`), binary files
4. **Size guard** — if diff exceeds ~500 files or ~8000 lines, warn the user and suggest narrowing scope, but proceed

## Analysis

Single-pass: spec + filtered diff fed to the model in one context. The model is instructed to:

1. Extract each AC/story/requirement from the spec
2. Check each for compliance against the diff
3. Check holistically for drift (wrong approach, missing constraints, wrong API shape, naming deviations)

## Output Format

Terminal only — no file written.

```
Spec: .nax/features/graphify-kb/spec.md
Base: origin/main (3 files changed, +412 −87)

FINDINGS
────────────────────────────────────────
[CRITICAL] AC-3: Authentication endpoint missing
  Problem: Spec requires POST /auth/login but no such route exists in diff
  Fix: Add POST /auth/login handler in src/auth/auth.controller.ts

[HIGH] Drift: API response shape doesn't match spec
  Problem: Spec defines { data, error, meta } envelope; implementation returns raw objects
  Fix: Wrap responses with ApiResponse<T> in all controllers

[MEDIUM] AC-7: Partial — refresh token logic present but expiry not configured
  Problem: JWT_REFRESH_EXPIRES_IN env var referenced but never validated at startup
  Fix: Add env validation in src/config/env.ts

────────────────────────────────────────
VERDICT: 2 critical · 1 high · 1 medium · 0 low
Overall: NEEDS WORK
```

### Severity Definitions

| Severity | Meaning |
|:---------|:--------|
| CRITICAL | AC entirely missing, or implementation directly contradicts a hard spec requirement |
| HIGH | Significant drift — wrong API shape, missing constraint, wrong approach |
| MEDIUM | Partial coverage — AC present but incomplete, or minor drift |
| LOW | Minor naming deviation, style mismatch, or non-blocking gap |

### Verdict Labels

| Verdict | Condition |
|:--------|:----------|
| `ALIGNED` | Zero critical and zero high findings |
| `NEEDS WORK` | One or more high findings, zero critical |
| `FAILING` | One or more critical findings |

## Skill File Structure

```
skills/spec-review/
  SKILL.md          # skill definition + full workflow
```

No `references/` subdirectory needed — the skill is self-contained.
