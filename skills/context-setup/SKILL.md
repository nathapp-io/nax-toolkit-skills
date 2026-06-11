---
name: context-setup
description: Guide for writing good .nax/context.md files — the human-authored source that nax generate converts into CLAUDE.md, AGENTS.md, .cursorrules, and other agent files. Handles both single-package repos and monorepos. In a monorepo the root context.md is kept slim and cross-cutting; per-package context.md files capture what is specific to each package. Ends with nax generate and a commit.
---

# context-setup

Author or improve `.nax/context.md` files so that `nax generate` produces high-quality agent context files across all AI tools.

**Announce at start:** "Using context-setup to write `.nax/context.md`."

---

## What context.md is and is not

`context.md` is the **human-authored source of truth** that `nax generate` reads to produce `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, and other agent files. Every agent prompt is prefixed with its content, so every line you include costs tokens on every run.

**Include:**
- What the project does (1–2 sentences)
- Tech stack (runtime, language, frameworks, database, test framework)
- Key commands (build, test, lint, typecheck, dev)
- Directory structure or key files that are non-obvious
- Engineering rules agents commonly violate in this codebase
- Hard constraints (auth model, soft-delete rules, generated-file rules, i18n rules)
- Cross-cutting conventions (naming, file organization, state machine paths)

**Do not include:**
- Information obvious from the code (e.g. "we use TypeScript" if `tsconfig.json` is present and the stack table already says so)
- Implementation details that belong in code comments
- In-progress work, sprint goals, or ephemeral state
- Generated content (lock file contents, build output, OpenAPI spec contents)
- Tutorials, long how-to guides, or content that belongs in `docs/`
- Duplicate content — if it is in the root context, do not repeat it in per-package context

**Target size:**
- Single-package root: 80–150 lines
- Monorepo root: 100–200 lines
- Per-package: 60–150 lines

If any context.md exceeds these limits, look for content that is ephemeral, obvious, or already covered elsewhere and trim it.

---

## Step 1: Detect repo shape

Run the following to understand the repo structure:

```bash
# Check for monorepo workspace config files
ls pnpm-workspace.yaml turbo.json nx.json go.work 2>/dev/null

# Check for workspace field in package.json (npm/Bun workspaces)
grep -q '"workspaces"' package.json 2>/dev/null && echo "npm/Bun workspaces detected"

# Check for Rust workspace (single Cargo.toml can exist in single-package projects too)
grep -q '\[workspace\]' Cargo.toml 2>/dev/null && echo "Cargo workspace detected"

# Check for existing context files
find .nax -name "context.md" 2>/dev/null

# If a monorepo: list packages/apps
ls apps/ packages/ services/ libs/ 2>/dev/null | head -30
```

**Single-package repo:** Has one manifest at the root with no workspace config and no `apps/` / `packages/` directory layout. Proceed to Step 2.

**Monorepo:** Has `pnpm-workspace.yaml`, `turbo.json`, `go.work`, a `workspaces` field in `package.json`, `[workspace]` in `Cargo.toml`, or an `apps/` / `packages/` directory structure. Proceed to Step 3.

---

## Step 2: Single-package — write `.nax/context.md`

Create or update `.nax/context.md` with these sections. Skip any section where you have nothing substantive to say — an empty section wastes tokens.

````markdown
# <Project Name> — <One-phrase purpose>

<One or two sentences describing what this project does and for whom.>

## Tech Stack

| Layer | Choice |
|:------|:-------|
| Runtime | <e.g. Bun 1.3+, Node.js 22+, Go 1.23> |
| Language | <e.g. TypeScript strict, Go, Python 3.12> |
| Framework | <e.g. NestJS 11, FastAPI, Echo> |
| Database | <e.g. PostgreSQL + Prisma, SQLite, Redis> |
| Test | <e.g. bun:test, Jest, pytest, go test> |
| Lint/Format | <e.g. Biome, ESLint + Prettier, golangci-lint> |

## Commands

| Command | Purpose |
|:--------|:--------|
| `<build command>` | Build |
| `<test command>` | Full test suite |
| `<lint command>` | Lint |
| `<typecheck command>` | Type check |

## Architecture

<2–4 sentences on the key architectural shape — what the main entry point is, how the layers relate, where persistence lives. Only cover what is non-obvious.>

```text
src/
├── <key-dir>/   # <one-line purpose>
├── <key-dir>/   # <one-line purpose>
└── <key-dir>/   # <one-line purpose>
```

## Engineering Rules

- <rule: something agents commonly get wrong>
- <rule: a hard constraint — auth model, soft-delete, generated files>
- <rule: a non-obvious convention — naming, file limits, import style>

## Testing Rules

- <where unit tests live, e.g. beside source as *.spec.ts>
- <where integration/e2e tests live>
- <what to keep covered when changing behaviour>
````

**Content quality checklist before saving:**
- [ ] Is the project description ≤2 sentences and accurate?
- [ ] Does the tech stack table include only real, current choices?
- [ ] Does every command actually work in this repo right now?
- [ ] Are the Engineering Rules things agents genuinely get wrong, not obvious common sense?
- [ ] Are there any sections that could be removed without hurting an agent's understanding?

Proceed to Step 5.

---

## Step 3: Monorepo — detect packages

Run:

```bash
# List all packages/apps
ls apps/ packages/ services/ libs/ 2>/dev/null

