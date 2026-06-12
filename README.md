# nax-toolkit

A Claude Code plugin bundling operational skills for **nax** projects — the home
for nax-related skills that are *not* part of the spec workflow (which lives in
[nax-spec-kit](https://github.com/nathapp-io/nax-spec-kit-skills)).

| Skill | Purpose |
|:------|:--------|
| **nax-setup** | Set up nax in any repo — single-package OR workspace monorepo. Wires `.nax/config.json` (quality, review, context, precheck, execution) to the repo's REAL build/test/lint commands, and adds per-package `.nax/mono/<pkg>/config.json` overrides only when the repo is a monorepo. Handles package-manager (bun/npm/pnpm/yarn), orchestrator (turbo/nx/none), and test-framework (jest/vitest/bun:test/pytest/go test) differences. |
| **post-impl-review** | Post-implementation review of changed code against a feature spec. Resolves the spec (by path, feature name, or auto-detect), diffs against the repo's default branch, and prints severity-graded findings (CRITICAL/HIGH/MEDIUM/LOW) with a compliance + drift verdict. |
| **context-setup** | Author or improve `.nax/context.md` files — the human-authored source that `nax generate` converts into `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, and other agent files. Handles single-package and monorepo repos. In a monorepo, guides you to write a slim cross-cutting root context and specific per-package contexts under `.nax/mono/<pkg>/context.md`. |
| **rules-setup** | Author or improve `.nax/rules/*.md` files — the agent-neutral canonical store for project conventions. Covers frontmatter (`priority`, `paths`, `appliesTo`), content quality and neutrality requirements, single-package and monorepo layouts, and validation with `nax rules lint`. Replaces per-agent files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) as the single source of truth. |
| **nax-plan** | Run `nax plan` to generate a PRD (`prd.json`) from a feature spec. Covers spec resolution, plan modes (`single`/`debate`/`pipeline`/`refine`), the `--profile` flag for per-run config overrides, key config knobs (model tier, timeout, debate agents, TDD strategy), and reading and validating the PRD output. |

> **Scope:** This repo is the catch-all for nax operational skills. Spec authoring
> and audit skills (spec-writing, post-impl-review) live in `nax-spec-kit`. Add new
> setup/config/onboarding/maintenance skills here under `skills/`.

> **Note:** These skills are tuned for nax-style projects — they reference
> conventions such as `.nax/config.json`, `.nax/mono/`, and ADR-009. They degrade
> gracefully elsewhere, but some guidance and examples assume the nax workflow.

## Installation

Installation differs by harness. If you use more than one, install nax-toolkit
separately for each. All harnesses share the same `skills/` directory.

### Claude Code

This repo is its own plugin marketplace (`.claude-plugin/`). Add it, then install:

```bash
# From a local clone:
/plugin marketplace add /path/to/nax-toolkit
/plugin install nax-toolkit@nax-toolkit

# Or, once pushed to GitHub:
/plugin marketplace add nathapp-io/nax-toolkit-skills
/plugin install nax-toolkit@nax-toolkit
```

Restart or `/clear` the session after installing so the skills are discovered.

### Codex CLI

This repo is also a Codex marketplace. Add it, then install:

```bash
# From a local clone:
codex plugin marketplace add /path/to/nax-toolkit-skills
codex plugin add nax-toolkit@nax-toolkit

# Or, once pushed to GitHub:
codex plugin marketplace add nathapp-io/nax-toolkit-skills
codex plugin add nax-toolkit@nax-toolkit
```

The marketplace entry lives at `.agents/plugins/marketplace.json`, and the
installable Codex plugin lives at `plugins/nax-toolkit/`.

### Cursor

Manifest at `.cursor-plugin/plugin.json`. Install via Cursor's plugin manager
pointing at this repo or a local clone.

### OpenCode

Manifest + entry at `.opencode/`. See [.opencode/INSTALL.md](./.opencode/INSTALL.md).
Quick version — add to your `opencode.json`:

```json
{
  "plugin": ["nax-toolkit@git+https://github.com/nathapp-io/nax-toolkit-skills.git"]
}
```

## Usage

Skills auto-activate on trigger phrases, or invoke them explicitly:

```
/nax-setup        # set up / configure nax for the current repo
```

You can also just say "set up nax for this repo" or "configure nax for this project".

## Layout

```
.claude-plugin/
  plugin.json        # Claude Code plugin manifest
  marketplace.json   # self-hosted marketplace entry
.codex-plugin/
  plugin.json        # Root Codex manifest (skills → ../skills/)
.agents/plugins/
  marketplace.json   # Codex marketplace entry for this repo
plugins/nax-toolkit/
  .codex-plugin/plugin.json   # Marketplace-installed Codex plugin
  skills -> ../../skills      # Reuses the shared skills tree
.cursor-plugin/
  plugin.json        # Cursor manifest (skills → ../skills/)
.opencode/
  plugins/nax-toolkit.js   # OpenCode plugin: registers ../../skills
  INSTALL.md
package.json         # OpenCode git-backed install entry (main)
skills/
  nax-setup/
    SKILL.md
    references/       # config-template, mono-config-template, verification-checklist
```

## Adding a skill

1. Create `skills/<skill-name>/SKILL.md` with name + description frontmatter.
2. Add any supporting material under `skills/<skill-name>/` (references, examples).
3. Bump the version in the four manifests + `package.json`.
4. Add a row to the skills table above.

No manifest wiring is needed per-skill — every harness manifest points at the
whole `skills/` directory.

## License

MIT — see [LICENSE](./LICENSE).
