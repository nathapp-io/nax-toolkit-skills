# Ignore files — `.gitignore` and `.naxignore`

nax drops two kinds of files into a repo, and each needs a **different** ignore mechanism:

- **`.gitignore`** keeps nax's **generated runtime artifacts** out of version control (run logs, status, plans, session state, metrics, generated acceptance test files). The authored, reviewable nax files — `.nax/config.json`, `.nax/mono/**/config.json`, specs, `constitution.md`, `context.md` — stay **tracked**.
- **`.naxignore`** tells nax's **context engine** which directories NOT to walk when assembling context or scanning changed files. It is a `.gitignore`-style pattern file, read at the repo root and (in a monorepo) per package. It does **not** affect git.

Write both. They are orthogonal: a path can be git-ignored but still context-walked, or the reverse.

## `.gitignore` — the nax section

`nax init` appends these entries under a `# nax — generated files` marker. **This skill configures nax manually and must NOT run `nax init` to get them.** `nax init --force` overwrites the tailored `constitution.md` and `context.md` you wrote in step 7 (it leaves an existing `config.json` alone, but clobbers those two), and even plain `nax init` is unnecessary here. Add the entries yourself — they are the canonical set from nax's `src/utils/gitignore.ts` (keep in sync if nax changes it):

```gitignore
# nax — generated files
.nax-verifier-verdict.json
nax.lock
.nax/**/runs/
.nax/metrics.json
.nax/features/*/status.json
.nax/features/*/plan/
.nax/features/*/acp-sessions.json
.nax/features/*/interactions/
.nax/features/*/progress.txt
.nax/features/*/acceptance-refined.json
.nax-pids
.nax-wt/
**/.nax-acceptance*
**/_nax_acceptance_test.py
**/_nax_suggested_test.py
**/.nax/features/*/
.nax/prompt-audit/
```

**Apply idempotently** — add only entries not already present, so re-running the skill (or a prior `nax init`) never duplicates lines:

```bash
touch .gitignore
missing=""
while IFS= read -r e; do
  [ -z "$e" ] && continue
  grep -qxF "$e" .gitignore || missing="${missing}${e}\n"
done <<'ENTRIES'
.nax-verifier-verdict.json
nax.lock
.nax/**/runs/
.nax/metrics.json
.nax/features/*/status.json
.nax/features/*/plan/
.nax/features/*/acp-sessions.json
.nax/features/*/interactions/
.nax/features/*/progress.txt
.nax/features/*/acceptance-refined.json
.nax-pids
.nax-wt/
**/.nax-acceptance*
**/_nax_acceptance_test.py
**/_nax_suggested_test.py
**/.nax/features/*/
.nax/prompt-audit/
ENTRIES
[ -n "$missing" ] && printf "\n# nax — generated files\n%b" "$missing" >> .gitignore
```

The `grep -qxF` guard matches each line **exactly and literally** (the `*` globs are treated as plain text), so a section already present from `nax init` makes the block a no-op.

**Do NOT** add a blanket `.nax/` to `.gitignore` — that untracks the config and specs you want committed. Ignore only the generated artifacts above.

## `.naxignore` — context-engine suppression

Create `<repoRoot>/.naxignore`. The first line is **always `.nax/`** (nax's own internal tree is never useful as code context). Then add the repo's heavy / generated / vendored / non-code top-level dirs so they don't dilute the context window or the changed-file scan:

```gitignore
.nax/
<noise dirs for THIS repo>
```

Pick the noise dirs from what the repo actually has — common candidates:

| Category | Examples |
|:---------|:---------|
| Build output | `dist/`, `build/`, `out/`, `target/`, `.next/`, `.turbo/` |
| Dependencies / envs | `node_modules/`, `.venv/`, `vendor/` |
| Caches | `__pycache__/`, `.pytest_cache/`, `.mypy_cache/` |
| Non-code dirs | `docs/`, `examples/`, `scripts/`, `tools/`, `deployments/`, `.github/`, `tmp/` |
| Large fixtures / data | `fixtures/`, `testdata/` |

List only what exists — a `.naxignore` naming absent dirs is harmless but noise. Real examples: a TS lib used `.nax/  examples/  tmp/  scripts/`; a Python repo used `.nax/  .github/  .venv/  .pytest_cache/  docs/  tools/`.

**Monorepo:** the root `.naxignore` covers repo-wide noise; add a per-package `<packageDir>/.naxignore` only when a package has its own heavy dirs the root patterns don't catch — nax resolves the root and package patterns together.