# Check which already have context.md files
find .nax/mono -name "context.md" 2>/dev/null

# Confirm package list by looking for manifests (note: directories without manifests may exist)
find apps packages services libs -maxdepth 2 \( -name "package.json" -o -name "go.mod" -o -name "pyproject.toml" -o -name "Cargo.toml" \) 2>/dev/null | head -20
```

Note the full list of packages. You will write a root context.md (Step 4a) and one per-package context.md per package (Step 4b).

**Path convention for per-package files:** The `.nax/mono/` path mirrors the repo-relative package path. `nax generate` discovers files up to 2 levels deep under `.nax/mono/`. Examples:

| Package location | Per-package context file |
|:-----------------|:-------------------------|
| `apps/api/` | `.nax/mono/apps/api/context.md` |
| `packages/shared/` | `.nax/mono/packages/shared/context.md` |
| `services/worker/` | `.nax/mono/services/worker/context.md` |

---

## Step 4a: Monorepo — write root `.nax/context.md`

The root context.md is **slim and cross-cutting**. Its job is to describe the monorepo shape and rules that apply to all packages. Per-package details go in the per-package files.

````markdown
# <Project Name> — <One-phrase purpose>

<One or two sentences describing what this monorepo does.>

> Edit this file to update AI agent context — do not edit `CLAUDE.md`, `AGENTS.md`,
> `.cursorrules`, `GEMINI.md`, or other generated agent files directly.
> Run `nax generate` after changes to regenerate. Per-package context lives
> under `.nax/mono/<pkg>/context.md`.

## Monorepo Shape

```text
<repo-root>/
├── apps/
│   ├── <app1>/    # <one-line role>
│   └── <app2>/    # <one-line role>
├── packages/
│   └── <shared>/  # <one-line role>
├── .nax/
│   ├── context.md
│   └── mono/
│       ├── apps/<app1>/context.md
│       └── apps/<app2>/context.md
└── <key-root-files>
```

## System Architecture

<3–5 sentences: how the packages relate to each other. Which is the system of record? Which are thin clients? What crosses package boundaries (shared config, generated clients, OpenAPI spec, etc.)?>

## Tech Stack

| Layer | Choice |
|:------|:-------|
| Runtime | <e.g. Bun workspaces, Node.js 22+> |
| Language | TypeScript strict |
| Monorepo | <e.g. Turborepo, Nx, pnpm workspaces> |
| <...per-layer...> | |

## Monorepo Commands

| Command | Purpose |
|:--------|:--------|
| `<build>` | Build all workspaces |
| `<test>` | Run tests across workspaces |
| `<lint>` | Lint across workspaces |
| `<typecheck>` | Type check across workspaces |

## Engineering Rules

- <cross-cutting rule: e.g. "keep business logic in api; other apps stay thin">
- <generated-file rule: e.g. "never manually edit generated clients">
- <boundary rule: e.g. "do not duplicate API business rules in web or cli">

## App-Specific Contexts

Read the matching package context before making package-local changes:
<list each package>
- `.nax/mono/<package>/context.md`

If a new package is added, create its context file under `.nax/mono/<package>/context.md`.
````

**Monorepo root slim checklist:**
- [ ] Does the root say anything that belongs in only one package? Move it.
- [ ] Are there Engineering Rules that only apply to one package? Move them.
- [ ] Is the directory tree accurate? Trim to only the top-level shape.
- [ ] Does the root context.md point readers to per-package files?

---

## Step 4b: Monorepo — write per-package `.nax/mono/<package>/context.md`

Write one file per package. Each file should only contain what is **specific to that package** — the root context.md is always loaded alongside it, so do not repeat root-level information.

The file path mirrors the repo-relative package path:
- Package at `apps/api/` → write to `.nax/mono/apps/api/context.md`
- Package at `packages/shared/` → write to `.nax/mono/packages/shared/context.md`

````markdown
# <Project Name> <Package Name> Context

This is the package-specific context for `<repo-relative-package-path>/`.

## Role In The Monorepo

`<package-path>` owns:
- <primary responsibility>
- <secondary responsibility>

It should not:
- <cross-boundary violation to avoid>
- <responsibility that belongs in another package>

## Stack

- <framework and version>
- <ORM/database client if specific to this package>
- <auth library if specific to this package>
- <test framework if different from root>

## Architecture

<Key files or entry points that are non-obvious:>
- `<path>`: <what it does>
- `<path>`: <what it does>

<If there is a meaningful directory structure to explain:>
```text
<package>/src/
├── <key-dir>/   # <purpose>
└── <key-dir>/   # <purpose>
```

## Domain Rules

- <rule specific to this package's domain — e.g. auth model, data integrity, state machine>
- <hard constraint — e.g. "ticket numbers are allocated per project and must never be reused">
- <API contract rule — e.g. "this package owns the OpenAPI spec; regenerate after controller changes">

## Testing Rules

- <where unit tests live in this package>
- <where integration/e2e tests live>
- <what behaviour must stay covered>

Useful scripts:
- `<package-specific test command>`
- `<package-specific build command>`
````

**Per-package checklist:**
- [ ] Does any content here duplicate the root context.md? Remove it.
- [ ] Does the "Role" section say what the package owns AND what it should not do?
- [ ] Are the Domain Rules specific to this package, not generic programming advice?
- [ ] Are there any sections that could be trimmed without hurting agent understanding?

Repeat Step 4b for every package in the monorepo.

---

## Step 5: Run `nax generate`

After writing all context.md files, run:

```bash
nax generate
```

A single `nax generate` handles everything: it generates the root `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.windsurfrules`, `GEMINI.md`, and `codex.md` from `.nax/context.md`, and then automatically discovers and generates per-package agent files for every `.nax/mono/*/context.md` and `.nax/mono/*/*/context.md` it finds (up to 2 levels deep).

To regenerate only a single package without touching the root, pass the repo-relative package path (not the `.nax/mono/` path):

```bash
# Correct: pass the repo-relative package path
nax generate --package apps/api

