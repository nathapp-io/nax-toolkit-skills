# Worker protocol (shared mechanics)

Self-contained mechanics for a post-impl-review **worker** (SPEC or QUALITY).
Read this plus your dimension reference (`spec-review.md` or `code-quality.md`) —
you do **not** need to read the dispatcher's `SKILL.md`. The dispatcher already
resolved the spec, detected the base branch, and ran the empty-diff/size guards;
your job is to review the diff and return findings.

## Get the diff

The dispatcher gave you the base branch. Fetch the diff content:

```bash
git diff origin/<branch>...HEAD --name-only   # changed file list
git diff origin/<branch>...HEAD               # full diff content
```

## Filter noise

Do not treat churn in these as a reviewable change (you may still *read* them as
context):

- Lockfiles: `bun.lock`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`,
  `Cargo.lock`, `poetry.lock`, or anything ending in `.lock`.
- Generated output: files in `dist/`, `build/`, `.next/`, `.turbo/`,
  `__pycache__/`, or matching `*.generated.*`.
- nax artifacts: anything under a `.nax/` directory at **any depth**
  (`**/.nax/**` — root or nested per-package in a monorepo): specs, PRDs,
  acceptance result JSON, config, and the generated acceptance tests.
- Binary files: git marks these `Binary files a/... and b/... differ` — skip them.

## Read the unchanged collaborators (before judging)

Most real defects in a focused diff live on the boundary between the changed code
and the *unchanged* code it calls into — which is, by definition, not in the
diff. Build the list of external touchpoints (every symbol the changed code
*uses* but does not *define*: callees, polymorphic/interface calls, new arguments
to existing APIs, consumers of changed outputs, collaborators named in the spec)
and read each definition with Read/Grep before concluding. Treat an untested
cross-cutting claim as **unverified, not satisfied**. (The SPEC dimension file
has the full procedure with worked examples; the QUALITY worker needs the same
reads to judge an integration-shaped defect.)

## Severity table

| Severity | Meaning |
|:---------|:--------|
| CRITICAL | AC entirely missing; implementation directly contradicts a hard spec requirement; the changed code raises/crashes at runtime for a case the spec requires to work; a mechanism the diff declares that nothing on a production path can reach (an AC delivered to its own tests only); the changed code can lose or corrupt data, or silently discards a real failure on a production path whose caller you can name and whose caller reads the substituted value as success (a swallowed exception, an unchecked exit or status code, a fallback returning empty on error); or a security defect the diff introduces (hardcoded secret, injection sink) |
| HIGH | Significant drift (wrong API shape, missing constraint, wrong architectural approach); an integration defect that breaks a real collaborator the spec depends on; a partially-wired mechanism (one of several required call sites connected, or a live path gated behind a switch nothing sets); a resource leak, a race, or an N+1 / blocking-I/O regression on a path that runs in production; a test whose green depends on ordering, environment or wall-clock, which makes every other gate in this review unreliable; or a violation of a project rule explicitly marked as required/forbidden (a banned API, a hard-blocked pattern) |
| MEDIUM | Partial coverage — AC present but incomplete; minor drift affecting correctness; an integration gap reachable through a now-permitted input; a leak, race or performance regression on a path that is not clearly production-reachable; a swallowed error on a secondary path; an accessibility defect on a new interactive UI element; or a design/maintainability concern with a named, concrete cost |
| LOW | Minor naming deviation, style mismatch, dead/redundant/duplicated code, unused locals, a soft convention deviation, or other non-blocking gap |

**Break ties on blast radius, not on defect kind.** A leak in a per-request
handler and a leak in a once-at-startup path are not the same severity. Data
loss, security, or a crash on a live path pushes up; reachable only from a
startup path, a dev-only branch or a rare boundary pushes down. Say which in the
`Problem:` line.

Wiring clauses in that table (an unreachable declared mechanism; a
partially-wired mechanism) belong to the **SPEC** dimension. A QUALITY worker
does not apply them — it has no spec and therefore no access to the exemptions
that make the judgement safe.

## Output format — return ONLY this

Return **only your findings**, nothing else: no `Spec:`/`Base:` header, no
`FINDINGS` divider, no `VERDICT` line (the dispatcher adds those). Emit each
finding as a block:

```
[SEVERITY] <short title>
  Problem: <what's wrong — quote the mechanism (the predicate, cast, call or
           missing guard) with its file/line, and the concrete cost>
  Fix: <the concrete change, or "note intentional deviation">
```

If you are the SPEC worker (or the combined worker) and the Wiring dimension
waived a symbol on the spec's own quoted text, emit that waiver above your
findings as its own line — `Wiring exempt: <symbol> — <section>: "<quote>"` — so
the dispatcher can surface it in the header. It is not a finding and does not
count toward the verdict.

If you found nothing in your group, return the literal line `No findings.` —
preceded only by any `Wiring exempt:` lines, and nothing else. That message is
the only thing that travels back to the dispatcher.
