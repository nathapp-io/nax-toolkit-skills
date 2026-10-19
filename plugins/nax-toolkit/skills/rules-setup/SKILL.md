---
name: rules-setup
description: Guide for writing good .nax/rules/*.md files — the agent-neutral canonical store that replaces per-agent files like CLAUDE.md, AGENTS.md, and .cursorrules. Covers frontmatter (priority, paths, appliesTo, description, stages), how workflow mode delivers rules (a rules index plus on-demand bodies), content quality, neutrality requirements, single-package and monorepo layouts, and validation with nax rules lint. Includes a pointer to the curator (references/curator.md) for ongoing rule discovery from run artifacts. Ends with lint pass and a commit.
---

# rules-setup

Author or improve `.nax/rules/*.md` files so agents receive precise, budget-efficient, agent-neutral guidance on every run.

**Announce at start:** "Using rules-setup to write `.nax/rules/` files."

---

## What nax rules are and are not

`.nax/rules/*.md` files are the **canonical store** for project conventions. They replace per-agent rule files as the single source of truth: `nax rules export` generates `.claude/rules/*.md` for Claude and a single shim file (`AGENTS.md`, `GEMINI.md`, `.cursorrules`) for the other agents. Those outputs are read-only. (`CLAUDE.md` is a different thing: the context file `nax generate` builds from `.nax/context.md`.)

How a rule reaches an agent depends on the run mode:

| Mode | Delivery |
|:-----|:---------|
| **Workflow mode, `context.rules.delivery: "index"`** (the default on nax releases after 0.90.2) | The story brief carries a `## Rules index`: one line per rule with its id, file, `description` and `appliesTo` scope. A native session in one of the workflow roles (`wf-implementer`, `wf-branch-fix`, `wf-story-review`, `wf-rereview`, `wf-branch-review`) gets a rule's full text the first time it reads a file the rule applies to (reading the rule's own file also counts as seeing it); a writing session (`wf-implementer`, `wf-branch-fix`) that writes or edits such a file before seeing the rule is refused once with the rule text, then retries. Review packages list each rule with the changed files it governs. ACP agents get the index and those review lists only. |
| **Pipeline mode, or `delivery: "push"`** | The context engine pushes the matching rule bodies into the prompt's project context, cut to the rules budget by `priority`. |

Either way, token cost is real: a pushed rule is in every matching prompt, and a delivered rule body stays in the session once shown. In index mode the `description` is all an agent sees up front, so it decides whether the agent opens the rule at all.

**Include:**
- Patterns agents commonly get wrong in this codebase (concrete, with wrong/correct examples)
- Hard constraints — soft-delete rules, transaction boundaries, auth models, generated-file rules
- Non-obvious conventions — naming, import style, forbidden APIs, file size limits
- Exit codes, output format contracts, API client setup
- Cross-cutting delivery rules — git workflow, TDD discipline, stuck rules

**Do not include:**
- Generic programming advice obvious from the language or framework docs
- In-progress work, sprint goals, or ephemeral state
- Content already in `.nax/context.md` (context is separate — rules are conventions, context is architecture)
- Tutorials or how-to guides that belong in `docs/`
- Agent-specific phrasing (tool names, XML tags, `IMPORTANT:` shouting, emoji)

**Target size per file:**
- Focused rule file (one concern): 40–100 lines
- Broad rule file (multiple concerns): 100–200 lines
- Hard limit: 300 lines — split by concern if approaching this

---

## Step 1: Detect repo shape and existing rules

```bash
# Check for monorepo workspace config
ls pnpm-workspace.yaml turbo.json nx.json go.work 2>/dev/null
grep -q '"workspaces"' package.json 2>/dev/null && echo "npm/Bun workspaces"

# Check for existing rules
find .nax/rules -name "*.md" 2>/dev/null
find . -path "*/.nax/rules/*.md" -not -path "./.nax/rules/*" 2>/dev/null

# Check for legacy per-agent files that may need migration
ls CLAUDE.md AGENTS.md .cursorrules .claude/rules/*.md 2>/dev/null
```

**Single-package repo:** No workspace config, no `apps/`/`packages/` layout. Rules live only in `.nax/rules/`. Proceed to Step 2.

**Monorepo:** Has workspace config or a multi-package layout. Root rules live in `.nax/rules/`; per-package overlays live in `<package>/.nax/rules/`. Proceed to Step 3.

**Migration path:** If `.claude/rules/*.md` exists, run `nax rules migrate` before writing new rules. It drafts neutral `.nax/rules/` versions of those files, turning Claude's `paths:` into nax `appliesTo:`, and skips targets that already exist unless `--force` is passed. Root `CLAUDE.md` is **not** a migration source: move the conventions you want from it into `.claude/rules/` first, or author `.nax/rules/` directly. Review the output, then continue from Step 2 or 3.

---

## Step 2: Understand the frontmatter schema

Every rule file is a Markdown file with an optional YAML frontmatter block. Frontmatter is always optional — a file with no frontmatter defaults to `priority: 100` with no scoping filters.

### Supported fields

| Field | Type | Default | Purpose |
|:------|:-----|:--------|:--------|
| `priority` | integer | `100` | Sort order (index lines, delivered bodies, pushed rules) and truncation bias. Lower = higher priority. In push mode the rules budget is the smaller of 40% of the stage's context budget and 8192 tokens (`context.v2.rules.*`); rules are walked in priority order and each keeps the leading `##` sections that still fit. In index mode, the bodies delivered on one call are taken in priority order up to 16 KiB. Use `30–50` for must-have rules, `80–100` for normal, `150+` for low-priority reference. |
| `paths` | string or string[] | *(none — loads for all packages)* | Glob patterns matched against the story's package dir relative to the repo root. Use in monorepos to scope a rule to one or more packages. Omit in single-package repos (lint warns `INERT_PATHS` there). |
| `appliesTo` | string[] | *(none — applies to every file)* | Glob patterns for the files the rule governs. **Index mode:** matched against the single file being read, written or edited; a rule with no `appliesTo` governs every file in its package (its `paths:` scope). **Push mode:** matched against the story's scope files (PRD `contextFiles` and `expectedFiles` plus the git diff); when that set is empty the rule loads anyway — conservative fallback. Must be a list. |
| `description` | string | *(none — the index falls back to the first Markdown heading, then the rule id)* | One line naming the decisions the rule governs, shown on the rule's index line. Single line only. **No trailing period** — nax appends `. Applies to: ...` after it. |
| `stages` | string[] | *(none — all stages)* | Pipeline stage names (`single-session`, `tdd-test-writer`, `review-semantic`, ...). Honoured in pipeline mode. Ignored by the workflow-mode index and delivery hook. Under workflow `delivery: "push"` it is matched against the stage name `context`, so a rule scoped to strategy stage names is dropped there. Omit unless the repo still runs pipeline mode. |

Any other key rejects the file (`RULES_FRONTMATTER_INVALID`). At run time an invalid file is skipped with a warning, not fatal; `nax rules lint` fails on it.

### Frontmatter examples

**No frontmatter — applies to all stories, normal priority:**
```markdown
# Common Rules

- Use conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`)
- Never push to remote; human reviews and pushes
```

**High-priority rule scoped to one package:**
```yaml
---
priority: 45
description: "API auth: CASL factory registration, enumerating subjects, guard vs service-level checks"
paths:
  - "apps/api/*"
---
```

**File-pattern scoped rule (delivered when a session reads or writes a service/repository file):**
```yaml
---
priority: 80
description: "Persistence: soft-delete only, ticket numbers allocated inside txManager.run(), no direct $transaction"
paths:
  - "apps/api/*"
appliesTo:
  - "**/*.service.ts"
  - "**/*.repository.ts"
