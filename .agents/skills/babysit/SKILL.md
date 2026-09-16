---
name: babysit
description: Babysit a pull request through the NorbiAI review loop until no valid issue remains. Fix valid findings, rebut false positives with checkable evidence, and re-request review. Use when asked to babysit a PR, handle NorbiAI comments, or clear the NorbiAI review gate.
---

# Babysit

Drive one pull request through repeated NorbiAI reviews until no valid issue
remains. Fix each valid finding. Rebut each false positive with evidence.
Ask for a new review after each round.

Use this skill only for the NorbiAI review on the current pull request.
Do not use it for human reviews or for other bots.

## Before you start

- Read `AGENTS.md` and each nested `AGENTS.md` for a directory you change.
- Read `.github/norbiai-review-prompt.md`. It defines `[NEW]`, `[REMAINS]`,
  `[RESOLVED]`, `[WITHDRAWN]` and what counts as a valid rebuttal.
- Find the pull request number and the branch. Check `git status`.
  Commit or stash unrelated work first.
- Confirm `gh` can read the pull request. You need the latest review
  comment and the `NorbiAI review` commit status on the head SHA.

## Step 1 — Read the latest review

1. Load PR comments with `gh api`. Find the newest comment from
   `github-actions[bot]` with `<!-- norbiai-review -->` in the body.
2. Record `Reviewed commit` from the comment. Compare it with the head SHA.
   Stop when the review is stale. Wait for a fresh review instead.
3. Read `## Findings`, `## Resolved Since Previous Review`, and
   `## Withdrawn Findings` as one set. Note the `[NEW]` and `[REMAINS]`
   tags and each `P0` to `P3` priority.
4. Read the `NorbiAI review` commit status on the head SHA. The gate
   blocks merge on unresolved `P0` and `P1` findings.

Do not act on an old review. Do not edit the review comment.

## Step 2 — Triage each finding

Check each finding against the full current diff and the surrounding code.
Prove the failure mode. Never trust the title alone.

Mark a finding as **valid** when it shows all of the following:

- It points to changed code or a direct effect of changed code.
- It names a concrete failure, cost, or broken contract. Examples:
  correctness, security, data loss, concurrency, broken contract, concrete
  performance regression, dead code to delete, code to reuse.
- It proposes the smallest fix.

Mark a finding as **not valid** when one of the following holds:

- The guard, check, or contract it asks for already exists. Name the
  file and line.
- It reports a style choice, a naming opinion, or a vague concern
  with no failure mode.
- It reports a speculative edge case with no path to reach it.
- It asks for a test with no concrete regression that test would catch.
- It asks for work outside the stated problem of the pull request.

Record the verdict in a table before you change code:

| Finding | Priority | Verdict | Evidence |
| --- | --- | --- | --- |
| Short title - `path:line` | P0-P3 | fix / rebut | Line, guard, or contract |

Fix only valid findings. Rebut the rest. Never fix a finding you
cannot reproduce in order to turn the gate green.

## Step 3 — Fix each valid finding

1. Apply the smallest change that removes the problem. Prefer delete
   and reuse over new code.
2. Obey the non-negotiable rules in `AGENTS.md`: keep migrations
   irreversible-safe, keep released Team API meaning unchanged, keep the
   renderer-to-main trust boundary, redact secrets, keep the license.
3. Run the narrowest relevant test file first. Then run `bun run lint`
   and `bun run typecheck`. Also run `bun run check:ui` for changes
   in `src/renderer`. Fix what your change broke. Rerun the checks.
4. Commit the fixes on the pull request branch.

Do not weaken a test to satisfy a finding. Do not widen a type to
`any` or `unknown` to bypass a checker. Do not change
`.github/norbiai-review-prompt.md` or `.github/workflows/norbiai-review.yml`
to pass the review.

## Step 4 — Rebut each false positive

The reviewer withdraws a finding only for a concrete, checkable reason.
Assertion without evidence does not work. A promise to fix it later
does not work. Disagreement about priority does not work.

Write one pull request comment that covers all rebuttals. For each
finding give:

- The finding title, priority, and `path:line`.
- The concrete reason it is wrong: the guard it misses, the line that
  already handles it, or the contract it misreads.
- The place where you verified the reason: file, line, and current head SHA.

Include `/norbiai review` in the same comment. That phrase asks for a
recheck. Without it the reviewer never sees the rebuttal.

Only a comment from someone who can merge counts as a rebuttal. The
workflow ignores other comments. When you cannot post as such a user,
give the user the exact comment text and wait. Do not post it yourself.

Never forge `<!-- norbiai-review -->` or `<!-- norbiai-response -->`
markers. Never edit another comment.

## Step 5 — Push and ask for a new review

One loop is one push plus one review run:

1. Push the branch with the fixes.
2. Post the rebuttal comment from Step 4 in the same round. The comment
   must contain the fixes summary, each rebuttal, and `/norbiai review`.
   As an alternative, apply the `norbiai` label. The label path also
   asks for a review.
3. Wait for the new `<!-- norbiai-review -->` comment and the new
   `NorbiAI review` status on the new head SHA. Poll with `gh api`.
   Do not start the next triage on the old SHA.

When the push itself triggers a review with no comment from you, still
wait for that review before you continue.

## Step 6 — Loop until clean, then stop

Start Step 1 again on the new review. Carry the ledger forward:

- A `[RESOLVED]` finding needs no more work.
- A `[WITHDRAWN]` finding must not return. When code added since
  reintroduces the same problem for a new reason, treat it as new.
- A `[REMAINS]` finding needs a fix or a stronger rebuttal. Say which
  part of your last response the reviewer could not verify.

Stop when both hold:

- `## Findings` says `No actionable findings.` or holds only findings
  you proved not valid and the reviewer withdrew.
- The `NorbiAI review` status on the head SHA is success.

Also stop and ask the user when the same finding returns twice with no
progress, when a `P0` finding is genuinely valid but the fix needs a
product decision, or when the review reports malformed output or failure.
Report the loop count, the fixes, the rebuttals, and the final status.

## Report format

After each loop, report:

| Finding | Verdict | Action |
| --- | --- | --- |
| Short title - `path:line` | fix / rebut | Commit or rebuttal line |

Then state the head SHA, the checks you ran, how you asked for the
next review, and what the next loop must check.
