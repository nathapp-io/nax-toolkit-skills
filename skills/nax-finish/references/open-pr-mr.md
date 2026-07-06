# Open the MR/PR (nax-finish Step 7)

Reached only after **every** gate is green (acceptance, review/triage, repo-root quality). Prepare the PR/MR, then either **open a new one** or **promote the existing one** — but do so **only after the user explicitly approves**. Nothing here runs until Steps 3–6 have all passed (or been explicitly waived).

> **nax autoPR may have already opened it.** nax's autoPR feature can open a PR/MR for the branch during the run (as a **draft** or as **ready**, depending on repo config). So this step is **not** an unconditional create: detect whether a PR/MR already exists for the branch first (7e), then branch — create if none, promote draft→ready if one exists, or report-and-stop if one already exists and is already ready. Never blindly `gh pr create` / `glab mr create`; that would error (a PR already exists) or open a duplicate.

## 7a. Detect platform and base branch

```bash
git remote get-url origin 2>/dev/null
```
- Contains `github.com` → GitHub, use `gh`.
- Contains `gitlab` (any host) → GitLab, use `glab`.
- Neither / no remote → print the assembled title + body and stop with: "No GitHub/GitLab remote detected — here's the PR body; open it manually."

Detect the base branch the same way post-impl-review does (`git remote show origin | grep 'HEAD branch'`, fallback `origin/main` then `origin/master`).

Verify the CLI is available and authenticated (`gh auth status` / `glab auth status`). If not, fall back to printing the command + body for the user to run.

## 7b. Ensure a pushable branch

```bash
git rev-parse --abbrev-ref HEAD
```
If the current branch **is** the base/default branch, do **not** push to it. Tell the user, propose a branch name derived from the feature (e.g. `feat/<featureName>`), and create it **with approval** before continuing.

**Reconcile the working tree before pushing — mandatory.** A PR/MR ships only what is committed; any modified-but-unstaged or **untracked** file silently stays out of it, and the PR then omits part of the feature. Uncommitted state arrives from **two** distinct sources, and you must account for both:
1. **Left behind by the nax run** — nax's auto-commit can miss newly-created files, leaving them untracked before nax-finish even starts.
2. **Created by nax-finish itself** — the fixes you applied while driving the gates green (Step 3 acceptance fixes, Step 5 review fixes, Step 6 quality fixes) are edits in the working tree that are easy to apply and then forget to commit. **This is the most common cause:** the agent fixes a finding, the gate goes green, and the change is never committed — so the PR ships the *unfixed* code.

So before `git push`, always inspect the **full** working-tree state — never assume your own fixes were committed:
```bash
git status --porcelain   # lists BOTH modified (` M`) and untracked (`??`) paths
```
If the output is non-empty, surface every entry (including untracked files — group them so the user sees what is new vs modified) and ask how to handle them: commit them (with an appropriate conventional-commit message; `git add -A` to capture untracked files too), or stop. **Never auto-commit without approval, and never push while `git status --porcelain` is non-empty unless the user explicitly tells you to leave those files out.** Then push the branch:
```bash
git push -u origin <branch>
```
so the remote has the commits.

## 7c. Find a template

- GitHub: check `.github/PULL_REQUEST_TEMPLATE.md`, `.github/pull_request_template.md`, `docs/PULL_REQUEST_TEMPLATE.md`, and any file under `.github/PULL_REQUEST_TEMPLATE/`.
- GitLab: check `.gitlab/merge_request_templates/*.md`.

If a template exists, fill its sections rather than imposing your own structure. If several GitLab templates exist, ask which to use. If none exists, use a clean default: **Summary**, **What changed**, **Test plan**, **Review notes**.

## 7d. Compose the body from the spec

Summarize the **spec** as the body — this is the point of the step:
- **Summary:** the feature's goal in 1–3 sentences, drawn from the spec's intent.
- **What changed:** the key stories/ACs delivered (from the spec), aligned with the actual diff stat.
- **Test plan:** the acceptance result from Step 3 and the repo-root quality gates from Step 6 (list them as checked).
- **Review notes:** the post-impl-review verdict, plus any findings the user explicitly waived in Step 5 (call them out honestly — don't bury accepted deviations).

Keep it accurate to what actually happened — do not claim gates passed that you skipped, and do not invent ACs the spec doesn't contain.

## 7e. Detect an existing PR/MR for the branch

Before creating anything, check whether a PR/MR already exists for `<branch>` (nax autoPR may have opened one), and read its draft state.

**GitHub** — `gh pr view` supports JSON, so one call gives everything:
```bash
# Empty output / non-zero exit when the branch has no open PR
gh pr view "<branch>" --json number,state,isDraft,url,title 2>/dev/null
```
Read `isDraft` (bool) and `url`.

**GitLab** — `glab mr view` has **no** JSON output in current `glab`, so detect via `glab mr list` (which does filter by branch and draft state). Two small queries:
```bash
# 1. Does an open MR exist for this branch? Empty ⇒ none. The MR's IID is the first column of the row.
glab mr list --source-branch "<branch>"
# 2. Is that MR a draft? This lists the MR ONLY when it is a draft.
glab mr list --source-branch "<branch>" --draft
```
An MR that appears in query 1 but **not** in query 2 is already **ready**. GitLab also encodes draft state in the title prefix (`Draft:` / legacy `WIP:`) — a useful cross-check. Grab the MR **IID** from the first column of the query-1 row for the promote/update commands below.

Branch on the result:
- **No existing PR/MR** → go to **7f (create)**.
- **Exists and is a draft** → go to **7g (promote draft → ready)**.
- **Exists and is already ready** (not a draft) → **report and stop.** Print the existing URL and note it's already open and ready — there is nothing to open. Do **not** create a duplicate and do **not** silently rewrite its body. (You may offer to refresh its body per 7g's optional body step if the user asks, but default to leaving it as-is.) This is a clean success — carry the URL into the final summary.

## 7f. Create a new PR/MR (only when none exists)

Print the full title + body + target branch. Ask the user to approve, edit, or cancel. **Only after explicit approval**, open it:
```bash
# GitHub
gh pr create --base <base> --head <branch> --title "<title>" --body "<body>"
# GitLab
glab mr create --target-branch <base> --source-branch <branch> --title "<title>" --description "<body>"
```
Print the resulting URL. If the user edits, revise and re-confirm before opening. If the user cancels, stop and leave the branch pushed so they can open it themselves.

## 7g. Promote an existing draft → ready (only when a draft exists)

A draft PR/MR is already open (from autoPR) — the remaining action is to mark it ready, not to recreate it. **Default: leave its title/body untouched.**

1. Show the user the existing PR/MR: its URL, title, current draft state, and that the branch now carries all the review/quality fixes you just pushed (7b). State that you'll flip it to **ready**.
2. **Offer** (don't force) a body refresh: you composed a fresh spec body in 7d — offer to update the PR/MR description to it. Only overwrite the existing autoPR body **if the user explicitly approves**; otherwise leave it as-is.
3. **Only after explicit approval**, promote it (and, if approved in step 2, update the body first):
```bash
# GitHub — optional body refresh, then mark ready
gh pr edit "<branch>" --title "<title>" --body "<body>"   # only if user approved a refresh
gh pr ready "<branch>"

# GitLab — optional body refresh, then mark ready
glab mr update "<iid>" --title "<title>" --description "<body>"   # only if user approved a refresh
glab mr update "<iid>" --ready
```
Print the resulting URL. If the user declines to promote, stop and leave the draft as-is (branch already pushed with the fixes).
