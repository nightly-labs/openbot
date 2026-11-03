---
name: "PR Follow-up"
description: "Track the open pull requests of a named repository, classify each one, fix failing CI and review threads on the PR branch when the user allowed it, and ask the user only to merge the ones that are ready. Use for a one-time pass or a scheduled check."
---

# PR Follow-up

## When to use

- Move the user's open pull requests toward merge, once or on a schedule.
- Not for a first review of a change. Use Change Review for that.

## Inputs

1. **Repository.** `owner/name`, from the user or the saved setup. The `gh` command must be signed in
   (`gh auth status`). If not, ask the user to sign in, or to paste the pull request pages, and only report.
2. **Which pull requests.** The user's own (`--author "@me"`) and any numbers the user asked you to watch.
3. **Allowed actions for this repository.** One of: `report` (default), `fix-ci`, `fix-ci-and-reviews`.
   If it is not saved, use `report` and ask once with `ask_user`.

Saved setup lives in the shared data table `watched_repos`: repository, pull requests to watch, allowed
actions, and the last seen state of each pull request (number, head commit, class, time). Create the
table on the first save.

## Steps

1. For each repository, run `gh pr list --repo <repo> --author "@me" --state open --json
   number,title,headRefName,isDraft,mergeable,reviewDecision,statusCheckRollup,updatedAt`. Add each watched
   number with `gh pr view <number> --repo <repo> --json` and the same fields.
2. Classify each pull request with the rubric.
3. For CI failing, when `fix-ci` or `fix-ci-and-reviews` is allowed:
   - In a clone in your own workspace, run `gh pr checkout <number>`.
   - Read the failed log: `gh run view <run id> --log-failed`. Find the first real error.
   - If the failure is not related to the diff and passes locally, rerun once:
     `gh run rerun <run id> --failed`. Do not rerun twice.
   - Else reproduce it with the narrowest local check, fix it, run the check again, commit, and
     `git push` to the PR head branch.
4. For changes requested, when `fix-ci-and-reviews` is allowed: read the open threads
   (`gh pr view <number> --comments`). Fix each thread that asks for a clear code change. Push to the PR
   branch. Do not reply to or resolve threads; list them in the report. Leave threads that ask a question
   or need a decision for the user.
5. Stop after two failed fix attempts on one pull request. Mark it "needs you" with the reason.
6. Save the new state of each pull request to `watched_repos`.
7. Report. The only ask is the ready-to-merge list.

## Rubric

Give each pull request one class, the first that applies:

1. **Conflicts:** `mergeable` is `CONFLICTING`. Report the files. Do not resolve without the user's yes.
2. **CI failing:** a required check failed.
3. **Changes requested:** `reviewDecision` is `CHANGES_REQUESTED`, or there are open review threads.
4. **Waiting:** checks are running, or a review is pending for less than 3 days.
5. **Stale:** no update for 7 days or more, and none of the above.
6. **Ready to merge:** not a draft, all required checks passed, approved or no review required, no conflicts.

Drafts get "Draft" and are not acted on.

## Output

```
<repo> — <date and time>

Ready to merge
- #<n> <title> — checks passed, approved by <reviewer>

Fixed this run
- #<n> CI failing → pushed <short commit>: <one line>; check <name> now <result>

Needs you
- #<n> Conflicts in <files>
- #<n> Thread from <reviewer>: "<quote>" — asks a decision

Waiting / Stale / Draft: #<n>, #<n>
```

Quote review text exactly.

## Approvals and stop conditions

- Never merge. Never force-push, rebase a shared branch, or push to the base branch without the user's yes.
- Push only to the head branch of the pull request you fixed. If the head is a fork you cannot push to,
  report the fix as a patch.
- Do not comment, approve, close, or request reviewers without the user's yes.
- Fix only in repositories where the saved setup allows it.

## Routine runs

1. Read `watched_repos`. If there is no row and you have not asked before, send one short message that asks
   for the repository and the allowed actions, and save that you asked. If you asked before, call
   `routine_no_update`.
2. Compare each pull request with its last seen state: head commit, class, checks, review decision.
3. If nothing changed and no pull request is newly ready, call `routine_no_update` and send nothing.
4. Else act as above and send only the changes since the last run.

## Common failures

- Rerunning a real failure until it passes by chance.
- Pushing a fix to a branch that someone else owns without the setup that allows it.
- Reporting every pull request on every run. Report what changed.
- Calling a pull request ready while a required check still runs.
