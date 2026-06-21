# nax-finish / post-impl-review — consume `nax features resolve`, with fallback

**Date:** 2026-06-21
**Repo:** `nathapp/nax-toolkit` (skills)
**Status:** Design — pending implementation
**Companion spec:** nax `docs/superpowers/specs/2026-06-21-nax-features-resolve-design.md` (the CLI command this depends on)

## Problem

`nax-finish` Step 1 and `post-impl-review` Step 1 both resolve `featureName` + spec source through prose the LLM executes. This is mechanical work done non-deterministically, and the two copies have already drifted (see the companion spec). The fix is to move the resolution into `nax features resolve` (companion spec) and have both skills shell out to it.

## Goal

Rewrite the two skills' Step 1 so the **deterministic** resolution is a single `nax features resolve … --json` call, while the **interactive** parts (pick among candidates, supply a missing path) stay in the skill prose. Both skills become thin consumers of one source of truth.

**Hard constraint — graceful fallback.** The skills ship and version independently of the nax CLI. A repo may run an older nax without `features resolve`. Each skill MUST detect that and fall back to today's prose search, producing the same result. No skill may hard-fail because the subcommand is missing.

## Consumption flow (both skills)

1. Run `nax features resolve <args> --json` (`<args>` = the text after the slash command; empty is allowed).
2. **Detect availability first** (see Fallback). If unavailable → run the **fallback prose search** and continue as today.
3. If available, parse the JSON `status`:
   - **`ok`** → record `featureName` + `specSource { kind, path }`. Read the spec source in full (`.md` body, or `prd.json` stories+ACs). Proceed.
   - **`ambiguous`** → present `candidates` numbered, ask the user to pick, then re-run `nax features resolve <pick> --json`.
   - **`missing`** → show `checked` paths, ask the user to paste a spec path (or abort). Use the supplied path (re-run `resolve <path> --json`, or accept it directly as a markdown spec).
   - **`feature-not-found`** → if `candidates` is non-empty, treat like `ambiguous`; else show the no-spec prompt (like `missing`) and ask for a path or abort.
   - **`not-a-nax-repo`** → print `Error: no .nax/ directory found — is this a nax repo? Run nax-setup first.` and stop.

The interactive branches are unchanged in spirit from today's prose — only the *resolution* is delegated; the *decisions* stay with the user.

## Fallback detection

The probe must distinguish "command exists but needs input" from "command does not exist".

- Run the command and capture stdout, stderr, and exit code.
- **Available** ⇔ stdout parses as JSON with a known `status`. (Exit 0 for `ok`, exit 2 for needs-human — both still emit valid JSON per the companion contract.)
- **Unavailable** ⇔ stdout is not valid JSON, or stderr matches commander's unknown-subcommand signature (e.g. `unknown command 'resolve'` / `error: unknown command`), or the binary/exit indicates the subcommand was not recognized.

On unavailable, fall back to the existing prose search (kept verbatim in each SKILL.md as a clearly labelled **Fallback** block) so behaviour is identical on older nax. Do not silently degrade — note once that the fast path was unavailable, then proceed.

> Implementation note: keep the fallback prose as the canonical algorithm description in each skill — `nax features resolve` is defined (companion spec) to mirror it exactly, so the two never diverge by construction. If the CLI algorithm changes, update both the companion spec and these fallback blocks together.

## Per-skill changes

### `skills/nax-finish/SKILL.md` — Step 1

- Replace the inline `ls`/`find` search snippets with: run `nax features resolve <args> --json`, branch on `status` (above).
- Keep, unchanged:
  - The **preflight** block (commits-ahead vs base) — it is already a deterministic one-liner and is not part of the resolver's scope.
  - Recording `featureName` (drives Step 3 acceptance scoping) and `specSource { kind, path }`.
  - The empty-markdown guard — now also reported by the resolver as `missing` with a `spec file is empty` message; the skill treats it identically.
- Add a **Fallback** block: the current ordered search prose, used when `features resolve` is unavailable.
- Update the "Common mistakes" table if any row references the old inline search.

### `skills/post-impl-review/SKILL.md` — Step 1

- `post-impl-review` only needs the spec **path** (it already accepts markdown or PRD sources). Replace its two-path prose search with the same `nax features resolve` call, using `specSource.path`.
- Because `nax-finish` invokes `post-impl-review` with the already-resolved `specSource.path` (Step 4), `post-impl-review`'s own Step 1 resolution is the *direct-invocation* path (`/post-impl-review <name>`). Both paths now route through the same resolver.
- Add the matching **Fallback** block (its existing 2-path search, extended to match the resolver's 4-tier order so direct invocation gets the same answer `nax-finish` would).

## Acceptance / verification

Behavioural, exercised via the skills against fixture repos:

1. **Modern nax, clean resolve** — feature with only `prd.json`: skill reports `Feature: <name>` / `Spec: …/prd.json (prd)` and proceeds without any inline `ls`/`find`.
2. **Modern nax, ambiguous** — empty args, two features: skill lists candidates and waits for a pick, then resolves the pick.
3. **Modern nax, missing** — name with a feature dir but no spec/PRD: skill shows `checked` paths and prompts for a path.
4. **Older nax (no `features resolve`)** — same three scenarios resolve **identically** via the fallback prose; the skill notes the fast path was unavailable and does not error.
5. **Drift check** — `nax-finish` and `post-impl-review` given the same feature name resolve to the **same** `specSource.path` (both via CLI and both via fallback).
6. **not-a-nax-repo** — skill stops with the nax-setup hint.

## Rollout

1. Land the CLI command (companion spec) and release nax.
2. Update both SKILL.md Step 1 sections + Fallback blocks.
3. The fallback makes the skill change safe to ship before every repo upgrades nax.
