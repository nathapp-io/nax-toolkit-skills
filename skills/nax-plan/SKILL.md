---
name: nax-plan
description: Guide for running `nax plan` to generate a PRD (prd.json) from a feature spec. Covers spec resolution, plan modes (single/debate/pipeline/refine), the --profile flag for config overrides, key config knobs (model tier, debate, TDD strategy), and reading the prd.json output. Includes profile creation and management commands.
---

# nax-plan

Generate a PRD (`prd.json`) from a feature spec using `nax plan`. The PRD is a machine-readable task state containing user stories with acceptance criteria, routing metadata, and execution context that `nax run` consumes.

**Announce at start:** "Using nax-plan to generate a PRD for `<feature-name>`."

---

## What `nax plan` does

`nax plan` reads a spec file and calls an LLM to produce `.nax/features/<feature>/prd.json`. The PRD contains an array of user stories, each with:

- Acceptance criteria (the definition of done)
- Routing metadata — complexity, test strategy, estimated cost and LOC
- `contextFiles` — source files the agent should read before implementing
- `verifiedBy` — test anchor or file the verifier checks after implementation
- `dependencies` — other story IDs this story depends on

The PRD is consumed by `nax run -f <feature>`. Do not edit `prd.json` by hand — re-run `nax plan` or use `nax plan --decompose` for sub-story splits.

---

## Step 1: Locate the spec

`nax plan` reads the spec from `--from <spec-path>`. Resolve it before running:

```bash
# Conventional location for nax feature specs
ls .nax/features/<feature>/spec.md 2>/dev/null

# Alternative: flat specs directory
ls .nax/specs/*.md 2>/dev/null
```

If no spec exists yet, create one first. The spec should describe:
- **Goal** — what the feature accomplishes
- **User stories or ACs** — what done looks like
- **Constraints** — auth model, API contract, data model rules, performance requirements

`nax plan` extracts stories directly from the spec's structure. Well-structured specs (numbered ACs, named stories) produce better PRDs than free-form prose.

---

## Step 2: Choose the plan mode

`nax plan` supports four orchestration modes. The active mode is resolved in this order:

1. Explicit `--auto` flag → chooses between single and debate based on config
2. `config.plan.mode` in `.nax/config.json`
3. `config.debate.enabled && config.debate.stages.plan.enabled` → `"debate"`
4. Default: `"single"`

| Mode | When to use | Cost |
|:-----|:------------|:-----|
| `single` | Standard — one-shot LLM call, fastest | Low |
| `pipeline` | Spec with many hard constraints — adds a mechanical validator + LLM judge | Medium |
| `refine` | Interactive PRD — agent asks clarifying questions before committing | Medium |
| `debate` | High-stakes or ambiguous spec — multiple agents debate then synthesize | High |

Set mode in config to apply it to all runs:

```json
{
  "plan": {
    "mode": "pipeline"
  }
}
```

Or use a profile to switch modes per-run without changing the config file (see Step 4).

---

## Step 3: Run `nax plan`

```bash
# Standard run — single mode, default profile
nax plan -f <feature-name> --from .nax/features/<feature>/spec.md

# Override profile (see Step 4)
nax plan -f <feature-name> --from .nax/features/<feature>/spec.md --profile <name>

# Force interactive refine mode (requires TTY)
nax plan -f <feature-name> --from .nax/features/<feature>/spec.md --one-shot

# Decompose one story into sub-stories
nax plan -f <feature-name> --decompose US-003
```

**Output:**

```
[OK] PRD written to .nax/features/<feature>/prd.json (N stories)
```

Logs are written to `.nax/features/<feature>/plan/<timestamp>.jsonl`.

---

## Step 4: Using `--profile` to override config

A profile is a partial config overlay stored as a JSON file. Use `--profile` when you need different settings (model tier, mode, debate agents) for a specific run without changing `.nax/config.json`.

### How resolution works

```
~/.nax/config.json          (global base)
     +
.nax/config.json            (project override)
     +
.nax/profiles/<name>.json   (profile overlay — highest priority)
     ↓
effective config for this run
```

CLI `--profile <name>` wins over the `profile` field in config files.

### Profile locations

| Scope | JSON | Env vars |
|:------|:-----|:---------|
| Global | `~/.nax/profiles/<name>.json` | `~/.nax/profiles/<name>.env` |
| Project | `.nax/profiles/<name>.json` | `.nax/profiles/<name>.env` |

If both exist, project values deep-merge over global values. Use the `.env` companion file for secrets — values are substituted as `$VAR_NAME` placeholders in the JSON.

### Creating a profile

```bash
# Create an empty profile to start from
nax config profile create fast-plan

# Edit it
cat > .nax/profiles/fast-plan.json << 'EOF'
{
  "plan": {
    "model": "fast",
    "timeoutSeconds": 120
  }
}
EOF
```

### Common profiles

**`fast-plan`** — Quick iteration, lower cost:
```json
{
  "plan": {
    "model": "fast",
    "timeoutSeconds": 120
  }
}
```

**`thorough-plan`** — High-stakes spec, pipeline validation:
```json
{
  "plan": {
    "model": "powerful",
    "mode": "pipeline",
    "timeoutSeconds": 900
  }
}
```