---
```

**Multi-package scope:**
```yaml
---
paths:
  - "apps/api/*"
  - "apps/cli/*"
priority: 100
---
```

### Type rules (validated by `nax rules lint`)

- `priority` must be a finite number — `priority: "high"` is a lint error
- `paths` must be a string or a string array; `appliesTo` must be a string array (a plain string is rejected). `paths: ""` is rejected, but an empty list (`paths: []`, `appliesTo: []`) passes lint and behaves as if the key were omitted — the rule applies everywhere
- `description` must be a single-line string
- An unknown key (anything other than `priority`, `paths`, `appliesTo`, `stages`, `description`) rejects the file
- YAML must be valid — a malformed frontmatter block fails to load

---

## Step 3: Monorepo — understand the file layout

```
<repo-root>/
├── .nax/rules/                   # Repo-level rules (all packages)
│   ├── common.md                 # Cross-cutting: git, tooling, delivery, i18n
│   ├── api-auth.md               # paths: apps/api/*, priority: 45
│   ├── api-data.md               # paths: apps/api/*, appliesTo: *.service.ts
│   ├── api/                      # Optional one-level subdirectory (valid, loaded)
│   │   └── advanced.md           # .nax/rules/api/advanced.md — depth 1, ok
│   └── web.md                    # paths: apps/web/*
│
└── apps/
    └── api/
        └── .nax/rules/           # Package-local overlay (overrides by rule id)
            └── common.md         # Overrides .nax/rules/common.md for api stories
