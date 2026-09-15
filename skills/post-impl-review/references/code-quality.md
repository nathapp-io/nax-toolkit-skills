# Code quality & test integrity dimension

Reference for the post-impl-review **code-quality** pass: spec-independent
defects and design/maintainability concerns in the changed lines. These findings
are real regardless of what the spec says. Scan the diff — production **and**
test code — and judge each changed function on its own merits.

## Forcing function — enumerate before you conclude

Before reporting, walk **every function/method the diff adds or changes** and
write yourself a one-line verdict for each: *earns its place* or *concern: …*.
This enumeration is a thinking tool — it does not go in the final report, only
the resulting findings do. Skipping it is how real maintainability issues get
missed: an agent that pattern-matches a few obvious smells and stops will always
under-report. Look at each changed function deliberately.

## What to look for

Report only concrete, objective issues, not style preferences:

- **Test isolation:** mutating `os.environ` / globals / singletons / filesystem
  without teardown; cross-test ordering dependence; shared mutable fixtures. A
  test that only passes because another test happens to clean up after it is a
  defect even when the suite is currently green.
- **Dead / redundant code:** assignments with no effect, unreachable branches,
  set-up the constructor already performed, unused locals introduced by the diff; (an added symbol that nothing calls is the SPEC worker's Wiring dimension, not this one — leave it be);
  logic duplicated from an existing helper the diff could have reused.
- **Resource leaks:** opened files / sockets / handles / subprocesses not closed;
  timers / listeners not cleared.
- **Error handling — a failure signal that reaches nobody.** Swallowed
  exceptions and bare catches; missing validation on a newly-introduced input
  path; and the shapes that are *not* catch blocks and get missed for that
  reason: a **return value whose failure the caller discards** (an unchecked
  `.success`/`ok`/error return, a promise never awaited), an **exit or status
  code never inspected** (a spawned process whose nonzero exit resolves
  normally), and a **handler that substitutes a default on failure** — `[]`,
  `{}`, `null`, a cached or degraded value — so the caller cannot distinguish
  "empty" from "broken". You have no spec here, so the justification must be
  visible in the code itself (a comment, a name like `…OrDefault`, an explicit
  flag in the return); absent that, report it.
- **Concurrency:** shared state mutated without synchronisation; `await` inside a
  loop that should be batched; a race between a check and the action it guards.
- **Performance:** N+1 queries or network calls in a loop; blocking I/O on a hot
  path; an obviously quadratic scan over a large collection the diff introduces.
- **Accessibility (UI diffs only):** interactive elements without an accessible
  name/label, missing `alt`, non-keyboard-reachable controls, form inputs with
  no associated label.
- **Security (only when the diff touches it):** hardcoded secrets, unvalidated
  user input reaching a sink, injection vectors.
- **Type safety:** unsafe casts, `any`/`unknown` escapes, weakened or widened
  types the diff introduces, or a narrowing the diff drops — anywhere the change
  trades a compile-time guarantee for a runtime risk.
- **Design & maintainability (open-ended — not a closed checklist):** a changed
  function that conflates multiple responsibilities (poor separation of
  concerns); an abstraction the diff introduces that is premature (single caller,
  speculative generality) or leaky (callers must understand its internals to use
  it safely); logic the diff writes inline that an existing helper already
  provides (reinvention, not just literal duplication); control flow so nested or
  convoluted the next reader will misread it; an identifier whose name actively
  misleads about what it holds or does; a comment or docstring the diff now leaves
  stale or contradicting the code it sits on, or a changed public API left without
  the docs a caller needs; an edge case the changed code's *own* logic implies but
  doesn't handle. These are the qualitative "this code isn't good yet" findings —
  judge them, don't skip them because they aren't on the defect list above. Anchor
  each to the changed line and state the concrete cost (what breaks, or who is
  misled, later).

Every finding here must **quote the mechanism** — the actual predicate, cast,
call, assignment or missing guard — alongside the changed line, and name a
concrete cost: a bug, a future break, or a reader who will be misled. Quote the
mechanism, not just the offset: a finding anchored to `foo.ts:214` is unverifiable
the moment the file moves or is split, while one that quotes
`catch { return [] }` can be re-checked by anyone, anywhere, forever. The line
number locates it; the quoted mechanism *is* the evidence. Skip pure formatting and
personal taste that carry no such cost, and skip hypotheticals about code outside
the diff. But a design or maintainability concern grounded in a changed line and
its cost **is** in scope even though it's not on the defect checklist above —
that is exactly the signal this dimension exists to surface.

## What NOT to report

These are out of scope here even when they are real. Each is cheap to decide, so
decide it before writing anything down:

- **Pre-existing defects on lines the diff did not touch.** Not this change's
  blast radius — stay silent. The one exception: a changed line that makes a
  pre-existing defect newly *reachable* is this diff's finding; anchor it to the
  changed line that opened the path, not to the old one.
- **Anything a linter, typechecker, compiler or formatter catches** — missing or
  unused imports, type errors, import order, formatting, unreachable-code
  warnings. Assume CI runs these; do not run them yourself. If your only evidence
  is "a tool would flag this", drop it.
- **Anything the author explicitly silenced in-code** next to the line —
  `@design`, `eslint-disable`, `# noqa`, `// nolint`, `# type: ignore`, or a
  comment stating the tradeoff. That is a recorded decision, not a defect.
- **Behaviour changes that read as intentional** and coherent with the rest of
  the diff. "This now returns early" is a finding only when you can name what it
  breaks.

**Refute your own finding first.** Before reporting, try to kill it: name the
input, caller, ordering or configuration that makes it real. If you cannot
substantiate it and cannot refute it, it is a hunch — drop it. The lower bar
below widens what counts as *real*, never what counts as *stated*.

## Confidence threshold (code quality)

**Report findings you are ≥60% confident are real**, *provided* each is anchored
to a specific changed line and names a concrete maintenance or correctness cost.
Design and maintainability problems are inherently probabilistic — a muddy
abstraction, a misleading name, or a fragile edge case rarely clears 80%, and a
blanket 80% gate is precisely what makes a review miss the quality issues it
exists to catch. Let these land as MEDIUM or LOW per the severity table rather
than dropping them; the implementer can waive them, but they should see them.
Still exclude pure formatting and personal taste that carry no stated cost. Do
**not** over-suppress this tier to hit an arbitrary count — a real
maintainability concern stated with its cost is worth surfacing even at moderate
confidence.

## Severity (quality-local)

The severity table in `worker-protocol.md` is keyed to the SPEC dimensions: its
CRITICAL and HIGH rows are written around ACs, spec requirements, wiring and
project rules — **none of which you may use**. Read alone, it caps every quality
defect except a security sink at MEDIUM, and MEDIUM cannot move the verdict. So
grade your findings by the rows below instead; they override the shared table for
this dimension, and they are the only way a quality-only review can honestly
reach `NEEDS WORK`.

| Severity | A quality finding earns it when |
|:---------|:--------------------------------|
| CRITICAL | The changed code can lose or corrupt data; it silently discards a real failure on a production path (a swallowed exception, an unchecked exit code, a fallback that returns empty on error); or it introduces a security sink. "The suite is green" is not evidence against any of these — it is the usual condition for all three. |
| HIGH | A resource leak, a race, or an N+1 / blocking-I/O regression on a path that actually runs in production; or a test whose green depends on ordering, environment or wall-clock, which makes every other gate in this review unreliable. |
| MEDIUM | The same defect classes on a path that is not clearly production-reachable; a swallowed error on a secondary path; an accessibility defect on a new interactive element; a design or maintainability concern with a named, concrete cost. |
| LOW | Dead or redundant code, unused locals, a misleading name, a stale comment, duplicated logic — real, cheap to fix, and nothing breaks today. |

**Break ties on blast radius, not on defect kind.** A leak in a per-request
handler and a leak in a once-at-startup path are not the same severity. Data
loss, security, or a crash on a live path pushes up; reachable only from a
startup path, a dev-only branch or a rare boundary pushes down. Say which in the
`Problem:` line.