**`debate-plan`** — Multi-agent consensus on ambiguous spec:
```json
{
  "plan": {
    "model": "balanced"
  },
  "debate": {
    "enabled": true,
    "agents": 3,
    "stages": {
      "plan": {
        "enabled": true,
        "rounds": 2
      }
    }
  }
}
```

### Listing and inspecting profiles

```bash
# List all available profiles (global + project)
nax config profile list

# Show resolved values for a profile (secrets masked)
nax config profile show fast-plan

# Show which profile is active
nax config profile current

# Set a default profile in .nax/config.json (applies to all nax commands)
nax config profile use fast-plan
```

### Running with a profile

```bash
# One-off override — does not change .nax/config.json
nax plan -f auth --from .nax/features/auth/spec.md --profile fast-plan

# Equivalent via env var (useful in CI)
NAX_PROFILE=fast-plan nax plan -f auth --from .nax/features/auth/spec.md
```

---

## Step 5: Key config knobs

All settings live in `.nax/config.json` (or a profile override). These are the options most relevant to planning:

### Model tier

```json
{
  "plan": {
    "model": "fast | balanced | powerful"
  }
}
```

Maps to the agent's model via `config.models`:

| Tier | Default Claude model |
|:-----|:--------------------|
| `fast` | Haiku |
| `balanced` | Sonnet |
| `powerful` | Opus |

Default: `"balanced"`.

### Timeout

```json
{
  "plan": {
    "timeoutSeconds": 600,
    "decomposeTimeoutSeconds": 300
  }
}
```

`timeoutSeconds` caps the whole plan call. `decomposeTimeoutSeconds` overrides it for `--decompose` calls only. Range: 30–1800.

### Pipeline mode tuning

```json
{
  "plan": {
    "mode": "pipeline",
    "citationThreshold": 0.7,
    "criticModel": "fast"
  }
}
```

`citationThreshold` (0–1): fraction of drafted stories that must be grounded in the spec before the critic accepts the draft. `criticModel`: the model tier for the LLM critic step.

### Debate tuning

```json
{
  "debate": {
    "enabled": true,
    "agents": 3,
    "maxConcurrentDebaters": 2,
    "stages": {
      "plan": {
        "enabled": true,
        "rounds": 3,
        "resolverType": "synthesis",
        "evidenceMode": "asymmetric"
      }
    }
  }
}
```

### TDD strategy (affects stories the planner emits)

```json
{
  "tdd": {
    "strategy": "auto | strict | lite | off"
  }
}
```

The planner uses this to set `testStrategy` per story. `"auto"` lets the classifier decide per-story. `"strict"` forces TDD on all stories. `"off"` skips test generation for all stories.

---

## Step 6: Read the output

After `nax plan` succeeds:

```bash
# Inspect the generated PRD
cat .nax/features/<feature>/prd.json

# Quick summary — story count, IDs, titles
jq '.userStories[] | {id, title, status}' .nax/features/<feature>/prd.json

# Check routing metadata (complexity, test strategy, estimated cost)
jq '.userStories[] | {id, routing}' .nax/features/<feature>/prd.json
```

**What to check:**

- **Story count** — does the number of stories match the spec's ACs? Too few means stories were merged or missed.
- **`routing.complexity`** — `simple|medium|complex|expert`. Complex and expert stories take more time and escalation budget.
- **`routing.testStrategy`** — should align with the kind of behavior each story introduces.
- **`contextFiles`** — does each story point to the right source files? Missing context causes agents to miss existing patterns.
- **`verifiedBy`** — is the verification anchor a real file path? A missing anchor means the verifier has no way to confirm the story passed.
- **`dependencies`** — are dependent stories in the right order? Out-of-order dependencies cause parallel runs to block.

If the PRD looks wrong, re-run with a higher model tier (`--profile thorough-plan`) or revise the spec for clarity and re-run.

---

## Common mistakes to avoid

| Mistake | Fix |
|:--------|:----|
| Running `nax plan` without a spec (`--from` missing) | Always pass `--from <spec-path>`. The spec is the source of truth — without it the PRD has no grounding. |
| Editing `prd.json` by hand | Re-run `nax plan` or use `--decompose` to split stories. Hand edits are overwritten on re-run. |
| `--profile` refers to a profile that doesn't exist | Run `nax config profile list` to see available profiles. Create it with `nax config profile create <name>`. |
| Profile JSON has `profile` field nested inside it | Profiles must not contain a `profile` key — it is stripped at load time. |
| `plan.model: "high"` (string tier name incorrect) | Valid values are `"fast"`, `"balanced"`, `"powerful"`. Any other string fails config validation. |
| Using `debate` mode on a well-specified spec | Debate adds cost and latency. Use it only when the spec is ambiguous or stakeholder consensus is needed. |
| Passing `.nax/mono/<pkg>/...` path to `--from` | Pass the repo-relative spec path (e.g. `.nax/features/auth/spec.md`), not the mono config path. |
| `nax plan` times out before finishing | Increase `plan.timeoutSeconds` in config or use `--profile` with a higher timeout. Powerful models are slower — budget at least 600s for complex specs. |
| `citationThreshold` set to `1.0` in pipeline mode | A threshold of 1.0 means every drafted story must cite the spec verbatim — nearly impossible. Use 0.5–0.8. |
| PRD has far fewer stories than expected | The spec may be too prose-heavy. Add numbered ACs or named stories so the planner can extract discrete tasks. |
