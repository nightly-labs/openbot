---
name: "Change Review"
description: "Review a code change for bugs, regressions and missing checks. Each finding gets a location, a trigger, the consequence and the smallest fix, ranked by severity. Use for a pull request, a branch, uncommitted work or a pasted diff."
---

# Change Review

## When to use

- Before a merge, to find what will break.
- On a pull request, a branch, uncommitted work, or a diff that the user pastes.
- Not for root-cause work on a reported failure. Use Bug Triage for that.
- Not for a full security audit. Use Secure Code Guidance when the change crosses a trust boundary.

## Inputs

1. **The diff.** Get it in this order:
   - A pull request: `gh pr view <number> --json title,body,baseRefName,headRefName,files`, then `gh pr diff <number>`.
   - A branch: `git diff <base>...HEAD`. Uncommitted work: `git diff` and `git diff --staged`.
   - No repository access: ask the user to paste the diff or upload the changed files.
2. **The intent.** Read the pull request body, the linked issue, or the commit messages. If the intent is
   missing and it changes the review, ask one question with `ask_user`. Otherwise state your reading of it.
3. **The context.** In a repository, read the full changed files, their callers and their tests. With a
   pasted diff only, say which findings you could not check against callers.

## Steps

1. Read the intent. Write it in one sentence. Review against it.
2. For each changed function, find its callers (`git grep`, or search the workspace). Read them before you
   call a line wrong.
3. Trace the changed inputs to the outputs. Look at: null and empty values, error paths, cleanup,
   ordering and concurrency, retries, saved data and its old formats, and public contracts.
4. For each candidate finding, write the trigger (a concrete input or state), the consequence (the wrong
   result), and the smallest fix. If you cannot name a trigger, drop the finding.
5. Rank the findings with the rubric. Merge duplicates.
6. Run the narrowest check that applies: the test file for the changed code, a type check for one project,
   or a lint of the changed files. Do not run full builds or full test suites unless the user asks.
7. Record which checks ran and their result. Recommend a focused test for each Blocker and High finding.

## Rubric

- **Blocker:** data loss, a security hole, a crash on the main path, or a broken released contract.
- **High:** a wrong result on a common path, or a regression of behavior that worked before.
- **Medium:** a wrong result on an edge case that real use reaches, or a leak of a resource.
- **Low:** a real defect with a small effect, or one that needs a rare state.
- **Verdict:** DO NOT MERGE if any Blocker or High. FIX FIRST if any Medium. Else OK TO MERGE.

Noise. Do not report these as findings:

- Style, naming and formatting that a linter or formatter already enforces.
- "Add tests" without a named case that would fail today.
- Claims that need an assumption the code does not make.
- Rewrites of unchanged code, and taste.

Put an optional style note in a separate "Notes" line only when the user asks for one.

## Output

```
<VERDICT> — <pull request, branch or "pasted diff"> — intent: <one sentence>

1. [Blocker] <file>:<line> — <short title>
   Trigger: <input or state>
   Consequence: <what goes wrong>
   Fix: <smallest change>

2. [Medium] ...

Checks run: <command> → <pass/fail, count>
Not run: <check> — <reason>
Not reviewed: <files or callers you could not read>
```

If there are no findings, write "No findings" and the limits of the review.

## Approvals and stop conditions

- Review only. Do not edit, commit or push unless the user asks for a fix.
- Do not comment on the pull request, approve it, request changes or merge without the user's yes.
- Stop and ask when the diff is too large to read in full. Propose the files to review first.

## Common failures

- Calling a line wrong before reading its callers.
- A finding with no trigger. It is a guess, and it costs the author time.
- Saying "tests pass" when no test ran. Name the command, or say "not run".
- Burying one Blocker under ten Low findings. Lead with the worst.
- Reviewing the code against your own idea of the intent, not the stated one.