```

**Subdirectory depth:** Files at depth 0 (`.nax/rules/common.md`) and depth 1 (`.nax/rules/api/advanced.md`) are both loaded. Files at depth 2 or deeper (`.nax/rules/a/b/c.md`) are ignored with a warning. Use subdirectories to group related rules, but keep nesting shallow.

**Overlay rule:** When a story's package is `apps/api`, both `.nax/rules/` and `apps/api/.nax/rules/` are scanned. A rule's id is its path relative to its `.nax/rules/` directory without `.md` (`common`, `api/advanced`). When both directories have a rule with the same id, the package-local file takes precedence; `apps/api/.nax/rules/advanced.md` (id `advanced`) does not override `.nax/rules/api/advanced.md` (id `api/advanced`).

**When to use package-local overlays:**
- When a single package needs to override a repo-level rule (not extend it — the override replaces entirely)
- When a rule only makes sense for one package AND using `paths:` in the root rule would clutter the root with too many package-specific files

**When to use `paths:` in root rules instead:**
- When you want to co-locate related rules by concern, not by package
- Preferred — keeps all rules in one place, easier to audit

For most monorepos: use root `.nax/rules/` with `paths:` frontmatter. Reserve package-local overlays for genuine exceptions.

---

## Step 4: Write the rule files

### Common pattern for a cross-cutting rule (description only)

````markdown
---
description: "Repo-wide: workspace commands, git and commit rules, TDD and stuck rule, error chaining"
---

# Common Rules — All Packages

## Tooling
- Use `bun` workspace commands, not `npm` or `yarn`
- Prefer repository scripts over ad-hoc variants

## Git
- Never push to remote — human reviews and pushes
- Use conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`)

## Delivery
- Prefer TDD: add or update tests with every behaviour change
- Stuck rule: if the same failure repeats 2+ iterations, stop and reassess

## Error Handling
- Always chain errors: `throw new Error("context", { cause: err })`
- Never swallow errors silently
````

### Pattern for a high-priority package-scoped rule

````markdown
---
priority: 45
description: "API auth: CASL factory registration and exhaustive permission subjects"
paths:
  - "apps/api/*"
---

# API Auth Rules

## CASL Factory Registration

`caslAbilityFactory` takes a bare class, not `{ useClass: ... }`:

```typescript
// Correct
AuthModule.forRootAsync({
  caslAbilityFactory: MyCaslAbilityFactory,
})

// Wrong — silently double-wraps; no runtime error but permissions stop enforcing
AuthModule.forRootAsync({
  caslAbilityFactory: { useClass: MyCaslAbilityFactory },
})
```

## Permission Exhaustiveness

Every permission subject must be covered in the ability factory's `switch`. Missing cases silently deny all access.
````

### Pattern for an `appliesTo`-scoped rule

````markdown
---
priority: 80
description: "Persistence: soft-delete only, ticket numbers inside txManager.run(), no direct $transaction"
paths:
  - "apps/api/*"
appliesTo:
  - "**/*.service.ts"
  - "**/*.repository.ts"
---

# API Data & Persistence Rules

## Soft-delete

Soft-delete only — no hard deletes. Use `deletedAt` timestamp field.

## Transactions

Ticket numbers must be allocated inside `txManager.run()`:

```typescript
// Correct — atomic under transaction
const number = await txManager.run(async (tx) => {
  const max = await repo.maxTicketNumber(tx, projectId);
  return max + 1;
});

// Wrong — race condition if two requests run concurrently
const max = await repo.maxTicketNumber(projectId);
const number = max + 1;
```

## Repositories

- Do not cast `PrismaClient` to bypass the repository layer
- Do not call `$transaction` directly — use `txManager.run()`
````

### Content quality checklist

