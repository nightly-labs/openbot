---
name: "Bug Triage"
description: "Turn a bug report, logs or a failing test into a reproduction, ranked causes, one diagnostic step that separates them, the smallest fix, and a verified result. Use when something fails and the cause is not yet known."
---

# Bug Triage

## When to use

- A user, a test, a log or a QA run shows a failure and the cause is not known.
- Not for a review of a change that has no reported failure. Use Change Review for that.
- Not for a pass or fail check of a live site. Use Acceptance Check for that.

## Inputs

1. **The failure.** Expected result, actual result, and the exact error text. Get it from the issue
   (`gh issue view <number>` or an installed plugin such as Linear or Sentry), from a failing test, or from
   the user. If the user only describes it, ask them to paste the error and the steps.
2. **The version.** Commit, branch, release or build where it fails. Note where it last worked, if known.
3. **The code.** The workspace repository. Without it, ask for the relevant files or a stack trace.

If one detail blocks the reproduction, ask for that one detail with `ask_user`. Do not ask for more.
Never copy keys, tokens or passwords from logs into your notes or replies.

## Steps

1. **Reproduce.** Write the shortest steps or the smallest test that shows the failure. Run it. Record the
   command and the output. If you cannot reproduce it, say so and keep the report's evidence as the source.
2. **Locate.** Find the first point where the actual state differs from the expected state. Read the code
   there and its callers. Keep the trigger, the root cause and later secondary errors apart.
3. **Hypotheses.** Write at most three causes. Rank them by the evidence. Give each one a prediction: "if
   this is the cause, then <observation>".
4. **Separate.** Choose ONE diagnostic step whose result differs between the top hypotheses: a log line, a
   breakpoint, a changed input, `git bisect`, or one value printed. Run it. Discard each hypothesis that the
   result contradicts, and say so.
5. **Fix.** Make the smallest change that removes the root cause, only when the user asked for a fix. Do not
   change unrelated code or several things at once.
6. **Verify.** Run the reproduction again: it must now pass. Run one regression check near the change: the
   existing test file for that code, or a new focused test that failed before the fix.
7. **Report.** Say which steps ran and which did not.

## Rubric

Confidence in the cause:

- **Confirmed:** the reproduction failed before the fix and passes after it, and the diagnostic step
  pointed at this cause.
- **Likely:** the diagnostic step supports this cause, but the fix is not yet verified.
- **Possible:** it fits the evidence, but no step separated it from the other causes.
- **Unknown:** no reproduction. Give the next observation that would help most.

Never call a cause Confirmed without a run before and after the fix.

## Output

```
Bug: <one line> — <version>
Status: <Confirmed | Likely | Possible | Unknown>

Reproduction: <command or steps> → <error, exact text>
First divergence: <file>:<line> — expected <x>, got <y>

Hypotheses
1. <cause> — <evidence> — <kept | discarded: reason>
2. ...

Diagnostic step: <what ran> → <result>
Root cause: <one or two sentences>
Fix: <file>:<line> — <change>, or "proposed, not applied"

Verification
- Original failure: <command> → <pass/fail>
- Regression check: <command> → <pass/fail>
Not run: <check> — <reason>
```

## Approvals and stop conditions

- Diagnose first. Edit code only when the user asked for a fix.
- Do not commit, push, merge, deploy or close the issue without the user's yes.
- Do not run commands that delete data, change production, or send messages to reproduce a bug. Ask first.
- Stop after two diagnostic steps that do not separate the hypotheses. Report what you learned and ask.

## Common failures

- Changing three things at once, so nobody knows which one fixed it.
- Fixing the secondary error that the log shows last, not the first divergence.
- "Fixed" without a run of the original reproduction.
- A fix with no regression check, so the bug returns in the next change.
- Keeping a hypothesis after the evidence went against it.