# Wrong: do not pass the .nax/mono/ path
# nax generate --package .nax/mono/apps/api
```

**Verify the root output:**

```bash
head -60 CLAUDE.md
```

Confirm:
- The `## Project Metadata` section was injected (language, key dependencies)
- The root context content appears below it
- No broken formatting (unclosed code blocks, broken tables)

For monorepos, also verify one per-package generated file. The output lands in the package directory:

```bash
# Example for apps/api — adjust to a real package in your repo
head -60 apps/api/CLAUDE.md
```

---

## Step 6: Commit

Stage the source files and all generated agent files:

```bash
# Stage source context files
git add .nax/context.md .nax/mono/

# Stage root-level generated files
git add CLAUDE.md AGENTS.md .cursorrules .windsurfrules GEMINI.md codex.md 2>/dev/null

# For monorepos: stage per-package generated files
# Find all new or modified CLAUDE.md / AGENTS.md files outside .git/
find . -maxdepth 4 \( -name "CLAUDE.md" -o -name "AGENTS.md" \) -not -path "./.git/*" | xargs git add 2>/dev/null
```

Then commit. Use `add` for new context files or `update` for existing ones being revised:

```bash
# New context files
git commit -m "docs(context): add nax context files and regenerate agent context"

# Updating existing context files
git commit -m "docs(context): update nax context files and regenerate agent context"
```

---

## Common mistakes to avoid

| Mistake | Fix |
|:--------|:----|
| Root context.md contains package-specific rules | Move to the matching `.nax/mono/<pkg>/context.md` |
| Per-package context.md repeats root content | Remove the duplicate — root is always loaded too |
| Commands listed but don't actually work | Test each command before including it |
| Engineering rules are generic advice, not codebase-specific | Replace with actual invariants agents violate |
| Single-package context.md exceeds 150 lines; monorepo root exceeds 200 | Audit for ephemeral, obvious, or doc-worthy content; trim or link |
| `CLAUDE.md` or other generated agent files edited manually | Edit `.nax/context.md` instead; regenerate with `nax generate` |
| No per-package files in a monorepo | Agents get a generic root context with no package-specific guidance — write the per-package files |
| Per-package path doesn't mirror package path | `.nax/mono/apps/api/context.md` for `apps/api/`, not `.nax/mono/api/context.md` |