Before saving any rule file:
- [ ] Does every rule describe something an agent **genuinely gets wrong** in this codebase, not just generic advice?
- [ ] Do rules with wrong/correct examples show **both sides** with a failure mode explanation?
- [ ] Are all commands in the file **actually runnable** in this repo right now?
- [ ] Are there sections that could be removed without hurting agent behaviour? If so, remove them.
- [ ] Is the file under 300 lines? If not, split by concern.
- [ ] Is the body under 16 KiB? In index mode, nax delivers at most 16 KiB of rule text per tool call, so a larger rule is only ever listed by name, never shown.
- [ ] Does the frontmatter have a `description` that says what the rule decides (not just its topic), on one line, with no trailing period?
- [ ] Is `appliesTo` set when the rule only matters for some files? Without it, index mode delivers the rule on the first read of any file in its package.

---

## Step 5: Neutrality requirements

All rule files must pass the neutrality linter (`nax rules lint`). The linter rejects agent-specific phrasing so rules work identically across Claude, Codex, Gemini, and Cursor.

### Banned patterns and fixes

| Banned | Violation ID | Fix |
|:-------|:------------|:----|
| `<system-reminder>`, `<ide_diagnostics>` | `xml-tag` | Remove the tag |
| `CLAUDE.md` | `claude-reference` | Use "agent context file" or "generated shim" |
| `AGENTS.md` | `codex-reference` | Same |
| `GEMINI.md` | `gemini-reference` | Same |
| `.claude/`, `.codex/`, `.gemini/` | `agent-directory` | Use `.nax/rules/` |
| `the Grep tool`, `the Read tool`, `the Edit tool` | `tool-phrasing` | Use "grep", "read the file", "edit the file" |
| `IMPORTANT:` | `important-shouting` | Rephrase as a plain statement |
| Emoji (🎯 ✅ ⚠️ etc.) | `emoji` | Remove — use `[OK]`, `[WARN]`, `[FAIL]` if you need markers |

### Rewriting neutrality violations

```
# Before (fails lint)
IMPORTANT: Never call $transaction directly. Use the txManager tool.

# After (passes lint)
Never call $transaction directly. Use txManager.run() instead.
```

```
# Before (fails lint)
Use the Grep tool to find usages before refactoring.

# After (passes lint)
Grep for usages before refactoring.
```

### Per-line allow override

If a rule must reference an agent-specific term (e.g., a rule explaining the migration process itself), suppress the violation with an inline comment:

```markdown
- Edit `.nax/rules/` instead of editing `CLAUDE.md` directly.  <!-- nax-rules-allow: claude-reference -->
```

Use allow markers sparingly — they are escape hatches for genuine edge cases, not a way to avoid fixing neutrality issues.

---

## Step 6: Validate with `nax rules lint`

After writing or editing rules:

```bash
nax rules lint
```

The linter scans the repo-root `.nax/rules/` and every package-local overlay. For each rule root it first validates frontmatter, then runs the neutrality linter on the bodies.

**Success output:**
```
[OK] Canonical rules lint passed (12 file(s) across repo root).
```
A `[WARN] ... completed with N warning(s)` variant also passes (for example `INERT_PATHS`).

**Frontmatter errors** are logged per file, then the command fails:
```
Canonical rule frontmatter is invalid — nax will ignore this file at run time  {"file": "...api-data.md", "error": "frontmatter.priority must be a number"}
Error: Canonical rules lint failed: 1 rule file(s) have invalid frontmatter...
```
Fix: change `priority: "high"` to a numeric value like `priority: 80`. A root with frontmatter errors is not neutrality-checked until they are fixed, so re-run after fixing.

**Neutrality violations** fail the whole root, and the output names only the root, not the line:
```
Error: Failed to load canonical rules from 1 rule root(s): <root>
```
To find the violations, grep that root's files for the banned patterns in the Step 5 table (`IMPORTANT:`, `CLAUDE.md`, `the Grep tool`, `.claude/`, emoji, XML tags), fix them, and re-run until lint passes. Only the first banned pattern on a line counts, so a line may need more than one pass.

---

## Step 7: Export (optional) and commit

**Export for agents running outside nax:**

```bash
nax rules export --agent=claude   # .claude/rules/<rule>.md, one file per rule, scope as Claude paths: frontmatter
nax rules export --agent=codex    # AGENTS.md
nax rules export --agent=gemini   # GEMINI.md
nax rules export --agent=cursor   # .cursorrules
nax rules export --agent=claude --check     # CI drift gate: non-zero exit when the output is stale
nax rules export --agent=claude --dry-run   # preview without writing
```

Export reads the repo-root `.nax/rules/` only; package overlays are not exported. Generated files carry a `<!-- AUTO-GENERATED by nax rules export --agent=<id> -->` header (in `.claude/rules/` files it follows the frontmatter). Treat them as read-only — manual edits are overwritten on the next export. To change a rule, edit `.nax/rules/` and re-export.

