# Open the MR/PR (nax-finish Step 7)

Reached only after **every** gate is green (acceptance, review/triage, repo-root quality). Prepare the PR/MR, show it to the user, and open it **only after the user explicitly approves**. Nothing here runs until Steps 3–6 have all passed (or been explicitly waived).

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

## 7e. Show, then open on approval

Print the full title + body + target branch. Ask the user to approve, edit, or cancel. **Only after explicit approval**, open it:
```bash
# GitHub
gh pr create --base <base> --head <branch> --title "<title>" --body "<body>"
# GitLab
glab mr create --target-branch <base> --source-branch <branch> --title "<title>" --description "<body>"
```
Print the resulting URL. If the user edits, revise and re-confirm before opening. If the user cancels, stop and leave the branch pushed so they can open it themselves.
