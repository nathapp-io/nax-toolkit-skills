---
name: nax-plan
description: Run `nax plan` to generate a PRD (prd.json) from a feature spec. Resolves the spec from .nax/features/<name>/spec.md or .nax/specs/<name>.md (same logic as post-impl-review), derives the feature name from the spec path, and supports --profile for per-run config overrides.
---

# nax-plan

Generate a PRD (`prd.json`) from a feature spec by running `nax plan`.

**Announce at start:** "Using nax-plan to plan `<feature-name>`."

---

## Step 1: Resolve the spec

`args` is the text the user typed after invoking the skill. For example, `/nax-plan graphify-kb` gives `args = "graphify-kb"`, and `/nax-plan` alone gives `args = ""`.

**If `args` is an explicit path** (starts with `./`, `/`, or ends in `.md`):
- Use it directly. If the file does not exist, print an error and stop:
  ```
  Error: spec not found at <path>
  ```

**If `args` is a plain name** (e.g. `graphify-kb`, no slashes, no `.md`):
- Try `.nax/features/<name>/spec.md`
- If not found, also try `.nax/specs/<name>.md`
- If still not found, print error and stop:
  ```
  Error: no spec found for "<name>". Checked:
    .nax/features/<name>/spec.md
    .nax/specs/<name>.md
  ```

**If `args` is empty**:
- Run:
  ```bash
  find .nax/features -name "spec.md" 2>/dev/null
  find .nax/specs -name "*.md" 2>/dev/null
  ```
- If exactly one file found: use it, print the resolved path.
- If multiple found: list them and ask the user to pick:
  ```
  Multiple specs found. Which would you like to plan?
  1. .nax/features/graphify-kb/spec.md
  2. .nax/features/api-foundation/spec.md
  3. .nax/specs/fts-tantivy-migration.md
  Enter number:
  ```
  Wait for the user's response, then use the selected path.
- If none found: print error and stop:
  ```
  No spec found. Checked:
    .nax/features/*/spec.md
    .nax/specs/*.md
  Pass a path or feature name: /nax-plan <name|path>
  ```

Once resolved, print: `Spec: <resolved-path>`

---

## Step 2: Derive the feature name

The feature name is the directory name under `.nax/features/`. Extract it from the resolved spec path:

- `.nax/features/graphify-kb/spec.md` → feature name: `graphify-kb`
- `.nax/specs/fts-tantivy-migration.md` → feature name: `fts-tantivy-migration` (stem of the filename)
- Explicit path like `./docs/my-spec.md` → ask the user: "What feature name should I use? (This sets the output directory to `.nax/features/<name>/`)"

---

## Step 3: Run `nax plan`

```bash
nax plan -f <feature-name> --from <resolved-spec-path>
```

**With a profile override:**

```bash
nax plan -f <feature-name> --from <resolved-spec-path> --profile <profile-name>
```

Use `--profile` when the user specifies a profile by name (e.g. "use the fast profile"). Available profiles:

```bash
nax config profile list
```

The PRD is written to `.nax/features/<feature-name>/prd.json` on success.