**Commit:**

```bash
# Stage canonical rules
git add .nax/rules/

# Stage package-local overlays (monorepo)
find . -path "*/.nax/rules/*.md" -not -path "./.nax/rules/*" | xargs git add 2>/dev/null

# Stage generated output if exported
git add .claude/rules/ AGENTS.md GEMINI.md .cursorrules 2>/dev/null

# New rules
git commit -m "docs(rules): add nax canonical rules"

# Updating existing rules
git commit -m "docs(rules): update nax canonical rules"
```

---

## Common mistakes to avoid

| Mistake | Fix |
|:--------|:----|
| `priority: "high"` (string) | Use `priority: 50` (integer) |
| `paths: []` or `appliesTo: []` (empty array) | Lint accepts it, and the rule then applies everywhere. Use a non-empty glob list, or omit the key if that is what you mean. |
| Writing `the Grep tool`, `the Edit tool` | Write "grep" or "edit the file" |
| Using `IMPORTANT:` prefix | Rephrase as a plain statement |
| Emoji in body text | Remove or use `[OK]`/`[WARN]` text markers instead |
| `appliesTo: ["**/*.spec.ts"]` for a testing rule, in a repo still on pipeline mode or `delivery: "push"` | There `appliesTo:` matches the story's scope files, and spec files the story creates may not be among them yet, so stages that do not write tests would not load the rule (test-writing stages still admit a test-file glob). Also list the source files under test. In workflow index mode, a test-file glob is right: the rule is delivered when the session writes the spec file. |
| No `description:` | The index line shows only the first heading (or the rule id), which rarely tells an agent whether to open the rule. Add a one-line description. |
| `description:` ending in `.` | The index line renders `... throw.. Applies to:`. Drop the trailing period. |
| Relying on `stages:` in workflow mode | `stages:` is ignored by the workflow index and delivery hook, and under workflow `delivery: "push"` a strategy-stage list drops the rule. Scope with `paths:` and `appliesTo:` instead. |
| One rule body over 16 KiB | It is listed in delivery but never shown. Split it by concern. |
| Repeating content from `.nax/context.md` | Rules are conventions; context is architecture. Do not duplicate. |
| Editing `.claude/rules/*.md` or another exported file directly | Edit `.nax/rules/` instead, then re-run `nax rules export --agent=<id>`. (`CLAUDE.md` comes from `.nax/context.md` via `nax generate`, not from rules.) |
| Rule file exceeds 300 lines | Split by concern — one file per topic |
| `paths:` in a single-package repo | Omit `paths:` — in a single-package repo the path filter is bypassed entirely, so `paths: ["apps/api/*"]` silently loads for every story regardless of the glob. The rule appears to work but the scope is never evaluated. |
| Running `nax rules migrate --force` without reviewing the diff | Always review migrated output — when replacements were made, the file will have a `<!-- NOTE: N neutralization(s) applied — review before committing -->` header. There are no inline markers; manual review is required. |
| Generic advice rules ("always write tests", "handle errors") | Replace with codebase-specific invariants agents actually violate |

---

## Run-level rule overrides

A run can bring rules from outside the repo without editing `.nax/rules/`: `nax run --rules-dir <dir>` (or `context.rules.overrideDir`, absolute or `~/`-prefixed in config). The directory uses the same layout, frontmatter and neutrality lint. Its rules are layered after the repo and package rules and replace any rule with the same id; `context.rules.overrideMode: "replace"` uses only the override directory. A missing directory fails the run at start (`RULES_OVERRIDE_DIR_NOT_FOUND`). Use it for org-wide or fleet rules shared across repos; keep repo-specific conventions in `.nax/rules/`.

---

## Ongoing rule discovery: the curator

`rules-setup` covers deliberate authoring. For ongoing discovery — finding patterns that emerge from real runs — use the **curator**.

The curator is a built-in post-run plugin that runs automatically after every nax run. It mines run artifacts with 6 deterministic heuristics and writes proposals to `<runDir>/curator-proposals.md`; each proposal names `.nax/rules/curator-suggestions.md` as its target. The highest-value signal (H1 — repeated review findings) requires `review.audit.enabled: true` in `.nax/config.json`.

**Always present proposals to the user and wait for explicit approval before applying anything.** Never auto-apply curator output.

See `references/curator.md` for the full heuristics table, CLI commands, the user-approval presentation format, and threshold tuning.
