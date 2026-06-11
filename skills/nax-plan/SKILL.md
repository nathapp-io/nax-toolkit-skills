---
name: nax-plan
description: Run `nax plan -f <feature-name>` to generate a PRD (prd.json) from a feature spec. Resolves the feature name from args (required by -f), finds the spec at .nax/features/<name>/spec.md or .nax/specs/<name>.md, and supports --profile for per-run config overrides.
---

# nax-plan

Generate a PRD (`prd.json`) from a feature spec by running `nax plan`.

**Announce at start:** "Using nax-plan to plan `<feature-name>`."

---

## Step 1: Resolve the feature name

`args` is the text the user typed after invoking the skill. The feature name is required — it maps to `-f <feature-name>` and to the output directory `.nax/features/<feature-name>/`.

**If `args` is a plain name** (e.g. `graphify-kb`):
- Use it as the feature name.

**If `args` is empty**:
- Check if there is exactly one feature directory:
  ```bash
  ls .nax/features/ 2>/dev/null
  ```
- If exactly one: use it, print the resolved name.
- If multiple: list them and ask the user to pick:
  ```
  Multiple features found. Which would you like to plan?
  1. graphify-kb
  2. api-foundation
  Enter number:
  ```
  Wait for the user's response.
- If none found: print error and stop:
  ```
  No features found under .nax/features/. Pass a feature name: /nax-plan <name>
  ```

---

## Step 2: Resolve the spec

The default spec location is `.nax/features/<feature-name>/spec.md`.

- If `.nax/features/<feature-name>/spec.md` exists: use it.
- If not found, also try `.nax/specs/<feature-name>.md`.
- If still not found, print error and stop:
  ```
  Error: no spec found for "<feature-name>". Checked:
    .nax/features/<feature-name>/spec.md
    .nax/specs/<feature-name>.md
  ```

The user may also pass an explicit spec path as a second argument (e.g. `/nax-plan graphify-kb ./docs/my-spec.md`). If a path is provided, use it directly without checking the default locations.

---

## Step 3: Run `nax plan`

```bash
nax plan -f <feature-name> --from <resolved-spec-path>
```

**With a profile override:**

```bash
nax plan -f <feature-name> --from <resolved-spec-path> --profile <profile-name>
```

Use `--profile` when the user specifies a profile by name. To see available profiles:

```bash
nax config profile list
```

The PRD is written to `.nax/features/<feature-name>/prd.json` on success.
